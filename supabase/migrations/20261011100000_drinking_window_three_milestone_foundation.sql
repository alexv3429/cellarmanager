begin;

-- Align only the inert reference library with the reviewed three-milestone
-- policy. The current maturity model and household manual overrides retain
-- their legacy four-date shape until a separate, owner-reviewed rollout.
-- A populated draft reference or a candidate with a fourth year needs manual
-- migration review rather than silent deletion of that value.
do $$
begin
    if exists (select 1 from public.drinking_window_reference_rows) then
        raise exception using errcode = '23514',
            message = 'Review existing draft drinking-window references before removing the fourth year';
    end if;
    if exists (
        select 1 from public.drinking_window_candidates
        where drink_by_year is not null
    ) then
        raise exception using errcode = '23514',
            message = 'Review staged drinking-window candidates with a fourth year before migration';
    end if;
end;
$$;

alter table public.drinking_window_ageing_groups
    drop constraint drinking_window_ageing_groups_scope_check;
alter table public.drinking_window_ageing_groups
    add constraint drinking_window_ageing_groups_scope_check
    check (scope in ('producer_appellation', 'producer_region', 'appellation', 'region'));

alter table public.drinking_window_reference_rows
    drop constraint drinking_window_reference_rows_scope_check;
alter table public.drinking_window_reference_rows
    add constraint drinking_window_reference_rows_scope_check
    check (scope in ('release', 'producer_appellation', 'producer_region', 'appellation', 'region'));

alter table public.drinking_window_reference_rows
    drop constraint drinking_window_reference_rows_scope_shape_check;
alter table public.drinking_window_reference_rows
    add constraint drinking_window_reference_rows_scope_shape_check check (
        (scope = 'release'
            and producer_id is not null and product_id is not null
            and release_id is not null and appellation_id is not null)
        or (scope = 'producer_appellation'
            and producer_id is not null and product_id is null
            and release_id is null and appellation_id is not null)
        or (scope = 'producer_region'
            and producer_id is not null and product_id is null
            and release_id is null and appellation_id is null)
        or (scope = 'appellation'
            and producer_id is null and product_id is null
            and release_id is null and appellation_id is not null)
        or (scope = 'region'
            and producer_id is null and product_id is null
            and release_id is null and appellation_id is null)
    );

alter table public.drinking_window_reference_rows
    drop constraint drinking_window_reference_rows_years_check;
alter table public.drinking_window_reference_rows
    drop column drink_by_year;
alter table public.drinking_window_reference_rows
    add constraint drinking_window_reference_rows_years_check check (
        vintage_year <= first_trial_year
        and first_trial_year <= best_start_year
        and best_start_year <= best_end_year
        and best_end_year <= 2300
    );

alter table public.drinking_window_candidates
    drop constraint drinking_window_candidates_candidate_scope_check;
alter table public.drinking_window_candidates
    add constraint drinking_window_candidates_candidate_scope_check
    check (candidate_scope in (
        'release', 'producer_appellation', 'producer_region', 'region', 'quarantine'
    ));

alter table public.drinking_window_candidates
    drop constraint drinking_window_candidates_years_check;
alter table public.drinking_window_candidates
    drop column drink_by_year;
alter table public.drinking_window_candidates
    add constraint drinking_window_candidates_years_check check (
        (best_start_year is null or best_end_year is null
            or best_start_year <= best_end_year)
        and (first_trial_year is null or best_start_year is null
            or first_trial_year <= best_start_year)
    );

commit;
