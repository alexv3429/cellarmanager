begin;

-- Publishing makes a reviewed version available; it does not opt every
-- household into new advice. A household keeps its selected published version
-- until its owner reviews a newer one. The global runtime switch remains an
-- emergency stop for all reference advice.
create table private.drinking_window_household_rollouts (
    household_id uuid primary key references public.households(id) on delete cascade,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    approved_report_id uuid not null references private.drinking_window_shadow_reports(id),
    enabled boolean not null default true,
    changed_at timestamptz not null default now()
);
revoke all on private.drinking_window_household_rollouts
from public, anon, authenticated, powersync_role, service_role;

create table private.drinking_window_household_rollout_events (
    id bigint generated always as identity primary key,
    household_id uuid not null references public.households(id) on delete cascade,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    report_id uuid references private.drinking_window_shadow_reports(id) on delete set null,
    enabled boolean not null,
    reason text not null,
    changed_at timestamptz not null default now()
);
revoke all on private.drinking_window_household_rollout_events
from public, anon, authenticated, powersync_role, service_role;
create trigger drinking_window_household_rollout_events_immutable
before update on private.drinking_window_household_rollout_events
for each row execute function private.reject_drinking_window_shadow_update();

-- The existing owner-review RPC verifies the report hash, owner role, current
-- cellar snapshot and preflight before inserting an approval. Its insert is
-- the sole way to activate a published version for a household.
create function private.apply_drinking_window_owner_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    v_report private.drinking_window_shadow_reports%rowtype;
    v_status text;
begin
    select * into v_report from private.drinking_window_shadow_reports
    where id = new.report_id;
    select status into v_status from public.drinking_window_reference_versions
    where id = v_report.version_id;
    if v_status <> 'active' then
        return new;
    end if;
    if exists (
        select 1 from private.drinking_window_shadow_reports later
        where later.household_id = v_report.household_id
          and later.version_id = v_report.version_id
          and later.report_sequence > v_report.report_sequence
    ) then
        raise exception using errcode = '40001',
            message = 'Review the latest household comparison';
    end if;
    if new.verdict = 'approve' then
        insert into private.drinking_window_household_rollouts
            (household_id, version_id, approved_report_id, enabled)
        values (v_report.household_id, v_report.version_id, v_report.id, true)
        on conflict (household_id) do update set
            version_id = excluded.version_id,
            approved_report_id = excluded.approved_report_id,
            enabled = true, changed_at = now();
    else
        update private.drinking_window_household_rollouts
        set enabled = false, changed_at = now()
        where household_id = v_report.household_id
          and version_id = v_report.version_id;
    end if;
    insert into private.drinking_window_household_rollout_events
        (household_id, version_id, report_id, enabled, reason)
    values (v_report.household_id, v_report.version_id, v_report.id,
        new.verdict = 'approve', 'Owner reviewed the full-cellar comparison');
    return new;
end;
$$;
revoke all on function private.apply_drinking_window_owner_decision()
from public, anon, authenticated, powersync_role, service_role;
create trigger drinking_window_owner_decision_rollout
after insert on private.drinking_window_shadow_decisions
for each row execute function private.apply_drinking_window_owner_decision();

-- The latest approved report for at least one affected household is a pilot
-- gate. Unrelated households cannot veto publication and do not switch advice.
create or replace function public.publish_drinking_window_reference(p_version_id uuid)
returns table (version_id uuid, content_sha256 text,
    replaced_version_id uuid, reviewed_household_count integer)
language plpgsql security definer set search_path = '' as $$
declare
    v_hash text;
    v_previous uuid;
    v_report private.drinking_window_shadow_reports%rowtype;
    v_decision private.drinking_window_shadow_decisions%rowtype;
    v_snapshot jsonb;
    v_reviewed integer := 0;
    v_pilot_reports uuid[] := array[]::uuid[];
begin
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
        private.drinking_window_shadow_decisions,
        private.drinking_window_household_rollouts
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

    for v_report in
        select r.* from private.drinking_window_shadow_reports r
        where r.version_id = p_version_id
          and r.report_sequence = (
              select max(latest.report_sequence)
              from private.drinking_window_shadow_reports latest
              where latest.version_id = p_version_id
                and latest.household_id = r.household_id
          )
        order by r.household_id
    loop
        if v_report.draft_sha256 <> v_hash
           or v_report.draft_issue_count <> 0 then
            continue;
        end if;
        select * into v_decision from private.drinking_window_shadow_decisions d
        where d.report_id = v_report.id
        order by d.decision_sequence desc limit 1;
        if not found or v_decision.verdict <> 'approve'
           or v_decision.content_sha256 <> v_report.content_sha256
           or not exists (
               select 1 from public.household_members m
               where m.household_id = v_report.household_id
                 and m.user_id = v_decision.reviewer_id and m.role = 'owner'
           ) then
            continue;
        end if;
        -- A pilot must actually exercise a non-manual reference match.
        if not exists (
            select 1 from jsonb_array_elements(v_report.rows) as item(value)
            where item.value ->> 'draft_status' = 'draft_match'
              and item.value ->> 'current_source' <> 'manual_override'
        ) then
            continue;
        end if;
        v_snapshot := private.drinking_window_shadow_snapshot(
            p_version_id, v_report.household_id
        );
        if v_snapshot ->> 'content_sha256' <> v_report.content_sha256
           or (v_snapshot ->> 'draft_issue_count')::bigint <> 0 then
            -- One stale pilot does not veto another current pilot.
            continue;
        end if;
        v_reviewed := v_reviewed + 1;
        v_pilot_reports := array_append(v_pilot_reports, v_report.id);
    end loop;
    if v_reviewed = 0 then
        raise exception using errcode = '23514',
            message = 'At least one affected household owner must approve a current full-cellar pilot';
    end if;

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

    -- Only the pilot households whose current reports passed the checks above
    -- switch now. All other households retain their previous selection/model.
    for v_report in
        select r.* from private.drinking_window_shadow_reports r
        where r.id = any(v_pilot_reports)
        order by r.household_id
    loop
        insert into private.drinking_window_household_rollouts
            (household_id, version_id, approved_report_id, enabled)
        values (v_report.household_id, p_version_id, v_report.id, true)
        on conflict (household_id) do update set
            version_id = excluded.version_id,
            approved_report_id = excluded.approved_report_id,
            enabled = true, changed_at = now();
        insert into private.drinking_window_household_rollout_events
            (household_id, version_id, report_id, enabled, reason)
        values (v_report.household_id, p_version_id, v_report.id, true,
            'Approved pilot activated at publication');
    end loop;
    return query select p_version_id, v_hash, v_previous, v_reviewed;
end;
$$;

-- Published versions are immutable. Reuse the exact canonical shadow selector for
-- later household reviews, while the old draft diagnostics still apply to drafts.
create or replace function public.drinking_window_preview_draft_match(
    p_version_id uuid,
    p_producer_id uuid,
    p_product_id uuid,
    p_release_id uuid,
    p_appellation_id uuid,
    p_region_id uuid,
    p_wine_color text,
    p_vintage_year integer,
    p_place_id uuid default null
)
returns table (
    status text,
    matched_scope text,
    reference_row_id uuid,
    first_trial_year integer,
    best_start_year integer,
    best_end_year integer,
    reason text
)
language plpgsql
stable
set search_path = ''
as $$
declare
    v_wine_place_id uuid;
    v_match record;
begin
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status in ('draft', 'active', 'superseded')
    ) then
        raise exception using errcode = '22023',
            message = 'A draft or published drinking-window reference version is required';
    end if;

    if p_region_id is null or p_wine_color is null or p_vintage_year is null then
        status := 'missing_key';
        reason := 'region_color_and_vintage_required';
        return next;
        return;
    end if;
    if p_vintage_year not between 1800 and 2200
       or p_wine_color not in (
           'red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other'
       ) then
        status := 'identity_conflict';
        reason := 'invalid_color_or_vintage';
        return next;
        return;
    end if;
    if not exists (
        select 1 from public.enrichment_places p
        where p.id = p_region_id and p.place_type in ('region', 'subregion')
    ) then
        status := 'identity_conflict';
        reason := 'invalid_region';
        return next;
        return;
    end if;
    if p_appellation_id is not null and not exists (
        select 1 from public.enrichment_places p
        where p.id = p_appellation_id and p.place_type = 'appellation'
          and private.drinking_window_place_contains(p_region_id, p.id)
    ) then
        status := 'identity_conflict';
        reason := 'appellation_outside_region';
        return next;
        return;
    end if;
    if p_place_id is not null and not private.drinking_window_place_contains(
        coalesce(p_appellation_id, p_region_id), p_place_id
    ) then
        status := 'identity_conflict';
        reason := 'place_outside_wine';
        return next;
        return;
    end if;
    if p_producer_id is not null and not exists (
        select 1 from public.wine_reference_producers p where p.id = p_producer_id
    ) then
        status := 'identity_conflict';
        reason := 'unknown_producer';
        return next;
        return;
    end if;
    if p_product_id is not null and not exists (
        select 1 from public.wine_reference_products p
        where p.id = p_product_id
          and (p_producer_id is null or p.producer_id = p_producer_id)
    ) then
        status := 'identity_conflict';
        reason := 'product_producer_mismatch';
        return next;
        return;
    end if;
    if p_release_id is not null and not exists (
        select 1 from public.wine_reference_releases r
        where r.id = p_release_id and r.vintage_year = p_vintage_year
          and (p_product_id is null or r.product_id = p_product_id)
          and (p_producer_id is null or exists (
              select 1 from public.wine_reference_products p
              where p.id = r.product_id and p.producer_id = p_producer_id
          ))
    ) then
        status := 'identity_conflict';
        reason := 'release_identity_mismatch';
        return next;
        return;
    end if;

    v_wine_place_id := coalesce(p_place_id, p_appellation_id, p_region_id);
    with candidates as (
        select r.*,
            case r.scope when 'release' then 1
                when 'producer_appellation' then 2
                when 'producer_region' then 3
                when 'appellation' then 4
                else 5 end as priority
        from public.drinking_window_reference_rows r
        where r.version_id = p_version_id
          and r.region_id = p_region_id
          and r.wine_color = p_wine_color
          and r.vintage_year = p_vintage_year
          and (
              (r.scope = 'release'
                  and r.release_id = p_release_id
                  and r.product_id = p_product_id
                  and r.producer_id = p_producer_id
                  and r.appellation_id = p_appellation_id)
              or (r.scope = 'producer_appellation'
                  and r.producer_id = p_producer_id
                  and r.appellation_id = p_appellation_id)
              or (r.scope = 'producer_region'
                  and r.producer_id = p_producer_id)
              or (r.scope = 'appellation'
                  and r.appellation_id = p_appellation_id)
              or r.scope = 'region'
          )
          and (
              r.all_at_scope
              or exists (
                  select 1 from public.drinking_window_ageing_groups g
                  join public.drinking_window_ageing_group_memberships m
                    on m.group_id = g.id and m.version_id = g.version_id
                  where g.id = r.ageing_group_id
                    and g.version_id = r.version_id
                    and g.producer_id is not distinct from r.producer_id
                    and g.appellation_id is not distinct from r.appellation_id
                    and (m.first_vintage_year is null
                         or m.first_vintage_year <= p_vintage_year)
                    and (m.last_vintage_year is null
                         or m.last_vintage_year >= p_vintage_year)
                    and private.drinking_window_place_contains(
                        m.member_place_id, v_wine_place_id
                    )
                    and (
                        m.member_kind = 'place'
                        or (m.member_kind = 'product'
                            and m.member_product_id = p_product_id)
                        or (m.member_kind = 'release'
                            and m.member_release_id = p_release_id)
                    )
              )
          )
    ), ranked as (
        select c.*, count(*) over (partition by c.priority) as ties
        from candidates c
    )
    select r.id, r.scope, r.first_trial_year, r.best_start_year,
        r.best_end_year, r.ties
    into v_match
    from ranked r
    order by r.priority, r.id
    limit 1;

    if not found then
        status := 'no_match';
        reason := 'no_applicable_draft_row';
        return next;
        return;
    end if;
    if v_match.ties > 1 then
        status := 'ambiguous';
        reason := 'multiple_rows_at_same_scope';
        return next;
        return;
    end if;

    status := 'draft_match';
    matched_scope := v_match.scope;
    reference_row_id := v_match.id;
    first_trial_year := v_match.first_trial_year;
    best_start_year := v_match.best_start_year;
    best_end_year := v_match.best_end_year;
    return next;
end;
$$;

create or replace function public.drinking_window_publication_issues(p_version_id uuid)
returns table (
    check_name text, issue_code text, subject_kind text,
    subject_id uuid, related_id uuid
)
language plpgsql
stable
set search_path = ''
as $$
begin
    if exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status in ('active', 'superseded')
          and v.content_sha256 is not null
    ) then
        return;
    end if;
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft'
    ) then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;

    return query
    select 'structure'::text, i.issue_code, i.subject_kind,
        i.subject_id, i.related_id
    from public.drinking_window_draft_issues(p_version_id) i
    union all
    select 'eligibility'::text, i.issue_code, i.subject_kind,
        i.subject_id, i.related_id
    from public.drinking_window_eligibility_issues(p_version_id) i
    union all
    select 'evidence_fit'::text, i.issue_code, i.subject_kind,
        i.subject_id, i.related_id
    from public.drinking_window_evidence_fit_issues(p_version_id) i
    union all
    select 'review'::text, i.issue_code, i.subject_kind,
        i.subject_id, i.related_id
    from public.drinking_window_review_issues(p_version_id) i;
end;
$$;

create or replace function public.drinking_window_draft_fingerprint(p_version_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
    v_snapshot jsonb;
    v_published_hash text;
begin
    select v.content_sha256 into v_published_hash
    from public.drinking_window_reference_versions v
    where v.id = p_version_id and v.status in ('active', 'superseded');
    if found and v_published_hash is not null then
        return v_published_hash;
    end if;
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft'
    ) then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;

    select jsonb_build_object(
        'version_id', p_version_id,
        'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
            from public.drinking_window_reference_rows r
            where r.version_id = p_version_id),
        'groups', (select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb)
            from public.drinking_window_ageing_groups g
            where g.version_id = p_version_id),
        'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
            from public.drinking_window_ageing_group_memberships m
            where m.version_id = p_version_id),
        'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
            'link', to_jsonb(l), 'evidence', to_jsonb(e),
            'source', to_jsonb(s), 'policy', to_jsonb(p)
        ) order by l.id), '[]'::jsonb)
            from public.drinking_window_reference_evidence l
            join public.enrichment_evidence e on e.id = l.evidence_id
            join public.enrichment_sources s on s.id = e.source_id
            join public.enrichment_source_policies p on p.id = e.source_policy_id
            where l.version_id = p_version_id),
        'reviews', (select coalesce(jsonb_agg(jsonb_build_object(
            'review', to_jsonb(r), 'curator', to_jsonb(c)
        ) order by r.decision_sequence), '[]'::jsonb)
            from public.drinking_window_reference_reviews r
            join public.enrichment_curator_eligibilities c
              on c.user_id = r.curator_id
            where r.version_id = p_version_id)
    ) into v_snapshot;

    return pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_snapshot::text, 'UTF8'), 'sha256'
    ), 'hex');
end;
$$;

create or replace function private.drinking_window_active_match(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_version public.drinking_window_reference_versions%rowtype;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_color text;
    v_match record;
begin
    select * into v_wine from public.wines w
    where w.id = p_wine_id and w.merged_into_wine_id is null;
    if not found then
        return jsonb_build_object('status', 'missing_key',
            'reason', 'wine_not_found');
    end if;
    if not exists (
        select 1 from private.drinking_window_runtime_switch s
        where s.singleton and s.enabled
    ) then
        return jsonb_build_object('status', 'unpublished');
    end if;
    select v.* into v_version
    from private.drinking_window_household_rollouts h
    join public.drinking_window_reference_versions v on v.id = h.version_id
    join private.drinking_window_publications p on p.version_id = v.id
    where h.household_id = v_wine.household_id and h.enabled
      and v.status in ('active', 'superseded')
      and p.content_sha256 = v.content_sha256;
    if not found then
        return jsonb_build_object('status', 'unpublished');
    end if;
    v_color := private.canonical_enrichment_wine_color(v_wine.color);
    if v_wine.vintage is null or v_color is null or v_wine.area is null then
        return jsonb_build_object('status', 'missing_key',
            'reason', 'region_color_and_vintage_required');
    end if;
    select array_agg(distinct p.id) into v_region_ids
    from (
        select place.id from public.enrichment_places place
        where place.place_type in ('region', 'subregion')
          and place.normalized_name = private.normalize_wine_reference_text(v_wine.area)
        union
        select place.id from public.enrichment_place_aliases alias
        join public.enrichment_places place on place.id = alias.place_id
        where place.place_type in ('region', 'subregion')
          and alias.normalized_value = private.normalize_wine_reference_text(v_wine.area)
    ) p;
    if coalesce(cardinality(v_region_ids), 0) <> 1 then
        return jsonb_build_object('status', 'missing_key',
            'reason', 'region_not_confirmed');
    end if;
    v_region_id := v_region_ids[1];

    if v_wine.appellation is not null and trim(v_wine.appellation) <> '' then
        select array_agg(distinct p.id) into v_appellation_ids
        from (
            select place.id from public.enrichment_places place
            where place.place_type = 'appellation'
              and place.normalized_name = private.normalize_wine_reference_text(v_wine.appellation)
            union
            select place.id from public.enrichment_place_aliases alias
            join public.enrichment_places place on place.id = alias.place_id
            where place.place_type = 'appellation'
              and alias.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
        ) p;
        if coalesce(cardinality(v_appellation_ids), 0) <> 1 then
            return jsonb_build_object('status', 'missing_key',
                'reason', 'appellation_not_confirmed');
        end if;
        v_appellation_id := v_appellation_ids[1];
        if not private.drinking_window_place_contains(
            v_region_id, v_appellation_id
        ) then
            return jsonb_build_object('status', 'identity_conflict',
                'reason', 'appellation_outside_region');
        end if;
    end if;

    if v_wine.wine_reference_type = 'release' then
        select release.id, product.id, product.producer_id
        into v_release_id, v_product_id, v_producer_id
        from public.wine_reference_releases release
        join public.wine_reference_products product
          on product.id = release.product_id
        where release.id = v_wine.wine_reference_id
          and release.vintage_year = v_wine.vintage;
    elsif v_wine.wine_reference_type = 'product' then
        select product.id, product.producer_id
        into v_product_id, v_producer_id
        from public.wine_reference_products product
        where product.id = v_wine.wine_reference_id;
    end if;
    if v_wine.wine_reference_id is not null and v_producer_id is null then
        return jsonb_build_object('status', 'identity_conflict',
            'reason', 'wine_reference_mismatch');
    end if;

    with candidates as (
        select r.*,
            case r.scope when 'release' then 1
                when 'producer_appellation' then 2
                when 'producer_region' then 3
                when 'appellation' then 4 else 5 end as priority
        from public.drinking_window_reference_rows r
        where r.version_id = v_version.id
          and r.region_id = v_region_id
          and r.wine_color = v_color
          and r.vintage_year = v_wine.vintage
          and (
              (r.scope = 'release' and r.release_id = v_release_id
                  and r.product_id = v_product_id
                  and r.producer_id = v_producer_id
                  and r.appellation_id = v_appellation_id)
              or (r.scope = 'producer_appellation'
                  and r.producer_id = v_producer_id
                  and r.appellation_id = v_appellation_id)
              or (r.scope = 'producer_region'
                  and r.producer_id = v_producer_id)
              or (r.scope = 'appellation'
                  and r.appellation_id = v_appellation_id)
              or r.scope = 'region'
          )
          and (r.all_at_scope or exists (
              select 1 from public.drinking_window_ageing_groups g
              join public.drinking_window_ageing_group_memberships m
                on m.group_id = g.id and m.version_id = g.version_id
              where g.id = r.ageing_group_id and g.version_id = r.version_id
                and g.producer_id is not distinct from r.producer_id
                and g.appellation_id is not distinct from r.appellation_id
                and (m.first_vintage_year is null
                     or m.first_vintage_year <= v_wine.vintage)
                and (m.last_vintage_year is null
                     or m.last_vintage_year >= v_wine.vintage)
                and private.drinking_window_place_contains(
                    m.member_place_id, coalesce(v_appellation_id, v_region_id)
                )
                and (m.member_kind = 'place'
                    or (m.member_kind = 'product'
                        and m.member_product_id = v_product_id)
                    or (m.member_kind = 'release'
                        and m.member_release_id = v_release_id))
          ))
    ), ranked as (
        select c.*, count(*) over (partition by c.priority) as ties
        from candidates c
    )
    select * into v_match from ranked
    order by priority, id limit 1;
    if not found then
        return jsonb_build_object('status', 'no_match',
            'reason', 'no_applicable_published_row');
    end if;
    if v_match.ties > 1 then
        return jsonb_build_object('status', 'ambiguous',
            'reason', 'multiple_rows_at_same_scope');
    end if;
    return jsonb_build_object(
        'status', 'match', 'version_id', v_version.id,
        'version_number', v_version.version_number,
        'version_sha256', v_version.content_sha256,
        'reference_row_id', v_match.id, 'matched_scope', v_match.scope,
        'first_trial_year', v_match.first_trial_year,
        'best_start_year', v_match.best_start_year,
        'best_end_year', v_match.best_end_year,
        'rationale', v_match.rationale
    );
end;
$$;

-- An owner can ask for a fresh comparison after publication, including a
-- household that did not exist during the pilot. It never enables advice by
-- itself. The existing hash-bound owner decision is still required.
create function public.request_drinking_window_shadow_report(p_household_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    v_version uuid;
    v_report uuid;
begin
    if not exists (
        select 1 from public.household_members m
        where m.household_id = p_household_id
          and m.user_id = auth.uid() and m.role = 'owner'
    ) then
        raise exception using errcode = '42501',
            message = 'Only the household owner can request a comparison';
    end if;
    select v.id into v_version
    from public.drinking_window_reference_versions v
    join private.drinking_window_publications p on p.version_id = v.id
    where v.status = 'active' and v.content_sha256 = p.content_sha256;
    if v_version is null then
        raise exception using errcode = '22023',
            message = 'No published drinking-window reference is available';
    end if;
    select r.id into v_report from private.drinking_window_shadow_reports r
    where r.household_id = p_household_id and r.version_id = v_version
      and r.recorded_at > now() - interval '1 minute'
    order by r.report_sequence desc limit 1;
    if v_report is not null then return v_report; end if;
    select report_id into v_report
    from public.record_drinking_window_shadow_report(
        v_version, p_household_id
    );
    return v_report;
end;
$$;
revoke all on function public.request_drinking_window_shadow_report(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.request_drinking_window_shadow_report(uuid)
to authenticated;

create function public.get_drinking_window_rollout_status(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_active public.drinking_window_reference_versions%rowtype;
    v_selected public.drinking_window_reference_versions%rowtype;
    v_enabled boolean;
    v_global_enabled boolean;
begin
    if not exists (
        select 1 from public.household_members m
        where m.household_id = p_household_id
          and m.user_id = auth.uid() and m.role = 'owner'
    ) then
        raise exception using errcode = '42501',
            message = 'Only the household owner can inspect rollout status';
    end if;
    select * into v_active from public.drinking_window_reference_versions
    where status = 'active';
    select v.* into v_selected
    from private.drinking_window_household_rollouts h
    join public.drinking_window_reference_versions v on v.id = h.version_id
    where h.household_id = p_household_id;
    select h.enabled into v_enabled
    from private.drinking_window_household_rollouts h
    where h.household_id = p_household_id;
    select s.enabled into v_global_enabled
    from private.drinking_window_runtime_switch s where s.singleton;
    return jsonb_build_object(
        'active_version_number', v_active.version_number,
        'selected_version_number', v_selected.version_number,
        'selected_enabled', coalesce(v_enabled, false),
        'global_enabled', coalesce(v_global_enabled, false)
    );
end;
$$;
revoke all on function public.get_drinking_window_rollout_status(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.get_drinking_window_rollout_status(uuid)
to authenticated;

create or replace function public.drinking_window_shadow_compare(
    p_version_id uuid, p_household_id uuid, p_wine_ids uuid[]
)
returns table (
    wine_id uuid,
    draft_sha256 text,
    draft_issue_count bigint,
    identity_status text,
    draft_status text,
    comparison_status text,
    current_source text,
    current_projection_id uuid,
    current_first_trial_year integer,
    current_best_start_year integer,
    current_best_end_year integer,
    reference_row_id uuid,
    matched_scope text,
    proposed_first_trial_year integer,
    proposed_best_start_year integer,
    proposed_best_end_year integer,
    first_trial_delta integer,
    best_start_delta integer,
    best_end_delta integer,
    reason text
)
language plpgsql
stable
set search_path = ''
as $$
declare
    v_wine_id uuid;
    v_wine public.wines%rowtype;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_projection public.wine_enrichment_projections%rowtype;
    v_override public.wine_maturity_overrides%rowtype;
    v_match record;
    v_current_reference jsonb;
    v_hash text;
    v_issues bigint;
    v_identity_status text;
    v_current_source text;
    v_current_first integer;
    v_current_start integer;
    v_current_end integer;
    v_comparison text;
begin
    if p_household_id is null or p_wine_ids is null
       or cardinality(p_wine_ids) not between 1 and 250
       or array_position(p_wine_ids, null) is not null
       or (select count(distinct id) from unnest(p_wine_ids) as ids(id))
          <> cardinality(p_wine_ids) then
        raise exception using errcode = '22023',
            message = 'Provide one household and 1 to 250 distinct wine IDs';
    end if;

    -- These checks do not approve a draft. They make an unready comparison
    -- unmistakable and bind every row of the report to the same draft state.
    v_hash := public.drinking_window_draft_fingerprint(p_version_id);
    select count(*) into v_issues
    from public.drinking_window_publication_issues(p_version_id);

    foreach v_wine_id in array p_wine_ids loop
        select * into v_wine from public.wines w
        where w.id = v_wine_id and w.household_id = p_household_id
          and w.merged_into_wine_id is null;
        if not found then
            raise exception using errcode = '22023',
                message = 'Every wine must be active and belong to the requested household';
        end if;

        v_region_id := null;
        v_appellation_id := null;
        v_producer_id := null;
        v_product_id := null;
        v_release_id := null;
        v_identity_status := 'exact_place_and_reference';

        -- A text label resolves only when its normalized canonical name or
        -- reviewed alias identifies exactly one place of the right kind.
        select array_agg(distinct candidate.id) into v_region_ids
        from (
            select p.id from public.enrichment_places p
            where p.place_type in ('region', 'subregion')
              and p.normalized_name = private.normalize_wine_reference_text(v_wine.area)
            union
            select p.id from public.enrichment_place_aliases a
            join public.enrichment_places p on p.id = a.place_id
            where p.place_type in ('region', 'subregion')
              and a.normalized_value = private.normalize_wine_reference_text(v_wine.area)
        ) candidate;
        if cardinality(v_region_ids) = 1 then
            v_region_id := v_region_ids[1];
        else
            v_identity_status := 'region_unresolved';
        end if;

        if v_wine.appellation is not null then
            select array_agg(distinct candidate.id) into v_appellation_ids
            from (
                select p.id from public.enrichment_places p
                where p.place_type = 'appellation'
                  and p.normalized_name = private.normalize_wine_reference_text(v_wine.appellation)
                union
                select p.id from public.enrichment_place_aliases a
                join public.enrichment_places p on p.id = a.place_id
                where p.place_type = 'appellation'
                  and a.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
            ) candidate;
            if cardinality(v_appellation_ids) = 1 then
                v_appellation_id := v_appellation_ids[1];
            elsif v_identity_status = 'exact_place_and_reference' then
                v_identity_status := 'appellation_unresolved';
            end if;
        end if;

        -- Only an existing household link supplies producer/product/release.
        -- Never infer those identities from a similar-looking OCR string.
        if v_wine.wine_reference_type = 'release' then
            select r.id, p.id, p.producer_id
            into v_release_id, v_product_id, v_producer_id
            from public.wine_reference_releases r
            join public.wine_reference_products p on p.id = r.product_id
            where r.id = v_wine.wine_reference_id
              and r.vintage_year = v_wine.vintage;
        elsif v_wine.wine_reference_type = 'product' then
            select p.id, p.producer_id into v_product_id, v_producer_id
            from public.wine_reference_products p
            where p.id = v_wine.wine_reference_id;
        end if;
        if v_producer_id is null and v_identity_status = 'exact_place_and_reference' then
            v_identity_status := 'wine_reference_unlinked';
        end if;

        select * into v_override from public.wine_maturity_overrides o
        where o.household_id = p_household_id and o.wine_id = v_wine_id;
        select * into v_projection from public.wine_enrichment_projections p
        where p.household_id = p_household_id and p.wine_id = v_wine_id
          and p.projection_type = 'maturity' and p.context_key = ''
          and p.status = 'current';

        v_current_source := 'none';
        v_current_first := null;
        v_current_start := null;
        v_current_end := null;
        if v_override.wine_id is not null then
            v_current_source := 'manual_override';
            v_current_first := v_override.first_trial_year;
            v_current_start := v_override.best_start_year;
            v_current_end := v_override.best_end_year;
        elsif v_projection.id is not null then
            v_current_source := case
                when v_projection.valid_until <= now() then 'expired_model'
                else 'model' end;
            v_current_first := (v_projection.recommendation ->> 'first_trial_year')::integer;
            v_current_start := (v_projection.recommendation ->> 'best_start_year')::integer;
            v_current_end := (v_projection.recommendation ->> 'best_end_year')::integer;
        end if;

        select * into v_match
        from public.drinking_window_preview_draft_match(
            p_version_id, v_producer_id, v_product_id, v_release_id,
            v_appellation_id, v_region_id,
            private.canonical_enrichment_wine_color(v_wine.color),
            v_wine.vintage
        );

        -- Compare a new version with the household's currently selected
        -- published version, not merely with the old model projection.
        if v_current_source <> 'manual_override' then
            v_current_reference := private.drinking_window_active_match(v_wine_id);
            if v_current_reference ->> 'status' = 'match' then
                v_current_source := 'reviewed_reference';
                v_current_first := (v_current_reference ->> 'first_trial_year')::integer;
                v_current_start := (v_current_reference ->> 'best_start_year')::integer;
                v_current_end := (v_current_reference ->> 'best_end_year')::integer;
            end if;
        end if;

        v_comparison := case
            when v_current_source = 'manual_override' then 'manual_preserved'
            when v_match.status <> 'draft_match' then v_match.status
            when v_current_source = 'none' then 'new_reference_no_baseline'
            when v_current_source = 'expired_model' then 'expired_baseline'
            when (v_current_first, v_current_start, v_current_end)
                 = (v_match.first_trial_year, v_match.best_start_year,
                    v_match.best_end_year) then 'unchanged'
            else 'changed'
        end;

        return query select v_wine_id, v_hash, v_issues,
            v_identity_status, v_match.status, v_comparison,
            v_current_source, case when v_current_source = 'reviewed_reference'
                then null::uuid else v_projection.id end,
            v_current_first, v_current_start, v_current_end,
            v_match.reference_row_id, v_match.matched_scope,
            v_match.first_trial_year, v_match.best_start_year,
            v_match.best_end_year,
            case when v_match.status = 'draft_match' and v_current_first is not null
                then v_match.first_trial_year - v_current_first else null end,
            case when v_match.status = 'draft_match' and v_current_start is not null
                then v_match.best_start_year - v_current_start else null end,
            case when v_match.status = 'draft_match' and v_current_end is not null
                then v_match.best_end_year - v_current_end else null end,
            v_match.reason;
    end loop;
end;
$$;

commit;
