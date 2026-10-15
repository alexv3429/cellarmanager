begin;

-- Add six independently identifiable canonical producers to the reusable
-- reference catalogue. This does not decide what a household's shorthand
-- means: those preferences are household-scoped, never global aliases.
-- No products, releases, drinking windows, or publication decisions.
do $$
declare
    v_producer record;
    v_id uuid;
begin
    for v_producer in
        select * from (values
            ('ghislaine-barthod', 'Ghislaine Barthod'),
            ('michel-bouzereau-et-fils', 'Michel Bouzereau & Fils'),
            ('jacques-carillon', 'Jacques Carillon'),
            ('domaine-castagnier', 'Domaine Castagnier'),
            ('bruno-clavelier', 'Bruno Clavelier'),
            ('domaine-de-montcalmes', 'Domaine de Montcalmès')
        ) as names(seed_key, canonical_name)
    loop
        v_id := private.ensure_hierarchy_producer(
            v_producer.seed_key, v_producer.canonical_name
        );
        if not exists (
            select 1 from public.wine_reference_producers p
            where p.id = v_id and p.canonical_name = v_producer.canonical_name
        ) then
            raise exception using errcode = '23505',
                message = 'Confirmed producer seed conflicts with an existing identity';
        end if;
    end loop;
end;
$$;

commit;
