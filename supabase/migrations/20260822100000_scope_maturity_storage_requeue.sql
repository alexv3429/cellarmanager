begin;

-- Physical advice depends on each wine's actual positions and on whether the
-- household has at least one usable aging/service destination. It does not
-- depend on every unrelated location ID. This keeps one-time classification of
-- a large cellar from generating a new projection for every intermediate edit.
create or replace function private.maturity_enrichment_input_fingerprint(
    p_wine public.wines
)
returns text
language sql
stable
set search_path = ''
as $$
    select pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(
                pg_catalog.concat_ws(
                    '|',
                    private.wine_enrichment_input_fingerprint(p_wine),
                    extract(year from current_date)::integer::text,
                    coalesce((
                        select string_agg(
                            pg_catalog.concat_ws(
                                ':',
                                holding.location_id::text,
                                holding.quantity::text,
                                location.storage_purpose,
                                location.is_active::text,
                                cellar.is_active::text
                            ),
                            ','
                            order by holding.location_id
                        )
                        from public.holdings holding
                        join public.locations location
                          on location.id = holding.location_id
                        join public.cellars cellar
                          on cellar.id = location.cellar_id
                        where holding.household_id = p_wine.household_id
                          and holding.wine_id = p_wine.id
                          and holding.quantity > 0
                    ), 'no-holdings'),
                    (
                        select exists (
                            select 1
                            from public.locations location
                            join public.cellars cellar
                              on cellar.id = location.cellar_id
                            where location.household_id = p_wine.household_id
                              and location.is_active
                              and cellar.is_active
                              and location.storage_purpose = 'aging'
                        )
                    )::text,
                    (
                        select exists (
                            select 1
                            from public.locations location
                            join public.cellars cellar
                              on cellar.id = location.cellar_id
                            where location.household_id = p_wine.household_id
                              and location.is_active
                              and cellar.is_active
                              and location.storage_purpose = 'service'
                        )
                    )::text
                ),
                'UTF8'
            ),
            'sha256'
        ),
        'hex'
    );
$$;


-- A holding change cannot make a place/vintage model start matching. Preserve
-- needs-review and not-found outcomes until wine identity or knowledge changes.
create or replace function private.requeue_maturity_after_holding_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_household_id uuid := coalesce(new.household_id, old.household_id);
    v_wine_id uuid := coalesce(new.wine_id, old.wine_id);
begin
    if exists (
        select 1
        from public.enrichment_demands demand
        where demand.household_id = v_household_id
          and demand.wine_id = v_wine_id
          and demand.capability = 'maturity'
          and demand.demand_status not in ('needs-review', 'not-found')
    ) then
        perform private.requeue_wine_maturity_demand(
            v_household_id,
            v_wine_id
        );
    end if;

    if tg_op = 'UPDATE'
       and (new.household_id, new.wine_id)
           is distinct from (old.household_id, old.wine_id)
       and exists (
            select 1
            from public.enrichment_demands demand
            where demand.household_id = old.household_id
              and demand.wine_id = old.wine_id
              and demand.capability = 'maturity'
              and demand.demand_status not in ('needs-review', 'not-found')
       )
    then
        perform private.requeue_wine_maturity_demand(
            old.household_id,
            old.wine_id
        );
    end if;

    return coalesce(new, old);
end;
$$;


-- Location/cellar edits can change destination availability for supported
-- wines. Recompute their fingerprints, but keep explicit unsupported outcomes
-- stable. The fingerprint function itself avoids queuing when the effective
-- physical inputs did not change.
create or replace function private.requeue_household_maturity_demands()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_household_id uuid := coalesce(new.household_id, old.household_id);
    v_wine record;
begin
    for v_wine in
        select wine.id
        from public.wines wine
        join public.enrichment_demands demand
          on demand.household_id = wine.household_id
         and demand.wine_id = wine.id
         and demand.capability = 'maturity'
        where wine.household_id = v_household_id
          and demand.demand_status not in ('needs-review', 'not-found')
    loop
        perform private.requeue_wine_maturity_demand(
            v_household_id,
            v_wine.id
        );
    end loop;

    if tg_op = 'UPDATE'
       and new.household_id is distinct from old.household_id
    then
        for v_wine in
            select wine.id
            from public.wines wine
            join public.enrichment_demands demand
              on demand.household_id = wine.household_id
             and demand.wine_id = wine.id
             and demand.capability = 'maturity'
            where wine.household_id = old.household_id
              and demand.demand_status not in ('needs-review', 'not-found')
        loop
            perform private.requeue_wine_maturity_demand(
                old.household_id,
                v_wine.id
            );
        end loop;
    end if;

    return coalesce(new, old);
end;
$$;


-- Adopt the narrower fingerprint without turning known unsupported wines back
-- into work. Supported/current demands are requeued once so future comparisons
-- all use the same fingerprint semantics.
update public.enrichment_demands demand
set
    input_fingerprint = private.maturity_enrichment_input_fingerprint(wine),
    updated_at = now()
from public.wines wine
where demand.household_id = wine.household_id
  and demand.wine_id = wine.id
  and demand.capability = 'maturity'
  and demand.demand_status in ('needs-review', 'not-found')
  and demand.input_fingerprint is distinct from
      private.maturity_enrichment_input_fingerprint(wine);

do $$
declare
    v_wine record;
begin
    for v_wine in
        select wine.household_id, wine.id
        from public.wines wine
        join public.enrichment_demands demand
          on demand.household_id = wine.household_id
         and demand.wine_id = wine.id
         and demand.capability = 'maturity'
        where demand.demand_status not in ('needs-review', 'not-found')
    loop
        perform private.requeue_wine_maturity_demand(
            v_wine.household_id,
            v_wine.id
        );
    end loop;
end
$$;

commit;
