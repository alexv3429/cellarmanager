begin;

-- A household comparison is reviewed by a person, while the existing model
-- timing adjustment belongs to that person. Bind new reports to their owner
-- so a later service-side publication replays the same visible baseline.
alter table private.drinking_window_shadow_reports
    add column requested_by uuid references auth.users(id)
    default auth.uid();
create index drinking_window_shadow_reports_owner_idx
    on private.drinking_window_shadow_reports
    (household_id, requested_by, report_sequence desc);

create function private.require_shadow_report_reviewer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    v_owner uuid;
begin
    select report.requested_by into v_owner
    from private.drinking_window_shadow_reports report
    where report.id = new.report_id;
    if v_owner is null or v_owner <> new.reviewer_id then
        raise exception using errcode = '42501',
            message = 'Request a fresh comparison for your own timing before reviewing';
    end if;
    if exists (
        select 1 from private.drinking_window_shadow_reports later
        join private.drinking_window_shadow_reports current_report
          on current_report.id = new.report_id
        where later.household_id = current_report.household_id
          and later.version_id = current_report.version_id
          and later.report_sequence > current_report.report_sequence
    ) then
        raise exception using errcode = '40001',
            message = 'A newer cellar comparison exists; review that report';
    end if;
    return new;
end;
$$;
revoke all on function private.require_shadow_report_reviewer()
    from public, anon, authenticated, powersync_role, service_role;
create trigger drinking_window_shadow_decision_owner
before insert on private.drinking_window_shadow_decisions
for each row execute function private.require_shadow_report_reviewer();

-- Keep the tested raw selector available only to this wrapper. The wrapper
-- changes the baseline, not the draft matcher or reference dates.
alter function public.drinking_window_shadow_compare(uuid, uuid, uuid[])
    rename to drinking_window_shadow_compare_before_owner_timing;
revoke all on function public.drinking_window_shadow_compare_before_owner_timing(uuid, uuid, uuid[])
    from public, anon, authenticated, powersync_role, service_role;

create function public.drinking_window_shadow_compare(
    p_version_id uuid, p_household_id uuid, p_wine_ids uuid[]
)
returns table (
    wine_id uuid, draft_sha256 text, draft_issue_count bigint,
    identity_status text, draft_status text, comparison_status text,
    current_source text, current_projection_id uuid,
    current_first_trial_year integer, current_best_start_year integer,
    current_best_end_year integer, reference_row_id uuid, matched_scope text,
    proposed_first_trial_year integer, proposed_best_start_year integer,
    proposed_best_end_year integer, first_trial_delta integer,
    best_start_delta integer, best_end_delta integer, reason text
)
language sql stable security definer set search_path = '' as $$
    with viewer as (
        select case
            when exists (
                select 1 from public.household_members m
                where m.household_id = p_household_id
                  and m.user_id = auth.uid() and m.role = 'owner'
            ) then auth.uid()
            else (
                select report.requested_by
                from private.drinking_window_shadow_reports report
                where report.version_id = p_version_id
                  and report.household_id = p_household_id
                order by report.report_sequence desc limit 1
            )
        end as user_id
    ), timing as (
        select coalesce((
            select calibration.year_shift
            from private.member_maturity_calibrations calibration
            where calibration.user_id = viewer.user_id
        ), 0) as year_shift
        from viewer
    ), raw as (
        select comparison.*,
            timing.year_shift,
            case when comparison.current_source in ('model', 'expired_model')
                then private.drinking_window_active_match(comparison.wine_id)
                    ->> 'status'
                else null end as active_status
        from public.drinking_window_shadow_compare_before_owner_timing(
            p_version_id, p_household_id, p_wine_ids
        ) comparison cross join timing
    ), effective as (
        select raw.*,
            case
                when raw.active_status in ('identity_conflict', 'ambiguous')
                    then 'none'
                when raw.current_source = 'model' and raw.year_shift <> 0
                    then 'personalized_model'
                when raw.current_source = 'expired_model' and raw.year_shift <> 0
                    then 'expired_personalized_model'
                else raw.current_source
            end as visible_source,
            case when raw.active_status in ('identity_conflict', 'ambiguous')
                    then null
                when raw.current_source in ('model', 'expired_model')
                    then raw.current_first_trial_year + raw.year_shift
                else raw.current_first_trial_year end as visible_first,
            case when raw.active_status in ('identity_conflict', 'ambiguous')
                    then null
                when raw.current_source in ('model', 'expired_model')
                    then raw.current_best_start_year + raw.year_shift
                else raw.current_best_start_year end as visible_start,
            case when raw.active_status in ('identity_conflict', 'ambiguous')
                    then null
                when raw.current_source in ('model', 'expired_model')
                    then raw.current_best_end_year + raw.year_shift
                else raw.current_best_end_year end as visible_end
        from raw
    )
    select effective.wine_id, effective.draft_sha256,
        effective.draft_issue_count, effective.identity_status,
        effective.draft_status,
        case
            when effective.visible_source = 'manual_override'
                then 'manual_preserved'
            when effective.draft_status <> 'draft_match'
                then effective.draft_status
            when effective.visible_source = 'none'
                then 'new_reference_no_baseline'
            when effective.visible_source in
                ('expired_model', 'expired_personalized_model')
                then 'expired_baseline'
            when (effective.visible_first, effective.visible_start,
                  effective.visible_end) =
                 (effective.proposed_first_trial_year,
                  effective.proposed_best_start_year,
                  effective.proposed_best_end_year) then 'unchanged'
            else 'changed'
        end,
        effective.visible_source,
        case when effective.visible_source = 'none' then null::uuid
            else effective.current_projection_id end,
        effective.visible_first, effective.visible_start, effective.visible_end,
        effective.reference_row_id, effective.matched_scope,
        effective.proposed_first_trial_year,
        effective.proposed_best_start_year,
        effective.proposed_best_end_year,
        case when effective.draft_status = 'draft_match'
                  and effective.visible_first is not null
            then effective.proposed_first_trial_year - effective.visible_first
            else null end,
        case when effective.draft_status = 'draft_match'
                  and effective.visible_start is not null
            then effective.proposed_best_start_year - effective.visible_start
            else null end,
        case when effective.draft_status = 'draft_match'
                  and effective.visible_end is not null
            then effective.proposed_best_end_year - effective.visible_end
            else null end,
        effective.reason
    from effective;
$$;
revoke all on function public.drinking_window_shadow_compare(uuid, uuid, uuid[])
    from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_shadow_compare(uuid, uuid, uuid[])
    to service_role;

-- Each request makes a fresh report. Even a report from the same owner a few
-- seconds earlier can be stale after a timing, wine, or reference change.
create or replace function public.request_drinking_window_shadow_report(p_household_id uuid)
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
    select report_id into v_report
    from public.record_drinking_window_shadow_report(
        v_version, p_household_id
    );
    return v_report;
end;
$$;

create or replace function public.list_drinking_window_shadow_reports(p_household_id uuid)
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
          and r.requested_by = auth.uid()
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

commit;
