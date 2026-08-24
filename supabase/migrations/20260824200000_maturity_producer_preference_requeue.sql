begin;

-- A household producer preference is explicit identity evidence for v3. It is
-- part of the calculation input so confirming, changing, or removing that
-- preference creates a new immutable projection instead of reusing stale
-- place-only advice.
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
                    coalesce((
                        select preference.producer_id::text
                        from public.wine_reference_household_producer_preferences preference
                        where preference.household_id = p_wine.household_id
                          and preference.source_producer_normalized =
                              private.normalize_wine_reference_text(p_wine.producer)
                    ), 'no-producer-preference'),
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

revoke execute
on function private.maturity_enrichment_input_fingerprint(public.wines)
from public, anon, authenticated;

grant execute
on function private.maturity_enrichment_input_fingerprint(public.wines)
to service_role;


create or replace function private.requeue_maturity_for_producer_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wine record;
begin
    if tg_op in ('UPDATE', 'DELETE') then
        for v_wine in
            select wine.household_id, wine.id
            from public.wines wine
            where wine.household_id = old.household_id
              and private.normalize_wine_reference_text(wine.producer) =
                  old.source_producer_normalized
        loop
            perform private.requeue_wine_maturity_demand(
                v_wine.household_id,
                v_wine.id
            );
        end loop;
    end if;

    if tg_op in ('INSERT', 'UPDATE') then
        for v_wine in
            select wine.household_id, wine.id
            from public.wines wine
            where wine.household_id = new.household_id
              and private.normalize_wine_reference_text(wine.producer) =
                  new.source_producer_normalized
        loop
            perform private.requeue_wine_maturity_demand(
                v_wine.household_id,
                v_wine.id
            );
        end loop;
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

revoke execute
on function private.requeue_maturity_for_producer_preference()
from public, anon, authenticated;

create trigger wine_reference_producer_preferences_requeue_maturity
after insert or update or delete
on public.wine_reference_household_producer_preferences
for each row
execute function private.requeue_maturity_for_producer_preference();


-- Adopt the new fingerprint for any preferences that predate this migration.
do $$
declare
    v_wine record;
begin
    for v_wine in
        select wine.household_id, wine.id
        from public.wines wine
        join public.wine_reference_household_producer_preferences preference
          on preference.household_id = wine.household_id
         and preference.source_producer_normalized =
             private.normalize_wine_reference_text(wine.producer)
    loop
        perform private.requeue_wine_maturity_demand(
            v_wine.household_id,
            v_wine.id
        );
    end loop;
end;
$$;

commit;
