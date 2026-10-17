begin;

-- A monotonically ordered report sequence disambiguates reports recorded in
-- the same transaction (where now() gives them the same timestamp).
alter table private.drinking_window_shadow_reports
    add column report_sequence bigint generated always as identity unique;

-- The only allowed lifecycle transition is through the trusted publisher.
-- A caller cannot make this guard pass merely by setting the transaction GUC:
-- direct API DML still runs as service_role, not as this function's owner.
create or replace function private.block_drinking_window_reference_publication()
returns trigger language plpgsql set search_path = '' as $$
begin
    if tg_op = 'INSERT' then
        if new.status <> 'draft' or new.published_at is not null
           or new.content_sha256 is not null then
            raise exception using errcode = '23514',
                message = 'A drinking-window version must start as a draft';
        end if;
    elsif old.status = 'draft' and new.status = 'draft' then
        if new.published_at is not null or new.content_sha256 is not null then
            raise exception using errcode = '23514',
                message = 'A draft cannot carry publication metadata';
        end if;
    elsif current_user = 'postgres'
          and pg_catalog.current_setting('app.drinking_window_publication', true) = 'on'
          and old.status = 'draft' and new.status = 'active'
          and new.content_sha256 ~ '^[0-9a-f]{64}$'
          and new.published_at is not null then
        null;
    elsif current_user = 'postgres'
          and pg_catalog.current_setting('app.drinking_window_publication', true) = 'on'
          and old.status = 'active' and new.status = 'superseded'
          and new.content_sha256 = old.content_sha256
          and new.published_at = old.published_at then
        null;
    else
        raise exception using errcode = '23514',
            message = 'Drinking-window reference publication requires the trusted publisher';
    end if;
    return new;
end;
$$;

create table private.drinking_window_publications (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null unique references public.drinking_window_reference_versions(id),
    replaced_version_id uuid references public.drinking_window_reference_versions(id),
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    reviewed_household_count integer not null check (reviewed_household_count >= 0),
    published_at timestamptz not null default now()
);
revoke all on private.drinking_window_publications
from public, anon, authenticated, powersync_role, service_role;
create trigger drinking_window_publications_immutable
before update or delete on private.drinking_window_publications
for each row execute function private.reject_drinking_window_shadow_update();

create table private.drinking_window_runtime_switch (
    singleton boolean primary key default true check (singleton),
    enabled boolean not null default false,
    version_id uuid references public.drinking_window_reference_versions(id),
    changed_at timestamptz not null default now()
);
insert into private.drinking_window_runtime_switch (singleton) values (true);
revoke all on private.drinking_window_runtime_switch
from public, anon, authenticated, powersync_role, service_role;

create table private.drinking_window_runtime_events (
    id bigint generated always as identity primary key,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    enabled boolean not null,
    reason text not null check (length(trim(reason)) >= 10),
    changed_at timestamptz not null default now()
);
revoke all on private.drinking_window_runtime_events
from public, anon, authenticated, powersync_role, service_role;
create trigger drinking_window_runtime_events_immutable
before update or delete on private.drinking_window_runtime_events
for each row execute function private.reject_drinking_window_shadow_update();

-- Publication is one atomic operation. A preflight or an old approval is not
-- a certificate: all draft gates and all affected owners' full-cellar reports
-- are checked again against current state immediately before activation.
create function public.publish_drinking_window_reference(p_version_id uuid)
returns table (version_id uuid, content_sha256 text,
    replaced_version_id uuid, reviewed_household_count integer)
language plpgsql security definer set search_path = '' as $$
declare
    v_hash text;
    v_previous uuid;
    v_household uuid;
    v_report private.drinking_window_shadow_reports%rowtype;
    v_decision private.drinking_window_shadow_decisions%rowtype;
    v_snapshot jsonb;
    v_reviewed integer := 0;
begin
    -- Serialise competing publishers and draft writers. The draft-only row
    -- tables are held against concurrent edits for the short publication
    -- transaction, including source rights and household advice changes.
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    lock table public.drinking_window_reference_rows,
        public.drinking_window_ageing_groups,
        public.drinking_window_ageing_group_memberships,
        public.drinking_window_reference_evidence,
        public.drinking_window_reference_reviews,
        public.enrichment_evidence,
        public.enrichment_sources,
        public.enrichment_source_policies,
        public.enrichment_curator_eligibilities,
        public.enrichment_places,
        public.enrichment_place_aliases,
        public.wine_reference_producers,
        public.wine_reference_products,
        public.wine_reference_releases,
        public.households,
        public.household_members,
        public.wines,
        public.wine_maturity_overrides,
        public.wine_enrichment_projections,
        private.drinking_window_publication_preflights,
        private.drinking_window_shadow_reports,
        private.drinking_window_shadow_decisions
    in share mode;
    perform 1 from public.drinking_window_reference_versions v
    where v.id = p_version_id and v.status = 'draft' for update;
    if not found then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;
    select v.id into v_previous
    from public.drinking_window_reference_versions v where v.status = 'active';

    if exists (select 1 from public.drinking_window_publication_issues(p_version_id)) then
        raise exception using errcode = '23514',
            message = 'The draft still has publication issues';
    end if;
    v_hash := public.drinking_window_draft_fingerprint(p_version_id);
    if not exists (
        select 1 from private.drinking_window_publication_preflights p
        where p.version_id = p_version_id and p.content_sha256 = v_hash
          and p.issue_count = 0
    ) then
        raise exception using errcode = '23514',
            message = 'A current zero-issue preflight must be recorded';
    end if;

    for v_household in
        select distinct w.household_id from public.wines w
        where w.merged_into_wine_id is null
        order by w.household_id
    loop
        select * into v_report from private.drinking_window_shadow_reports r
        where r.version_id = p_version_id and r.household_id = v_household
        order by r.report_sequence desc limit 1;
        if not found or v_report.draft_sha256 <> v_hash
           or v_report.draft_issue_count <> 0 then
            raise exception using errcode = '23514',
                message = 'Every populated household needs a current shadow report';
        end if;
        select * into v_decision from private.drinking_window_shadow_decisions d
        where d.report_id = v_report.id
        order by d.decision_sequence desc limit 1;
        if not found or v_decision.verdict <> 'approve'
           or v_decision.content_sha256 <> v_report.content_sha256
           or not exists (
               select 1 from public.household_members m
               where m.household_id = v_household
                 and m.user_id = v_decision.reviewer_id and m.role = 'owner'
           ) then
            raise exception using errcode = '23514',
                message = 'Every populated household needs its current owner approval';
        end if;
        v_snapshot := private.drinking_window_shadow_snapshot(
            p_version_id, v_household
        );
        if v_snapshot ->> 'content_sha256' <> v_report.content_sha256
           or (v_snapshot ->> 'draft_issue_count')::bigint <> 0 then
            raise exception using errcode = '40001',
                message = 'A cellar or draft changed after owner review';
        end if;
        v_reviewed := v_reviewed + 1;
    end loop;

    perform pg_catalog.set_config('app.drinking_window_publication', 'on', true);
    if v_previous is not null then
        update public.drinking_window_reference_versions v
        set status = 'superseded' where v.id = v_previous;
    end if;
    update public.drinking_window_reference_versions v
    set status = 'active', content_sha256 = v_hash, published_at = now()
    where v.id = p_version_id;
    perform pg_catalog.set_config('app.drinking_window_publication', 'off', true);
    insert into private.drinking_window_publications
        (version_id, replaced_version_id, content_sha256,
         reviewed_household_count)
    values (p_version_id, v_previous, v_hash, v_reviewed);
    update private.drinking_window_runtime_switch
    set enabled = true, version_id = p_version_id, changed_at = now()
    where singleton;
    insert into private.drinking_window_runtime_events
        (version_id, enabled, reason)
    values (p_version_id, true, 'Validated reference publication');
    return query select p_version_id, v_hash, v_previous, v_reviewed;
end;
$$;
revoke all on function public.publish_drinking_window_reference(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.publish_drinking_window_reference(uuid)
to service_role;

-- Emergency reversible switch: turning references off restores the existing
-- model reader without deleting a reviewed version. Every change is audited.
create function public.set_drinking_window_reference_enabled(
    p_enabled boolean, p_expected_version_id uuid, p_reason text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
    v_active uuid;
begin
    if p_enabled is null or p_reason is null or length(trim(p_reason)) < 10 then
        raise exception using errcode = '22023',
            message = 'A switch decision needs a reason of at least ten characters';
    end if;
    select id into v_active from public.drinking_window_reference_versions
    where status = 'active';
    if v_active is null or v_active is distinct from p_expected_version_id then
        raise exception using errcode = '40001',
            message = 'The active reference version changed';
    end if;
    update private.drinking_window_runtime_switch
    set enabled = p_enabled, version_id = v_active, changed_at = now()
    where singleton;
    insert into private.drinking_window_runtime_events
        (version_id, enabled, reason)
    values (v_active, p_enabled, trim(p_reason));
    return p_enabled;
end;
$$;
revoke all on function public.set_drinking_window_reference_enabled(boolean, uuid, text)
from public, anon, authenticated, powersync_role;
grant execute on function public.set_drinking_window_reference_enabled(boolean, uuid, text)
to service_role;

-- Owners can discover only their own reports; the detailed report and verdict
-- still flow through the hash-bound RPCs installed in the preceding step.
create function public.list_drinking_window_shadow_reports(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_result jsonb;
begin
    if not exists (
        select 1 from public.household_members m
        where m.household_id = p_household_id
          and m.user_id = auth.uid() and m.role = 'owner'
    ) then
        raise exception using errcode = '42501',
            message = 'Only the household owner can list shadow reports';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'report_id', report.id,
        'version_number', version.version_number,
        'version_status', version.status,
        'wine_count', report.wine_count,
        'draft_issue_count', report.draft_issue_count,
        'recorded_at', report.recorded_at,
        'latest_verdict', decision.verdict
    ) order by report.report_sequence desc), '[]'::jsonb)
    into v_result
    from (
        select * from private.drinking_window_shadow_reports r
        where r.household_id = p_household_id
        order by r.report_sequence desc limit 10
    ) report
    join public.drinking_window_reference_versions version
      on version.id = report.version_id
    left join lateral (
        select d.verdict from private.drinking_window_shadow_decisions d
        where d.report_id = report.id
        order by d.decision_sequence desc limit 1
    ) decision on true;
    return v_result;
end;
$$;
revoke all on function public.list_drinking_window_shadow_reports(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.list_drinking_window_shadow_reports(uuid)
to authenticated;

commit;
