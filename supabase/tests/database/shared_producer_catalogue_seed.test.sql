begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

create temporary table seeded_names(name text primary key) on commit drop;
insert into seeded_names(name) values
    ('Ghislaine Barthod'),
    ('Michel Bouzereau & Fils'),
    ('Jacques Carillon'),
    ('Domaine Castagnier'),
    ('Bruno Clavelier'),
    ('Domaine de Montcalmès');

select is(
    (select count(*) from public.wine_reference_producers p
     join seeded_names n on n.name = p.canonical_name),
    6::bigint, 'All six reusable producers have canonical identities'
);
select is(
    (select count(*) from public.wine_reference_producers p
     join seeded_names n on n.name = p.canonical_name
     join public.wine_reference_entities e on e.id = p.id
         and e.entity_type = 'producer'),
    6::bigint, 'Each canonical producer has a matching reference entity'
);
select is(
    private.ensure_hierarchy_producer('jacques-carillon', 'Jacques Carillon'),
    (select id from public.wine_reference_producers
     where canonical_name = 'Jacques Carillon'),
    'Replaying a canonical producer seed returns the existing identity'
);
select is(
    (select count(*) from public.wine_reference_aliases a
     join public.wine_reference_producers p on p.id = a.entity_id
     join seeded_names n on n.name = p.canonical_name
     where a.entity_type = 'producer'),
    0::bigint, 'Workbook shorthands were not made global aliases'
);
select is(
    (select count(*) from public.wine_reference_household_producer_preferences preference
     join public.wine_reference_producers p on p.id = preference.producer_id
     join seeded_names n on n.name = p.canonical_name),
    0::bigint, 'Shared producer seeds do not create household shorthand preferences'
);

select * from finish();
rollback;
