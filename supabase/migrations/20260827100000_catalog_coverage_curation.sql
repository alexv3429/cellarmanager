begin;

-- The compact catalog overview now exposes the exact reviewed profile layers
-- used by the projection. Coverage must never be inferred from confidence:
-- a low-confidence exact layer and a high-confidence broad fallback answer
-- different curation questions.
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
            case
                when projection_rows.override_first_trial_year is not null then
                    private.maturity_state_from_window(
                        v_as_of_year,
                        projection_rows.override_first_trial_year,
                        projection_rows.override_best_start_year,
                        projection_rows.override_best_end_year,
                        projection_rows.override_drink_by_year
                    )
                else projection_rows.maturity_recommendation ->> 'state'
            end as effective_state,
            coalesce(
                projection_rows.override_first_trial_year,
                (projection_rows.maturity_recommendation ->> 'first_trial_year')::integer
            ) as effective_first_trial_year,
            coalesce(
                projection_rows.override_best_start_year,
                (projection_rows.maturity_recommendation ->> 'best_start_year')::integer
            ) as effective_best_start_year,
            coalesce(
                projection_rows.override_best_end_year,
                (projection_rows.maturity_recommendation ->> 'best_end_year')::integer
            ) as effective_best_end_year,
            coalesce(
                projection_rows.override_drink_by_year,
                (projection_rows.maturity_recommendation ->> 'drink_by_year')::integer
            ) as effective_drink_by_year
        from projection_rows
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'wine_id', row.wine_id,
                'projection_id', row.projection_id,
                'is_override', row.is_override,
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

revoke execute
on function public.get_household_maturity_overview(uuid)
from public, anon;

grant execute
on function public.get_household_maturity_overview(uuid)
to authenticated, service_role;


-- This service-only queue is deliberately computed from current cellar demand
-- instead of copying it into another mutable table. Step 0.4.14 can research
-- the highest-impact subjects without seeing household identities, and a
-- resolved fact/profile disappears when the underlying projection is rebuilt.
create or replace function public.get_shared_knowledge_curation_queue(
    p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if p_limit is null or p_limit < 1 or p_limit > 500 then
        raise exception using
            errcode = '22023',
            message = 'Curation queue limit must be between 1 and 500';
    end if;

    with wine_rows as (
        select
            wine.id as wine_id,
            wine.household_id,
            wine.producer,
            wine.cuvee,
            wine.vintage,
            wine.color,
            wine.appellation,
            wine.area,
            wine.country,
            wine.grape_composition,
            wine.sweetness_category,
            wine.alcohol_percent,
            coalesce(holding.quantity, 0)::bigint as bottle_count,
            maturity.id as projection_id,
            coalesce(maturity.recommendation -> 'contributions', '[]'::jsonb)
                as contributions,
            demand.last_error_code as assessment_reason
        from public.wines wine
        left join lateral (
            select sum(item.quantity)::bigint as quantity
            from public.holdings item
            where item.household_id = wine.household_id
              and item.wine_id = wine.id
        ) holding on true
        left join public.wine_enrichment_projections maturity
          on maturity.household_id = wine.household_id
         and maturity.wine_id = wine.id
         and maturity.projection_type = 'maturity'
         and maturity.context_key = ''
         and maturity.status = 'current'
        left join public.enrichment_demands demand
          on demand.household_id = wine.household_id
         and demand.wine_id = wine.id
         and demand.capability = 'maturity'
    ), gap_rows as (
        select
            wine.household_id,
            wine.wine_id,
            wine.bottle_count,
            gap.gap_type,
            gap.subject_key,
            gap.subject_label,
            gap.priority_weight
        from wine_rows wine
        cross join lateral (
            values
                (
                    'fact-country'::text,
                    pg_catalog.concat_ws(
                        '|',
                        private.normalize_wine_reference_text(wine.producer),
                        private.normalize_wine_reference_text(wine.cuvee),
                        coalesce(wine.vintage::text, 'NV'),
                        private.normalize_wine_reference_text(wine.color)
                    ),
                    pg_catalog.concat_ws(
                        ' · ',
                        wine.producer || ' — ' || wine.cuvee,
                        coalesce(wine.vintage::text, 'NV'),
                        wine.color
                    ),
                    30,
                    wine.country is null
                ),
                (
                    'fact-grapes',
                    pg_catalog.concat_ws(
                        '|',
                        private.normalize_wine_reference_text(wine.producer),
                        private.normalize_wine_reference_text(wine.cuvee),
                        coalesce(wine.vintage::text, 'NV'),
                        private.normalize_wine_reference_text(wine.color)
                    ),
                    pg_catalog.concat_ws(
                        ' · ',
                        wine.producer || ' — ' || wine.cuvee,
                        coalesce(wine.vintage::text, 'NV'),
                        wine.color
                    ),
                    50,
                    pg_catalog.jsonb_array_length(wine.grape_composition) = 0
                ),
                (
                    'fact-sweetness',
                    pg_catalog.concat_ws(
                        '|',
                        private.normalize_wine_reference_text(wine.producer),
                        private.normalize_wine_reference_text(wine.cuvee),
                        coalesce(wine.vintage::text, 'NV'),
                        private.normalize_wine_reference_text(wine.color)
                    ),
                    pg_catalog.concat_ws(
                        ' · ',
                        wine.producer || ' — ' || wine.cuvee,
                        coalesce(wine.vintage::text, 'NV'),
                        wine.color
                    ),
                    45,
                    wine.sweetness_category is null
                ),
                (
                    'fact-alcohol',
                    pg_catalog.concat_ws(
                        '|',
                        private.normalize_wine_reference_text(wine.producer),
                        private.normalize_wine_reference_text(wine.cuvee),
                        coalesce(wine.vintage::text, 'NV'),
                        private.normalize_wine_reference_text(wine.color)
                    ),
                    pg_catalog.concat_ws(
                        ' · ',
                        wine.producer || ' — ' || wine.cuvee,
                        coalesce(wine.vintage::text, 'NV'),
                        wine.color
                    ),
                    15,
                    wine.alcohol_percent is null
                ),
                (
                    'profile-place',
                    pg_catalog.concat_ws(
                        '|',
                        private.normalize_wine_reference_text(
                            coalesce(wine.appellation, wine.area, 'Unknown place')
                        ),
                        private.normalize_wine_reference_text(wine.color)
                    ),
                    pg_catalog.concat_ws(
                        ' · ',
                        coalesce(wine.appellation, wine.area, 'Unknown place'),
                        wine.color
                    ),
                    100,
                    wine.assessment_reason = 'unsupported-place-profile'
                ),
                (
                    'profile-vintage',
                    pg_catalog.concat_ws(
                        '|',
                        private.normalize_wine_reference_text(
                            coalesce(wine.appellation, wine.area, 'Unknown place')
                        ),
                        coalesce(wine.vintage::text, 'NV'),
                        private.normalize_wine_reference_text(wine.color)
                    ),
                    pg_catalog.concat_ws(
                        ' · ',
                        coalesce(wine.appellation, wine.area, 'Unknown place'),
                        coalesce(wine.vintage::text, 'NV'),
                        wine.color
                    ),
                    80,
                    wine.projection_id is not null
                    and not wine.contributions @> '[{"layer":"vintage"}]'::jsonb
                ),
                (
                    'profile-producer',
                    pg_catalog.concat_ws(
                        '|',
                        private.normalize_wine_reference_text(wine.producer),
                        private.normalize_wine_reference_text(wine.color)
                    ),
                    wine.producer || ' · ' || wine.color,
                    70,
                    wine.projection_id is not null
                    and not wine.contributions @> '[{"layer":"producer-era"}]'::jsonb
                ),
                (
                    'profile-cuvee',
                    pg_catalog.concat_ws(
                        '|',
                        private.normalize_wine_reference_text(wine.producer),
                        private.normalize_wine_reference_text(wine.cuvee),
                        private.normalize_wine_reference_text(wine.color)
                    ),
                    wine.producer || ' — ' || wine.cuvee || ' · ' || wine.color,
                    60,
                    wine.projection_id is not null
                    and not wine.contributions @> '[{"layer":"cuvee"}]'::jsonb
                )
        ) gap(
            gap_type,
            subject_key,
            subject_label,
            priority_weight,
            is_missing
        )
        where gap.is_missing
    ), ranked as (
        select
            gap.gap_type,
            gap.subject_key,
            max(gap.subject_label) as subject_label,
            count(distinct gap.household_id)::bigint as affected_households,
            count(distinct gap.wine_id)::bigint as affected_wines,
            sum(gap.bottle_count)::bigint as affected_bottles,
            (
                sum(gap.bottle_count) * 100
                + count(distinct gap.wine_id) * 10
                + count(distinct gap.household_id) * 20
                + max(gap.priority_weight)
            )::bigint as priority_score
        from gap_rows gap
        group by gap.gap_type, gap.subject_key
        order by
            priority_score desc,
            gap.gap_type,
            subject_label
        limit p_limit
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'status', 'open',
                'gap_type', item.gap_type,
                'subject_key', item.subject_key,
                'subject_label', item.subject_label,
                'affected_households', item.affected_households,
                'affected_wines', item.affected_wines,
                'affected_bottles', item.affected_bottles,
                'priority_score', item.priority_score
            )
            order by
                item.priority_score desc,
                item.gap_type,
                item.subject_label
        ),
        '[]'::jsonb
    )
    into v_result
    from ranked item;

    return v_result;
end;
$$;

revoke execute
on function public.get_shared_knowledge_curation_queue(integer)
from public, anon, authenticated;

grant execute
on function public.get_shared_knowledge_curation_queue(integer)
to service_role;

comment on function public.get_shared_knowledge_curation_queue(integer) is
    'Service-only, privacy-bounded aggregation of missing facts and reviewed profile layers, ranked by affected bottles, wines, and households.';

commit;
