begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
    not has_function_privilege(
        'authenticated',
        'private.merge_verified_wine_reference_producers(uuid,uuid[])',
        'execute'
    ),
    'Ordinary users cannot merge shared producer identities'
);

insert into public.wine_reference_entities(id, entity_type) values
    ('00000000-0000-4000-8000-000000009601', 'producer'),
    ('00000000-0000-4000-8000-000000009602', 'producer'),
    ('00000000-0000-4000-8000-000000009611', 'product'),
    ('00000000-0000-4000-8000-000000009612', 'product'),
    ('00000000-0000-4000-8000-000000009621', 'release'),
    ('00000000-0000-4000-8000-000000009631', 'package');
insert into public.wine_reference_producers(id, canonical_name) values
    ('00000000-0000-4000-8000-000000009601', 'Test Shared Producer'),
    ('00000000-0000-4000-8000-000000009602', 'Test Shared Producer');
insert into public.wine_reference_products(id, producer_id, canonical_name) values
    ('00000000-0000-4000-8000-000000009611', '00000000-0000-4000-8000-000000009601', 'First cuvée'),
    ('00000000-0000-4000-8000-000000009612', '00000000-0000-4000-8000-000000009602', 'Second cuvée');
insert into public.wine_reference_releases(id, product_id, vintage_year) values
    ('00000000-0000-4000-8000-000000009621', '00000000-0000-4000-8000-000000009612', 2022);
insert into public.wine_reference_packages(id, release_id, volume_ml) values
    ('00000000-0000-4000-8000-000000009631', '00000000-0000-4000-8000-000000009621', 750);
insert into public.wine_reference_household_producer_preferences(
    household_id, source_producer_normalized, source_producer_text, producer_id, decided_by
) values (
    '00000000-0000-4000-8000-000000000100', 'test shared producer', 'Test Shared Producer',
    '00000000-0000-4000-8000-000000009602', '00000000-0000-4000-8000-000000000001'
);

select lives_ok(
    $$select private.merge_verified_wine_reference_producers(
        '00000000-0000-4000-8000-000000009601',
        array['00000000-0000-4000-8000-000000009602'::uuid]
    )$$,
    'Verified duplicate producer identities can be merged'
);
set constraints all immediate;
select is(
    (select count(*)::integer from public.wine_reference_producers
     where canonical_name = 'Test Shared Producer'),
    1, 'Only the reviewed primary producer remains'
);
select is(
    (select count(*)::integer from public.wine_reference_products
     where producer_id = '00000000-0000-4000-8000-000000009601'),
    2, 'Both cuvées retain their IDs under the primary producer'
);
select is(
    (select count(*)::integer from public.wine_reference_packages package
     join public.wine_reference_releases release on release.id = package.release_id
     where release.product_id = '00000000-0000-4000-8000-000000009612'),
    1, 'The existing vintage and bottle format remain attached'
);
select is(
    (select producer_id::text from public.wine_reference_household_producer_preferences
     where source_producer_normalized = 'test shared producer'),
    '00000000-0000-4000-8000-000000009601',
    'An existing household name choice follows the merged producer'
);
select is(
    (select count(*)::integer from public.wine_reference_entities
     where id = '00000000-0000-4000-8000-000000009602'),
    0, 'The empty duplicate root identity is removed'
);

set constraints all deferred;
insert into public.wine_reference_entities(id, entity_type) values
    ('00000000-0000-4000-8000-000000009603', 'producer');
insert into public.wine_reference_producers(id, canonical_name) values
    ('00000000-0000-4000-8000-000000009603', 'Test Shared Producer');
insert into public.wine_reference_aliases(entity_id, entity_type, alias_value, normalized_value)
values ('00000000-0000-4000-8000-000000009603', 'producer', 'Test Alt', 'test alt');
select throws_ok(
    $$select private.merge_verified_wine_reference_producers(
        '00000000-0000-4000-8000-000000009601',
        array['00000000-0000-4000-8000-000000009603'::uuid]
    )$$,
    'P0001', 'Producer merge needs separate review of dependency public.wine_reference_aliases',
    'A referenced duplicate is never cascade-deleted silently'
);
select is(
    (select count(*)::integer from public.wine_reference_producers
     where id = '00000000-0000-4000-8000-000000009603'),
    1, 'A failed merge leaves the duplicate intact'
);

select * from finish();
rollback;
