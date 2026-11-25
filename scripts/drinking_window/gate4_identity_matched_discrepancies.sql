-- Read-only Gate 4 diagnostic for a restored, protected copy.
-- Compare an unadjusted current legacy projection with an unpublished exact
-- reference row only when both refer to the same confirmed canonical release,
-- vintage, colour, place and bottle format. Do not use this to approve dates.
-- Output may identify cellar wines; keep results outside Git.
with draft as (
    select id from public.drinking_window_reference_versions
    where status = 'draft' order by version_number desc limit 1
), comparable as (
    select w.id as wine_id, w.household_id, c.context ->> 'release_id' as release_id,
        r.id as proposed_row_id,
        (legacy.recommendation ->> 'first_trial_year')::integer as old_trial,
        (legacy.recommendation ->> 'best_start_year')::integer as old_start,
        (legacy.recommendation ->> 'best_end_year')::integer as old_end,
        r.first_trial_year as new_trial, r.best_start_year as new_start,
        r.best_end_year as new_end
    from public.wines w
    cross join lateral (select private.drinking_window_wine_context(w.id) as context) c
    join draft on true
    join public.drinking_window_reference_rows r on r.version_id = draft.id
      and r.scope = 'release'
      and r.release_id = (c.context ->> 'release_id')::uuid
      and r.region_id = (c.context ->> 'region_id')::uuid
      and r.appellation_id = (c.context ->> 'appellation_id')::uuid
      and r.wine_color = c.context ->> 'wine_color'
      and r.vintage_year = w.vintage and r.format_ml = w.format_ml
    join public.wine_enrichment_projections legacy on legacy.wine_id = w.id
      and legacy.household_id = w.household_id
      and legacy.projection_type = 'maturity' and legacy.context_key = ''
      and legacy.status = 'current' and legacy.valid_until > now()
    where w.merged_into_wine_id is null
      and w.wine_reference_type in ('release','package')
      and c.context ->> 'status' = 'ready'
      and not exists (select 1 from public.wine_maturity_overrides manual
          where manual.household_id = w.household_id and manual.wine_id = w.id)
      and legacy.recommendation ->> 'first_trial_year' ~ '^[0-9]{4}$'
      and legacy.recommendation ->> 'best_start_year' ~ '^[0-9]{4}$'
      and legacy.recommendation ->> 'best_end_year' ~ '^[0-9]{4}$'
), gaps as (
    select *, abs(new_trial - old_trial) as trial_gap,
        abs(new_start - old_start) as start_gap,
        abs(new_end - old_end) as end_gap
    from comparable
)
select wine_id, household_id, release_id, proposed_row_id,
    old_trial, old_start, old_end, new_trial, new_start, new_end,
    trial_gap, start_gap, end_gap,
    greatest(trial_gap, start_gap, end_gap) >= 5 as review_flag
from gaps order by review_flag desc, greatest(trial_gap, start_gap, end_gap) desc, wine_id;
