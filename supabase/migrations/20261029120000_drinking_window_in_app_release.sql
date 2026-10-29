begin;

-- Publication is a distinct, explicitly granted capability. A curator can
-- prepare and review a version but cannot make it active merely by doing so.
create table private.drinking_window_publishers (
    user_id uuid primary key references auth.users(id) on delete cascade,
    granted_by text not null check (length(pg_catalog.btrim(granted_by)) between 3 and 200),
    rationale text not null check (length(pg_catalog.btrim(rationale)) between 10 and 1000),
    granted_at timestamptz not null default now(),
    revoked_at timestamptz
);
revoke all on private.drinking_window_publishers from public, anon, authenticated, powersync_role;
grant select, insert, update on private.drinking_window_publishers to service_role;

create function private.require_drinking_window_publisher(p_user_id uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
    perform private.require_enrichment_curator(p_user_id, 'drinking-window');
    if not exists (select 1 from private.drinking_window_publishers p
        where p.user_id = p_user_id and p.revoked_at is null) then
        raise exception using errcode = '42501',
            message = 'Shared-reference publication requires a separate publisher grant';
    end if;
end;
$$;
revoke all on function private.require_drinking_window_publisher(uuid)
from public, anon, authenticated;

-- Copies an active or unpublished version as one snapshot, without copying
-- any approval, comparison, preflight or rollout. It is the working base for
-- many imported producer rows rather than one code PR/version per wine.
create function public.create_drinking_window_working_draft(p_base_version_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_base public.drinking_window_reference_versions%rowtype;
    v_version_id uuid := pg_catalog.gen_random_uuid();
    v_version_number integer;
    v_group public.drinking_window_ageing_groups%rowtype;
    v_row public.drinking_window_reference_rows%rowtype;
    v_member public.drinking_window_ageing_group_memberships%rowtype;
    v_link public.drinking_window_reference_evidence%rowtype;
    v_new_id uuid;
    v_group_map jsonb := '{}'::jsonb;
    v_row_map jsonb := '{}'::jsonb;
    v_member_map jsonb := '{}'::jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    select * into v_base from public.drinking_window_reference_versions
    where id = p_base_version_id and status in ('draft', 'active') for share;
    if not found then
        raise exception using errcode = '22023', message = 'Choose a current draft or active reference';
    end if;
    lock table public.drinking_window_ageing_groups,
        public.drinking_window_reference_rows,
        public.drinking_window_ageing_group_memberships,
        public.drinking_window_reference_evidence in share mode;
    select coalesce(pg_catalog.max(version_number), 0) + 1 into v_version_number
    from public.drinking_window_reference_versions;
    insert into public.drinking_window_reference_versions(id, version_number)
    values (v_version_id, v_version_number);
    for v_group in select * from public.drinking_window_ageing_groups
        where version_id = v_base.id order by id loop
        v_new_id := pg_catalog.gen_random_uuid();
        insert into public.drinking_window_ageing_groups (
            id, version_id, scope, region_id, wine_color, group_key,
            definition, producer_id, appellation_id
        ) values (
            v_new_id, v_version_id, v_group.scope, v_group.region_id,
            v_group.wine_color, v_group.group_key, v_group.definition,
            v_group.producer_id, v_group.appellation_id
        );
        v_group_map := v_group_map || pg_catalog.jsonb_build_object(v_group.id::text, v_new_id);
    end loop;
    for v_row in select * from public.drinking_window_reference_rows
        where version_id = v_base.id order by id loop
        v_new_id := pg_catalog.gen_random_uuid();
        insert into public.drinking_window_reference_rows (
            id, version_id, scope, producer_id, product_id, release_id,
            appellation_id, region_id, wine_color, vintage_year,
            ageing_group_id, all_at_scope, first_trial_year,
            best_start_year, best_end_year, rationale, format_ml
        ) values (
            v_new_id, v_version_id, v_row.scope, v_row.producer_id,
            v_row.product_id, v_row.release_id, v_row.appellation_id,
            v_row.region_id, v_row.wine_color, v_row.vintage_year,
            (v_group_map ->> v_row.ageing_group_id::text)::uuid,
            v_row.all_at_scope, v_row.first_trial_year, v_row.best_start_year,
            v_row.best_end_year, v_row.rationale, v_row.format_ml
        );
        v_row_map := v_row_map || pg_catalog.jsonb_build_object(v_row.id::text, v_new_id);
    end loop;
    for v_member in select * from public.drinking_window_ageing_group_memberships
        where version_id = v_base.id order by id loop
        v_new_id := pg_catalog.gen_random_uuid();
        insert into public.drinking_window_ageing_group_memberships (
            id, version_id, group_id, member_kind, member_place_id,
            member_product_id, member_release_id, first_vintage_year,
            last_vintage_year, rationale
        ) values (
            v_new_id, v_version_id,
            (v_group_map ->> v_member.group_id::text)::uuid,
            v_member.member_kind, v_member.member_place_id,
            v_member.member_product_id, v_member.member_release_id,
            v_member.first_vintage_year, v_member.last_vintage_year,
            v_member.rationale
        );
        v_member_map := v_member_map || pg_catalog.jsonb_build_object(v_member.id::text, v_new_id);
    end loop;
    for v_link in select * from public.drinking_window_reference_evidence
        where version_id = v_base.id order by id loop
        insert into public.drinking_window_reference_evidence (
            version_id, reference_row_id, ageing_group_id, membership_id,
            evidence_id, claim_part, evidence_role
        ) values (
            v_version_id,
            (v_row_map ->> v_link.reference_row_id::text)::uuid,
            (v_group_map ->> v_link.ageing_group_id::text)::uuid,
            (v_member_map ->> v_link.membership_id::text)::uuid,
            v_link.evidence_id, v_link.claim_part, v_link.evidence_role
        );
    end loop;
    return pg_catalog.jsonb_build_object('version_id', v_version_id,
        'version_number', v_version_number, 'base_version_id', v_base.id);
end;
$$;
revoke all on function public.create_drinking_window_working_draft(uuid) from public, anon;
grant execute on function public.create_drinking_window_working_draft(uuid) to authenticated;

create function public.get_drinking_window_release_workspace()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    return pg_catalog.jsonb_build_object(
        'can_publish', exists(select 1 from private.drinking_window_publishers p
            where p.user_id = auth.uid() and p.revoked_at is null),
        'versions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'version_id', v.id, 'version_number', v.version_number,
            'status', v.status, 'row_count', (select count(*) from public.drinking_window_reference_rows r
                where r.version_id = v.id),
            'latest_preflight', (select pg_catalog.jsonb_build_object(
                'issue_count', p.issue_count, 'content_sha256', p.content_sha256,
                'checked_at', p.checked_at)
                from private.drinking_window_publication_preflights p
                where p.version_id = v.id order by p.checked_at desc limit 1)
        ) order by v.version_number desc) from public.drinking_window_reference_versions v
        where v.status in ('draft', 'active')), '[]'::jsonb)
    );
end;
$$;
revoke all on function public.get_drinking_window_release_workspace() from public, anon;
grant execute on function public.get_drinking_window_release_workspace() to authenticated;

create function public.check_drinking_window_working_draft(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_report record;
    v_issues jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select * into v_report from public.record_drinking_window_publication_preflight(p_version_id);
    select p.issues into v_issues from private.drinking_window_publication_preflights p
    where p.id = v_report.preflight_id;
    return pg_catalog.jsonb_build_object('preflight_id', v_report.preflight_id,
        'content_sha256', v_report.content_sha256,
        'issue_count', v_report.issue_count, 'issues', v_issues);
end;
$$;
revoke all on function public.check_drinking_window_working_draft(uuid) from public, anon;
grant execute on function public.check_drinking_window_working_draft(uuid) to authenticated;

-- The owner of a pilot cellar can request its comparison once the draft is
-- structurally ready. No other household's wine data or advice is exposed.
create function public.request_drinking_window_working_draft_pilot(
    p_version_id uuid, p_household_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_report_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if not exists (select 1 from public.household_members m
        where m.household_id = p_household_id and m.user_id = auth.uid() and m.role = 'owner') then
        raise exception using errcode = '42501', message = 'Only this cellar owner can request a pilot';
    end if;
    if not exists (select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft')
       or exists (select 1 from public.drinking_window_publication_issues(p_version_id)) then
        raise exception using errcode = '23514', message = 'Review and correct this draft before a pilot';
    end if;
    select recorded.report_id into v_report_id
    from public.record_drinking_window_shadow_report(p_version_id, p_household_id) recorded;
    return v_report_id;
end;
$$;
revoke all on function public.request_drinking_window_working_draft_pilot(uuid,uuid)
from public, anon;
grant execute on function public.request_drinking_window_working_draft_pilot(uuid,uuid)
to authenticated;

create function public.publish_reviewed_drinking_window_draft(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_result record;
begin
    perform private.require_drinking_window_publisher(auth.uid());
    select * into v_result from public.publish_drinking_window_reference(p_version_id);
    return pg_catalog.jsonb_build_object('version_id', v_result.version_id,
        'content_sha256', v_result.content_sha256,
        'replaced_version_id', v_result.replaced_version_id,
        'reviewed_household_count', v_result.reviewed_household_count);
end;
$$;
revoke all on function public.publish_reviewed_drinking_window_draft(uuid) from public, anon;
grant execute on function public.publish_reviewed_drinking_window_draft(uuid) to authenticated;

commit;
