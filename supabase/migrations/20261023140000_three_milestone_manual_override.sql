-- New personal windows use the same three milestones as reviewed references.
-- Keep an optional fourth year on old rows so editing does not erase a date
-- that the owner previously entered. The old RPC signature stays compatible.

alter table public.wine_maturity_overrides
    alter column drink_by_year drop not null;

alter table public.wine_maturity_overrides
    drop constraint wine_maturity_overrides_years_check;

alter table public.wine_maturity_overrides
    add constraint wine_maturity_overrides_years_check
    check (
        first_trial_year between 1800 and 2300
        and first_trial_year <= best_start_year
        and best_start_year <= best_end_year
        and best_end_year <= 2300
        and (
            drink_by_year is null
            or (best_end_year <= drink_by_year and drink_by_year <= 2300)
        )
    );

-- The prior STRICT function returned NULL for every three-date override,
-- hiding its state in the household overview. Without a fourth date, a wine
-- past the likely optimal period should be assessed, not marked as expired.
create or replace function private.maturity_state_from_window(
    p_as_of_year integer,
    p_first_trial_year integer,
    p_best_start_year integer,
    p_best_end_year integer,
    p_drink_by_year integer
)
returns text
language sql
immutable
called on null input
set search_path = ''
as $$
    select case
        when p_as_of_year is null or p_first_trial_year is null
            or p_best_start_year is null or p_best_end_year is null then null
        when p_as_of_year < p_first_trial_year then 'hold'
        when p_as_of_year < p_best_start_year then 'assess'
        when p_as_of_year <= p_best_end_year then 'ready'
        when p_drink_by_year is not null and p_as_of_year <= p_drink_by_year
            then 'priority'
        else 'assess-now'
    end;
$$;

-- The legacy overview uses COALESCE(override.drink_by_year, model.drink_by_year).
-- For a three-date override, that fabricates a fourth personal milestone from
-- the model. Adapt only those rows before the existing reviewed-reference
-- reader sees them. The original overview still performs membership checks.
alter function public.get_household_maturity_overview_before_references(uuid)
    rename to get_household_maturity_overview_legacy_four_date;

revoke all on function public.get_household_maturity_overview_legacy_four_date(uuid)
from public, anon, authenticated, powersync_role, service_role;

create function public.get_household_maturity_overview_before_references(
    p_household_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_rows jsonb;
begin
    v_rows := public.get_household_maturity_overview_legacy_four_date(p_household_id);

    return (
        select coalesce(jsonb_agg(
            case
                when item.value ->> 'is_override' = 'true'
                  and exists (
                      select 1
                      from public.wine_maturity_overrides override
                      where override.household_id = p_household_id
                        and override.wine_id = (item.value ->> 'wine_id')::uuid
                        and override.drink_by_year is null
                  )
                    then item.value || jsonb_build_object('drink_by_year', null)
                else item.value
            end
            order by item.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(v_rows) with ordinality as item(value, ordinality)
    );
end;
$$;

revoke all on function public.get_household_maturity_overview_before_references(uuid)
from public, anon, authenticated, powersync_role, service_role;
