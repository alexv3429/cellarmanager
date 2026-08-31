begin;

-- A maturity calibration is taste, not shared wine knowledge. It belongs to
-- one authenticated account and deliberately carries no household, wine, or
-- canonical-profile identity that could turn it into shared evidence.
create table private.member_maturity_calibrations (
    user_id uuid primary key
        references auth.users(id)
        on delete cascade,
    year_shift integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint member_maturity_calibrations_shift_check
        check (year_shift between -3 and 3 and year_shift <> 0)
);

comment on table private.member_maturity_calibrations is
    'Private account-level taste preference applied after canonical maturity calculation.';

revoke all
on table private.member_maturity_calibrations
from public, anon, authenticated;

grant select, insert, update, delete
on table private.member_maturity_calibrations
to service_role;


create or replace function private.apply_member_maturity_calibration(
    p_recommendation jsonb,
    p_year_shift integer,
    p_as_of_year integer
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
    v_first_trial_year integer;
    v_best_start_year integer;
    v_best_end_year integer;
    v_drink_by_year integer;
    v_state text;
begin
    if p_year_shift not between -3 and 3 then
        raise exception using
            errcode = '22023',
            message = 'Personal maturity timing must be between 3 years younger and 3 years later';
    end if;

    v_first_trial_year :=
        (p_recommendation ->> 'first_trial_year')::integer + p_year_shift;
    v_best_start_year :=
        (p_recommendation ->> 'best_start_year')::integer + p_year_shift;
    v_best_end_year :=
        (p_recommendation ->> 'best_end_year')::integer + p_year_shift;
    v_drink_by_year :=
        (p_recommendation ->> 'drink_by_year')::integer + p_year_shift;
    v_state := private.maturity_state_from_window(
        p_as_of_year,
        v_first_trial_year,
        v_best_start_year,
        v_best_end_year,
        v_drink_by_year
    );

    return p_recommendation || jsonb_build_object(
        'first_trial_year', v_first_trial_year,
        'best_start_year', v_best_start_year,
        'best_end_year', v_best_end_year,
        'drink_by_year', v_drink_by_year,
        'state', v_state,
        'state_label', private.maturity_state_label(v_state),
        'urgency', private.maturity_urgency(v_state),
        'urgency_score', private.maturity_urgency_score(v_state),
        'headline', 'Your timing: ' || private.maturity_state_label(v_state),
        'message', case v_state
            when 'hold' then
                'Your private timing preference places this wine before its first useful assessment.'
            when 'assess' then
                'Your private timing preference suggests that an assessment bottle may now be useful.'
            when 'ready' then
                'Your private timing preference places this wine inside its likely best period.'
            when 'priority' then
                'Your private timing preference suggests prioritizing this wine before its drink-by horizon.'
            else
                'Your private timing preference suggests assessing this wine now rather than relying on the calendar alone.'
        end
    );
end;
$$;

revoke execute
on function private.apply_member_maturity_calibration(jsonb, integer, integer)
from public, anon, authenticated;

grant execute
on function private.apply_member_maturity_calibration(jsonb, integer, integer)
to service_role;


create or replace function public.get_member_maturity_calibration()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select jsonb_build_object(
        'year_shift', calibration.year_shift,
        'updated_at', calibration.updated_at
    )
    into v_result
    from private.member_maturity_calibrations calibration
    where calibration.user_id = v_user_id;

    return v_result;
end;
$$;


create or replace function public.set_member_maturity_calibration(
    p_year_shift integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if p_year_shift is null or p_year_shift not between -3 and 3 then
        raise exception using
            errcode = '22023',
            message = 'Personal maturity timing must be between 3 years younger and 3 years later';
    end if;

    if p_year_shift = 0 then
        delete from private.member_maturity_calibrations calibration
        where calibration.user_id = v_user_id;
    else
        insert into private.member_maturity_calibrations (
            user_id,
            year_shift
        ) values (
            v_user_id,
            p_year_shift
        )
        on conflict (user_id) do update set
            year_shift = excluded.year_shift,
            updated_at = now();
    end if;

    return public.get_member_maturity_calibration();
end;
$$;


create or replace function public.clear_member_maturity_calibration()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    delete from private.member_maturity_calibrations calibration
    where calibration.user_id = v_user_id;

    return null::jsonb;
end;
$$;


create or replace function public.get_household_maturity_overview(
    p_household_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_as_of_year integer := extract(year from current_date)::integer;
    v_year_shift integer := 0;
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'Household membership is required';
    end if;

    select calibration.year_shift
    into v_year_shift
    from private.member_maturity_calibrations calibration
    where calibration.user_id = v_user_id;

    v_year_shift := coalesce(v_year_shift, 0);

    with projection_rows as (
        select
            wine.id as wine_id,
            maturity.id as projection_id,
            maturity.specificity,
            maturity.confidence,
            maturity.calculated_at,
            maturity.recommendation as maturity_recommendation,
            storage.recommendation as storage_recommendation,
            override.first_trial_year as override_first_trial_year,
            override.best_start_year as override_best_start_year,
            override.best_end_year as override_best_end_year,
            override.drink_by_year as override_drink_by_year,
            override.storage_purpose as override_storage_purpose,
            override.updated_at as override_updated_at,
            demand.demand_status,
            demand.last_error_code as assessment_reason,
            feedback.verdict as feedback_verdict
        from public.wines wine
        left join public.wine_enrichment_projections maturity
          on maturity.household_id = wine.household_id
         and maturity.wine_id = wine.id
         and maturity.projection_type = 'maturity'
         and maturity.context_key = ''
         and maturity.status = 'current'
        left join public.wine_enrichment_projections storage
          on storage.household_id = wine.household_id
         and storage.wine_id = wine.id
         and storage.projection_type = 'storage'
         and storage.context_key = ''
         and storage.status = 'current'
        left join public.wine_maturity_overrides override
          on override.household_id = wine.household_id
         and override.wine_id = wine.id
        left join public.enrichment_demands demand
          on demand.household_id = wine.household_id
         and demand.wine_id = wine.id
         and demand.capability = 'maturity'
        left join public.wine_enrichment_projection_feedback feedback
          on feedback.projection_id = maturity.id
         and feedback.reviewed_by = v_user_id
        where wine.household_id = p_household_id
    ), effective_rows as (
        select
            projection_rows.*,
            projection_rows.override_first_trial_year is not null as is_override,
            projection_rows.override_first_trial_year is null
                and projection_rows.maturity_recommendation is not null
                and v_year_shift <> 0 as is_personalized,
            case
                when projection_rows.override_first_trial_year is not null then
                    private.maturity_state_from_window(
                        v_as_of_year,
                        projection_rows.override_first_trial_year,
                        projection_rows.override_best_start_year,
                        projection_rows.override_best_end_year,
                        projection_rows.override_drink_by_year
                    )
                when projection_rows.maturity_recommendation is null then null
                when v_year_shift <> 0 then
                    private.maturity_state_from_window(
                        v_as_of_year,
                        (projection_rows.maturity_recommendation ->> 'first_trial_year')::integer + v_year_shift,
                        (projection_rows.maturity_recommendation ->> 'best_start_year')::integer + v_year_shift,
                        (projection_rows.maturity_recommendation ->> 'best_end_year')::integer + v_year_shift,
                        (projection_rows.maturity_recommendation ->> 'drink_by_year')::integer + v_year_shift
                    )
                else projection_rows.maturity_recommendation ->> 'state'
            end as effective_state,
            coalesce(
                projection_rows.override_first_trial_year,
                (projection_rows.maturity_recommendation ->> 'first_trial_year')::integer + v_year_shift
            ) as effective_first_trial_year,
            coalesce(
                projection_rows.override_best_start_year,
                (projection_rows.maturity_recommendation ->> 'best_start_year')::integer + v_year_shift
            ) as effective_best_start_year,
            coalesce(
                projection_rows.override_best_end_year,
                (projection_rows.maturity_recommendation ->> 'best_end_year')::integer + v_year_shift
            ) as effective_best_end_year,
            coalesce(
                projection_rows.override_drink_by_year,
                (projection_rows.maturity_recommendation ->> 'drink_by_year')::integer + v_year_shift
            ) as effective_drink_by_year
        from projection_rows
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'wine_id', row.wine_id,
                'projection_id', row.projection_id,
                'is_override', row.is_override,
                'is_personalized', row.is_personalized,
                'personal_year_shift', v_year_shift,
                'state', row.effective_state,
                'state_label', case
                    when row.effective_state is null then null
                    else private.maturity_state_label(row.effective_state)
                end,
                'urgency', case
                    when row.effective_state is null then null
                    else private.maturity_urgency(row.effective_state)
                end,
                'urgency_score', case
                    when row.effective_state is null then 0
                    else private.maturity_urgency_score(row.effective_state)
                end,
                'first_trial_year', row.effective_first_trial_year,
                'best_start_year', row.effective_best_start_year,
                'best_end_year', row.effective_best_end_year,
                'drink_by_year', row.effective_drink_by_year,
                'headline', case
                    when row.is_override then 'Owner-adjusted maturity window'
                    when row.is_personalized then
                        'Your timing: ' || private.maturity_state_label(row.effective_state)
                    else row.maturity_recommendation ->> 'headline'
                end,
                'confidence', case
                    when row.is_override then 1
                    else row.confidence
                end,
                'confidence_label', case
                    when row.is_override then 'owner'
                    else row.maturity_recommendation ->> 'confidence_label'
                end,
                'specificity', row.specificity,
                'profile_layers', coalesce(
                    jsonb_path_query_array(
                        coalesce(row.maturity_recommendation, '{}'::jsonb),
                        '$.contributions[*].layer'
                    ),
                    '[]'::jsonb
                ),
                'profile_warnings', coalesce(
                    row.maturity_recommendation -> 'warnings',
                    '[]'::jsonb
                ),
                'storage_purpose', coalesce(
                    row.override_storage_purpose,
                    row.storage_recommendation ->> 'purpose'
                ),
                'move_needed', coalesce(
                    (row.storage_recommendation #>> '{move,needed}')::boolean,
                    false
                ),
                'move_message', row.storage_recommendation #>> '{move,message}',
                'demand_status', row.demand_status,
                'assessment_reason', row.assessment_reason,
                'feedback_verdict', row.feedback_verdict,
                'calculated_at', row.calculated_at,
                'override_updated_at', row.override_updated_at
            )
            order by
                case
                    when row.effective_state is null then 0
                    else private.maturity_urgency_score(row.effective_state)
                end desc,
                row.effective_drink_by_year nulls last,
                row.wine_id
        ),
        '[]'::jsonb
    )
    into v_result
    from effective_rows row;

    return v_result;
end;
$$;


create or replace function public.get_wine_maturity(p_wine_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_as_of_year integer := extract(year from current_date)::integer;
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select wine.household_id
    into v_household_id
    from public.wines wine
    where wine.id = p_wine_id;

    if not found or not exists (
        select 1
        from public.household_members member
        where member.household_id = v_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'Wine membership is required';
    end if;

    select jsonb_build_object(
        'wine_id', p_wine_id,
        'demand_status', demand.demand_status,
        'assessment_reason', demand.last_error_code,
        'projection', case
            when maturity.id is null then null
            else jsonb_build_object(
                'id', maturity.id,
                'method', maturity.method,
                'specificity', maturity.specificity,
                'confidence', maturity.confidence,
                'calculated_at', maturity.calculated_at,
                'valid_until', maturity.valid_until,
                'maturity', maturity.recommendation,
                'storage', storage.recommendation
            )
        end,
        'calibration', case
            when calibration.user_id is null then null
            else jsonb_build_object(
                'year_shift', calibration.year_shift,
                'updated_at', calibration.updated_at,
                'active', maturity.id is not null and override.wine_id is null,
                'maturity', case
                    when maturity.id is null then null
                    else private.apply_member_maturity_calibration(
                        maturity.recommendation,
                        calibration.year_shift,
                        v_as_of_year
                    )
                end
            )
        end,
        'override', case
            when override.wine_id is null then null
            else jsonb_build_object(
                'first_trial_year', override.first_trial_year,
                'best_start_year', override.best_start_year,
                'best_end_year', override.best_end_year,
                'drink_by_year', override.drink_by_year,
                'storage_purpose', override.storage_purpose,
                'note', override.note,
                'updated_at', override.updated_at
            )
        end,
        'feedback', case
            when feedback.projection_id is null then null
            else jsonb_build_object(
                'verdict', feedback.verdict,
                'note', feedback.note,
                'updated_at', feedback.updated_at
            )
        end
    )
    into v_result
    from public.wines wine
    left join public.enrichment_demands demand
      on demand.household_id = wine.household_id
     and demand.wine_id = wine.id
     and demand.capability = 'maturity'
    left join public.wine_enrichment_projections maturity
      on maturity.household_id = wine.household_id
     and maturity.wine_id = wine.id
     and maturity.projection_type = 'maturity'
     and maturity.context_key = ''
     and maturity.status = 'current'
    left join public.wine_enrichment_projections storage
      on storage.household_id = wine.household_id
     and storage.wine_id = wine.id
     and storage.projection_type = 'storage'
     and storage.context_key = ''
     and storage.status = 'current'
    left join public.wine_maturity_overrides override
      on override.household_id = wine.household_id
     and override.wine_id = wine.id
    left join public.wine_enrichment_projection_feedback feedback
      on feedback.projection_id = maturity.id
     and feedback.reviewed_by = v_user_id
    left join private.member_maturity_calibrations calibration
      on calibration.user_id = v_user_id
    where wine.id = p_wine_id;

    return v_result;
end;
$$;


revoke execute
on function public.get_member_maturity_calibration()
from public, anon;

revoke execute
on function public.set_member_maturity_calibration(integer)
from public, anon;

revoke execute
on function public.clear_member_maturity_calibration()
from public, anon;

revoke execute
on function public.get_household_maturity_overview(uuid)
from public, anon;

revoke execute
on function public.get_wine_maturity(uuid)
from public, anon;

grant execute
on function public.get_member_maturity_calibration()
to authenticated, service_role;

grant execute
on function public.set_member_maturity_calibration(integer)
to authenticated, service_role;

grant execute
on function public.clear_member_maturity_calibration()
to authenticated, service_role;

grant execute
on function public.get_household_maturity_overview(uuid)
to authenticated, service_role;

grant execute
on function public.get_wine_maturity(uuid)
to authenticated, service_role;

commit;
