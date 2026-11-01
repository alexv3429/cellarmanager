-- Aggregate-only, read-only coverage baseline on an isolated copy of the
-- linked database. The largest active household is the owner pilot cellar in
-- the 1 November 2026 protected snapshot; verify this count before reuse.
-- Do not use this heuristic to target a live household or publish anything.
begin transaction read only;

select household_id as pilot_household_id
from public.wines
where merged_into_wine_id is null
group by household_id
order by count(*) desc
limit 1
\gset

select user_id as pilot_owner_id
from public.household_members
where household_id = :'pilot_household_id'::uuid and role = 'owner'
limit 1
\gset

select set_config('request.jwt.claim.sub', :'pilot_owner_id', true) is not null
as owner_context_set;

with wine_rows as materialized (
    select w.id, coalesce(h.qty, 0) as bottles,
        public.get_wine_maturity(w.id) as advice
    from public.wines w
    left join (
        select household_id, wine_id, sum(quantity) as qty
        from public.holdings group by household_id, wine_id
    ) h on h.household_id = w.household_id and h.wine_id = w.id
    where w.household_id = :'pilot_household_id'::uuid
      and w.merged_into_wine_id is null
), milestones as (
    select bottles, advice ->> 'effective_source' as source,
        case advice ->> 'effective_source'
            when 'manual' then advice #>> '{override,first_trial_year}'
            when 'cellar_producer' then advice #>> '{producer_rules,selected,first_trial_year}'
            when 'reviewed_reference' then advice #>> '{reference,first_trial_year}'
            else advice #>> '{projection,maturity,first_trial_year}'
        end as first_year,
        case advice ->> 'effective_source'
            when 'manual' then advice #>> '{override,best_start_year}'
            when 'cellar_producer' then advice #>> '{producer_rules,selected,best_start_year}'
            when 'reviewed_reference' then advice #>> '{reference,best_start_year}'
            else advice #>> '{projection,maturity,best_start_year}'
        end as best_start_year,
        case advice ->> 'effective_source'
            when 'manual' then advice #>> '{override,best_end_year}'
            when 'cellar_producer' then advice #>> '{producer_rules,selected,best_end_year}'
            when 'reviewed_reference' then advice #>> '{reference,best_end_year}'
            else advice #>> '{projection,maturity,best_end_year}'
        end as best_end_year,
        advice #>> '{projection,valid_until}' as model_valid_until
    from wine_rows
), classified as (
    select bottles, source,
        first_year is not null and best_start_year is not null
            and best_end_year is not null
            and first_year::integer <= best_start_year::integer
            and best_start_year::integer <= best_end_year::integer
            as complete_triplet,
        source = 'model_estimate'
            and model_valid_until::timestamptz <= now() as expired_model
    from milestones
)
select coalesce(source, '(null)') as source,
    count(*) as wines,
    sum(bottles) as bottles,
    count(*) filter (where complete_triplet) as complete_triplets,
    count(*) filter (where complete_triplet and not coalesce(expired_model, false))
        as usable_triplets,
    count(*) filter (where expired_model) as expired_models
from classified
group by source
order by wines desc;

with unavailable as materialized (
    select coalesce(h.qty, 0) as bottles,
        public.get_wine_maturity(w.id) as advice,
        w.vintage is null as missing_vintage,
        w.area is null as missing_region
    from public.wines w
    left join (
        select household_id, wine_id, sum(quantity) as qty
        from public.holdings group by household_id, wine_id
    ) h on h.household_id = w.household_id and h.wine_id = w.id
    where w.household_id = :'pilot_household_id'::uuid
      and w.merged_into_wine_id is null
)
select coalesce(advice ->> 'demand_status', '(none)') as demand_status,
    coalesce(advice ->> 'assessment_reason', '(none)') as assessment_reason,
    missing_vintage, missing_region,
    count(*) as wines, sum(bottles) as bottles
from unavailable
where advice ->> 'effective_source' = 'unavailable'
group by 1, 2, 3, 4
order by wines desc;

with unavailable as materialized (
    select w.area, w.color, coalesce(h.qty, 0) as bottles,
        public.get_wine_maturity(w.id) as advice
    from public.wines w
    left join (
        select household_id, wine_id, sum(quantity) as qty
        from public.holdings group by household_id, wine_id
    ) h on h.household_id = w.household_id and h.wine_id = w.id
    where w.household_id = :'pilot_household_id'::uuid
      and w.merged_into_wine_id is null
)
select coalesce(area, '(none)') as recorded_region, color,
    coalesce(advice ->> 'assessment_reason', '(none)') as assessment_reason,
    count(*) as wines, sum(bottles) as bottles
from unavailable
where advice ->> 'effective_source' = 'unavailable'
group by 1, 2, 3
order by bottles desc, wines desc;

with unavailable as materialized (
    select w.producer, coalesce(h.qty, 0) as bottles,
        public.get_wine_maturity(w.id) as advice
    from public.wines w
    left join (
        select household_id, wine_id, sum(quantity) as qty
        from public.holdings group by household_id, wine_id
    ) h on h.household_id = w.household_id and h.wine_id = w.id
    where w.household_id = :'pilot_household_id'::uuid
      and w.merged_into_wine_id is null
)
select producer, coalesce(advice ->> 'assessment_reason', '(none)') as reason,
    count(*) as wines, sum(bottles) as bottles
from unavailable
where advice ->> 'effective_source' = 'unavailable'
group by 1, 2
order by bottles desc, wines desc;

select w.producer, count(*) as wines, sum(coalesce(h.qty, 0)) as bottles
from public.wines w
left join (
    select household_id, wine_id, sum(quantity) as qty
    from public.holdings group by household_id, wine_id
) h on h.household_id = w.household_id and h.wine_id = w.id
where w.household_id = :'pilot_household_id'::uuid
  and w.merged_into_wine_id is null
group by w.producer
order by bottles desc, wines desc
limit 25;

rollback;
