begin;

-- Serving adjustments are household state. They take priority in the UI but
-- never mutate the reviewed profile or its evidence.
create table public.wine_serving_overrides (
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    wine_id uuid not null,
    updated_by uuid not null
        references auth.users(id)
        on delete cascade,
    temperature_min_c numeric(4, 1) not null,
    temperature_max_c numeric(4, 1) not null,
    aeration_min_minutes integer not null,
    aeration_max_minutes integer not null,
    method text not null,
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (household_id, wine_id),
    constraint wine_serving_overrides_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,
    constraint wine_serving_overrides_member_fk
        foreign key (household_id, updated_by)
        references public.household_members(household_id, user_id)
        on delete cascade,
    constraint wine_serving_overrides_temperature_check
        check (
            temperature_min_c between 0 and 30
            and temperature_max_c between 0 and 30
            and temperature_min_c <= temperature_max_c
        ),
    constraint wine_serving_overrides_aeration_check
        check (
            aeration_min_minutes between 0 and 360
            and aeration_max_minutes between 0 and 360
            and aeration_min_minutes <= aeration_max_minutes
        ),
    constraint wine_serving_overrides_method_check
        check (method in ('none', 'open-ahead', 'decant', 'gentle-decant')),
    constraint wine_serving_overrides_note_check
        check (
            note is null
            or (
                length(trim(note)) > 0
                and length(note) <= 2000
            )
        )
);

alter table public.wine_serving_overrides enable row level security;

create policy wine_serving_overrides_select_member
on public.wine_serving_overrides
for select
to authenticated
using ((select private.is_household_member(household_id)));

revoke all privileges on table public.wine_serving_overrides
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete
on table public.wine_serving_overrides
to service_role;

grant select
on table public.wine_serving_overrides
to authenticated;


create or replace function private.require_wine_member(p_wine_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
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

    return v_household_id;
end;
$$;

revoke execute
on function private.require_wine_member(uuid)
from public, anon, authenticated;


-- The rule is intentionally conservative and transparent. It derives serving
-- ranges only from the reviewed structural wine profile and current maturity
-- state; it does not claim a source-specific serving instruction.
create or replace function private.calculate_wine_serving_guidance(
    p_wine_color text,
    p_traits jsonb,
    p_maturity_state text,
    p_confidence numeric,
    p_specificity text,
    p_calculated_at timestamptz
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
    v_color text := lower(trim(p_wine_color));
    v_body numeric;
    v_acidity numeric;
    v_tannin numeric;
    v_sweetness numeric;
    v_concentration numeric;
    v_temperature_min numeric;
    v_temperature_max numeric;
    v_aeration_min integer;
    v_aeration_max integer;
    v_method text;
    v_reasons jsonb := '[]'::jsonb;
    v_warnings jsonb := '[]'::jsonb;
begin
    if jsonb_typeof(p_traits) <> 'object' then
        raise exception using
            errcode = '22023',
            message = 'Serving guidance requires reviewed wine traits';
    end if;

    begin
        v_body := (p_traits ->> 'body')::numeric;
        v_acidity := (p_traits ->> 'acidity')::numeric;
        v_tannin := (p_traits ->> 'tannin')::numeric;
        v_sweetness := (p_traits ->> 'sweetness')::numeric;
        v_concentration := (p_traits ->> 'concentration')::numeric;
    exception
        when others then
            raise exception using
                errcode = '22023',
                message = 'Serving guidance requires numeric wine traits';
    end;

    if v_body not between 0 and 5
       or v_acidity not between 0 and 5
       or v_tannin not between 0 and 5
       or v_sweetness not between 0 and 5
       or v_concentration not between 0 and 5
    then
        raise exception using
            errcode = '22023',
            message = 'Serving wine traits must stay between 0 and 5';
    end if;

    if v_color = 'sparkling' then
        v_temperature_min := 6;
        v_temperature_max := 9;
        v_reasons := v_reasons || jsonb_build_array(
            'A cool serving range preserves freshness and carbonation.'
        );
    elsif v_color in ('white', 'rose') then
        if v_sweetness >= 3 then
            v_temperature_min := 8;
            v_temperature_max := 11;
            v_reasons := v_reasons || jsonb_build_array(
                'Cool service balances noticeable sweetness while preserving aroma.'
            );
        elsif v_body >= 3.5 or v_concentration >= 3.5 then
            v_temperature_min := 10;
            v_temperature_max := 13;
            v_reasons := v_reasons || jsonb_build_array(
                'A fuller white or rosé benefits from a less chilled range so texture and aroma remain visible.'
            );
        else
            v_temperature_min := 8;
            v_temperature_max := 11;
            v_reasons := v_reasons || jsonb_build_array(
                'A cool serving range supports freshness without suppressing the wine.'
            );
        end if;
    elsif v_color = 'red' then
        if v_body <= 2.5 and v_tannin <= 2.5 then
            v_temperature_min := 13;
            v_temperature_max := 15;
            v_reasons := v_reasons || jsonb_build_array(
                'The lighter body and tannin suit a slightly cool red-wine service.'
            );
        elsif v_body >= 3.8 or v_tannin >= 3.8 then
            v_temperature_min := 16;
            v_temperature_max := 18;
            v_reasons := v_reasons || jsonb_build_array(
                'A structured red benefits from a temperate range that keeps tannin and alcohol balanced.'
            );
        else
            v_temperature_min := 15;
            v_temperature_max := 17;
            v_reasons := v_reasons || jsonb_build_array(
                'A moderate cellar-temperature range balances fruit, freshness, and structure.'
            );
        end if;
    elsif v_color = 'fortified' then
        if v_sweetness >= 3 then
            v_temperature_min := 12;
            v_temperature_max := 15;
        else
            v_temperature_min := 14;
            v_temperature_max := 16;
        end if;
        v_reasons := v_reasons || jsonb_build_array(
            'A moderately cool range keeps a fortified wine balanced rather than spirit-forward.'
        );
    elsif v_color = 'sweet' then
        v_temperature_min := 8;
        v_temperature_max := 11;
        v_reasons := v_reasons || jsonb_build_array(
            'Cool service balances sweetness and preserves freshness.'
        );
    else
        v_temperature_min := 10;
        v_temperature_max := 16;
        v_warnings := v_warnings || jsonb_build_array(
            'The wine style is not specific enough for a narrow temperature range.'
        );
    end if;

    if v_color = 'sparkling' then
        v_aeration_min := 0;
        v_aeration_max := 0;
        v_method := 'none';
        v_reasons := v_reasons || jsonb_build_array(
            'Serve directly rather than decanting so the bubbles are preserved.'
        );
    elsif p_maturity_state = 'priority' then
        v_aeration_min := 0;
        v_aeration_max := 15;
        v_method := 'gentle-decant';
        v_reasons := v_reasons || jsonb_build_array(
            'A mature priority bottle should be tasted promptly and handled gently.'
        );
        v_warnings := v_warnings || jsonb_build_array(
            'Stand the bottle upright for sediment and avoid prolonged aeration before tasting.'
        );
    elsif v_color = 'red'
          and p_maturity_state in ('hold', 'assess')
          and (v_tannin >= 3.5 or v_concentration >= 3.5)
    then
        v_aeration_min := 60;
        v_aeration_max := 120;
        v_method := 'decant';
        v_reasons := v_reasons || jsonb_build_array(
            'Youthful tannin or concentration can benefit from extended aeration.'
        );
    elsif v_color = 'red' and (v_tannin >= 3 or v_body >= 3) then
        v_aeration_min := 30;
        v_aeration_max := 60;
        v_method := 'decant';
        v_reasons := v_reasons || jsonb_build_array(
            'Moderate structure can open with a short decant.'
        );
    elsif v_color = 'red' then
        v_aeration_min := 15;
        v_aeration_max := 30;
        v_method := 'open-ahead';
        v_reasons := v_reasons || jsonb_build_array(
            'A short opening period should reveal the wine without overexposing it.'
        );
    elsif v_color in ('white', 'rose')
          and (v_body >= 3.5 or v_concentration >= 3.5)
    then
        v_aeration_min := 15;
        v_aeration_max := 30;
        v_method := 'open-ahead';
        v_reasons := v_reasons || jsonb_build_array(
            'A concentrated still wine may gain expression from a short opening period.'
        );
    elsif v_color in ('sweet', 'fortified') then
        v_aeration_min := 0;
        v_aeration_max := 15;
        v_method := 'open-ahead';
        v_reasons := v_reasons || jsonb_build_array(
            'Taste first; a brief opening period is normally sufficient.'
        );
    else
        v_aeration_min := 0;
        v_aeration_max := 15;
        v_method := 'none';
        v_reasons := v_reasons || jsonb_build_array(
            'No extended aeration is suggested by the reviewed structure.'
        );
    end if;

    if p_maturity_state is null then
        v_warnings := v_warnings || jsonb_build_array(
            'Readiness is unknown; taste before extending the suggested aeration.'
        );
    end if;

    return jsonb_build_object(
        'schema_version', 1,
        'temperature_min_c', v_temperature_min,
        'temperature_max_c', v_temperature_max,
        'aeration_min_minutes', v_aeration_min,
        'aeration_max_minutes', v_aeration_max,
        'method', v_method,
        'confidence', p_confidence,
        'confidence_label', case
            when p_confidence >= 0.75 then 'high'
            when p_confidence >= 0.5 then 'medium'
            else 'low'
        end,
        'specificity', p_specificity,
        'calculated_at', p_calculated_at,
        'reasons', v_reasons,
        'warnings', v_warnings
    );
end;
$$;

revoke execute
on function private.calculate_wine_serving_guidance(
    text,
    jsonb,
    text,
    numeric,
    text,
    timestamptz
)
from public, anon, authenticated;


create or replace function public.get_wine_personal_guidance(p_wine_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_pairing public.wine_enrichment_projections%rowtype;
    v_maturity_state text;
    v_demand_status text;
    v_assessment_reason text;
    v_model jsonb;
    v_override jsonb;
    v_observations jsonb;
begin
    v_household_id := private.require_wine_member(p_wine_id);

    select demand.demand_status, demand.last_error_code
    into v_demand_status, v_assessment_reason
    from public.enrichment_demands demand
    where demand.household_id = v_household_id
      and demand.wine_id = p_wine_id
      and demand.capability = 'pairing-profile';

    select projection.*
    into v_pairing
    from public.wine_enrichment_projections projection
    where projection.household_id = v_household_id
      and projection.wine_id = p_wine_id
      and projection.projection_type = 'pairing'
      and projection.context_key = 'wine-profile'
      and projection.status = 'current'
    order by projection.calculated_at desc
    limit 1;

    select case
        when override.wine_id is not null then case
            when extract(year from current_date)::integer < override.first_trial_year then 'hold'
            when extract(year from current_date)::integer < override.best_start_year then 'assess'
            when extract(year from current_date)::integer <= override.best_end_year then 'ready'
            else 'priority'
        end
        else maturity.recommendation ->> 'state'
    end
    into v_maturity_state
    from public.wines wine
    left join public.wine_maturity_overrides override
      on override.household_id = wine.household_id
     and override.wine_id = wine.id
    left join public.wine_enrichment_projections maturity
      on maturity.household_id = wine.household_id
     and maturity.wine_id = wine.id
     and maturity.projection_type = 'maturity'
     and maturity.context_key = ''
     and maturity.status = 'current'
    where wine.id = p_wine_id
      and wine.household_id = v_household_id;

    if v_pairing.id is not null then
        v_model := private.calculate_wine_serving_guidance(
            v_pairing.recommendation ->> 'wine_color',
            v_pairing.recommendation -> 'traits',
            v_maturity_state,
            v_pairing.confidence,
            v_pairing.specificity,
            v_pairing.calculated_at
        );
    end if;

    select jsonb_build_object(
        'temperature_min_c', serving.temperature_min_c,
        'temperature_max_c', serving.temperature_max_c,
        'aeration_min_minutes', serving.aeration_min_minutes,
        'aeration_max_minutes', serving.aeration_max_minutes,
        'method', serving.method,
        'note', serving.note,
        'updated_at', serving.updated_at
    )
    into v_override
    from public.wine_serving_overrides serving
    where serving.household_id = v_household_id
      and serving.wine_id = p_wine_id;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', observation.id,
                'visibility', observation.visibility,
                'observation_type', observation.observation_type,
                'observed_on', observation.observed_on,
                'maturity_assessment', observation.maturity_assessment,
                'pairing_dish', observation.pairing_dish,
                'pairing_verdict', observation.pairing_verdict,
                'ratings', jsonb_build_object(
                    'body', observation.body_rating,
                    'acidity', observation.acidity_rating,
                    'tannin', observation.tannin_rating,
                    'freshness', observation.freshness_rating
                ),
                'note', observation.note,
                'is_author', observation.recorded_by = v_user_id,
                'created_at', observation.created_at,
                'updated_at', observation.updated_at
            )
            order by observation.observed_on desc, observation.updated_at desc
        ),
        '[]'::jsonb
    )
    into v_observations
    from public.household_wine_observations observation
    where observation.household_id = v_household_id
      and observation.wine_id = p_wine_id
      and (
          observation.visibility = 'household'
          or observation.recorded_by = v_user_id
      );

    return jsonb_build_object(
        'wine_id', p_wine_id,
        'serving', jsonb_build_object(
            'demand_status', v_demand_status,
            'assessment_reason', v_assessment_reason,
            'model', v_model,
            'override', v_override
        ),
        'observations', v_observations
    );
end;
$$;


create or replace function public.save_wine_observation(
    p_wine_id uuid,
    p_observation_id uuid,
    p_visibility text,
    p_observation_type text,
    p_observed_on date,
    p_maturity_assessment text,
    p_pairing_dish text,
    p_pairing_verdict text,
    p_body_rating integer,
    p_acidity_rating integer,
    p_tannin_rating integer,
    p_freshness_rating integer,
    p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_note text := nullif(trim(p_note), '');
    v_pairing_dish text := nullif(trim(p_pairing_dish), '');
begin
    v_household_id := private.require_wine_member(p_wine_id);

    if p_observed_on is null
       or p_observed_on < date '1900-01-01'
       or p_observed_on > current_date
    then
        raise exception using
            errcode = '22023',
            message = 'Observation date must be today or earlier';
    end if;

    if v_note is null or length(v_note) > 5000 then
        raise exception using
            errcode = '22023',
            message = 'Observation note must contain 1 to 5000 characters';
    end if;

    if p_observation_type = 'pairing' then
        if v_pairing_dish is null
           or length(v_pairing_dish) > 200
           or p_pairing_verdict not in ('excellent', 'good', 'neutral', 'poor')
        then
            raise exception using
                errcode = '22023',
                message = 'Pairing observations require a dish and verdict';
        end if;
    else
        v_pairing_dish := null;
        p_pairing_verdict := null;
    end if;

    if p_observation_type not in ('tasting', 'maturity', 'producer-guidance') then
        p_maturity_assessment := null;
    end if;

    if p_observation_type <> 'tasting' then
        p_body_rating := null;
        p_acidity_rating := null;
        p_tannin_rating := null;
        p_freshness_rating := null;
    end if;

    if p_observation_id is null then
        insert into public.household_wine_observations (
            household_id,
            wine_id,
            recorded_by,
            visibility,
            observation_type,
            observed_on,
            maturity_assessment,
            pairing_dish,
            pairing_verdict,
            body_rating,
            acidity_rating,
            tannin_rating,
            freshness_rating,
            note
        )
        values (
            v_household_id,
            p_wine_id,
            v_user_id,
            p_visibility,
            p_observation_type,
            p_observed_on,
            p_maturity_assessment,
            v_pairing_dish,
            p_pairing_verdict,
            p_body_rating,
            p_acidity_rating,
            p_tannin_rating,
            p_freshness_rating,
            v_note
        );
    else
        update public.household_wine_observations observation
        set visibility = p_visibility,
            observation_type = p_observation_type,
            observed_on = p_observed_on,
            maturity_assessment = p_maturity_assessment,
            pairing_dish = v_pairing_dish,
            pairing_verdict = p_pairing_verdict,
            body_rating = p_body_rating,
            acidity_rating = p_acidity_rating,
            tannin_rating = p_tannin_rating,
            freshness_rating = p_freshness_rating,
            note = v_note,
            updated_at = now()
        where observation.id = p_observation_id
          and observation.household_id = v_household_id
          and observation.wine_id = p_wine_id
          and observation.recorded_by = v_user_id;

        if not found then
            raise exception using
                errcode = '42501',
                message = 'Only the author can edit this observation';
        end if;
    end if;

    return public.get_wine_personal_guidance(p_wine_id);
end;
$$;


create or replace function public.delete_wine_observation(p_observation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine_id uuid;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select observation.wine_id
    into v_wine_id
    from public.household_wine_observations observation
    where observation.id = p_observation_id
      and observation.recorded_by = v_user_id;

    if not found then
        raise exception using
            errcode = '42501',
            message = 'Only the author can delete this observation';
    end if;

    perform private.require_wine_member(v_wine_id);

    delete from public.household_wine_observations observation
    where observation.id = p_observation_id
      and observation.recorded_by = v_user_id;

    return public.get_wine_personal_guidance(v_wine_id);
end;
$$;


create or replace function public.set_wine_serving_override(
    p_wine_id uuid,
    p_temperature_min_c numeric,
    p_temperature_max_c numeric,
    p_aeration_min_minutes integer,
    p_aeration_max_minutes integer,
    p_method text,
    p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_note text := nullif(trim(p_note), '');
begin
    v_household_id := private.require_wine_member(p_wine_id);

    if p_temperature_min_c is null
       or p_temperature_max_c is null
       or p_temperature_min_c not between 0 and 30
       or p_temperature_max_c not between 0 and 30
       or p_temperature_min_c > p_temperature_max_c
    then
        raise exception using
            errcode = '22023',
            message = 'Serving temperatures must form an ordered range between 0 and 30 °C';
    end if;

    if p_aeration_min_minutes is null
       or p_aeration_max_minutes is null
       or p_aeration_min_minutes not between 0 and 360
       or p_aeration_max_minutes not between 0 and 360
       or p_aeration_min_minutes > p_aeration_max_minutes
    then
        raise exception using
            errcode = '22023',
            message = 'Aeration must form an ordered range between 0 and 360 minutes';
    end if;

    if p_method not in ('none', 'open-ahead', 'decant', 'gentle-decant') then
        raise exception using
            errcode = '22023',
            message = 'Select a supported serving method';
    end if;

    if v_note is not null and length(v_note) > 2000 then
        raise exception using
            errcode = '22023',
            message = 'Serving note must contain at most 2000 characters';
    end if;

    insert into public.wine_serving_overrides (
        household_id,
        wine_id,
        updated_by,
        temperature_min_c,
        temperature_max_c,
        aeration_min_minutes,
        aeration_max_minutes,
        method,
        note
    )
    values (
        v_household_id,
        p_wine_id,
        v_user_id,
        p_temperature_min_c,
        p_temperature_max_c,
        p_aeration_min_minutes,
        p_aeration_max_minutes,
        p_method,
        v_note
    )
    on conflict (household_id, wine_id) do update
    set updated_by = excluded.updated_by,
        temperature_min_c = excluded.temperature_min_c,
        temperature_max_c = excluded.temperature_max_c,
        aeration_min_minutes = excluded.aeration_min_minutes,
        aeration_max_minutes = excluded.aeration_max_minutes,
        method = excluded.method,
        note = excluded.note,
        updated_at = now();

    return public.get_wine_personal_guidance(p_wine_id);
end;
$$;


create or replace function public.clear_wine_serving_override(p_wine_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_household_id uuid;
begin
    v_household_id := private.require_wine_member(p_wine_id);

    delete from public.wine_serving_overrides serving
    where serving.household_id = v_household_id
      and serving.wine_id = p_wine_id;

    return public.get_wine_personal_guidance(p_wine_id);
end;
$$;


revoke execute
on function public.get_wine_personal_guidance(uuid)
from public, anon;

revoke execute
on function public.save_wine_observation(
    uuid,
    uuid,
    text,
    text,
    date,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    integer,
    text
)
from public, anon;

revoke execute
on function public.delete_wine_observation(uuid)
from public, anon;

revoke execute
on function public.set_wine_serving_override(
    uuid,
    numeric,
    numeric,
    integer,
    integer,
    text,
    text
)
from public, anon;

revoke execute
on function public.clear_wine_serving_override(uuid)
from public, anon;

grant execute
on function public.get_wine_personal_guidance(uuid)
to authenticated;

grant execute
on function public.save_wine_observation(
    uuid,
    uuid,
    text,
    text,
    date,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    integer,
    text
)
to authenticated;

grant execute
on function public.delete_wine_observation(uuid)
to authenticated;

grant execute
on function public.set_wine_serving_override(
    uuid,
    numeric,
    numeric,
    integer,
    integer,
    text,
    text
)
to authenticated;

grant execute
on function public.clear_wine_serving_override(uuid)
to authenticated;

commit;
