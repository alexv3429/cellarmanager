begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select ok(
    not has_function_privilege(
        'authenticated', 'private.resolve_lwin_reference_producer(text)', 'EXECUTE'
    ),
    'Browser clients cannot create shared producer identities directly'
);

-- Isolate the fixture even when running this rollback-only suite against a
-- restored project that already has an active LWIN snapshot.
update public.wine_reference_lwin_snapshots
set import_status = 'superseded'
where source_key = 'liv-ex-lwin' and import_status = 'active';

insert into public.wine_reference_lwin_snapshots(
    id, source_key, content_sha256, source_file_name, source_retrieved_at,
    source_updated_through, expected_record_count, record_count,
    live_record_count, combined_record_count, deleted_record_count,
    import_status, rows_retained, completed_at
) values (
    '00000000-0000-4000-8000-000000009700', 'liv-ex-lwin',
    repeat('7',64), 'identity-path-fixture.xlsx', '2026-11-03T00:00:00Z',
    '2026-11-02T23:00:00', 4, 4, 4, 0, 0, 'active', true,
    '2026-11-03T00:01:00Z'
);
insert into public.wine_reference_lwin_entries(
    snapshot_id, lwin7, source_row_number, source_status, display_name,
    producer_name, wine_name, country, region, colour, product_type,
    designation, vintage_configuration
) values
    ('00000000-0000-4000-8000-000000009700', '1999701', 2, 'live',
     'Alvina Pernot, Clos de la Garenne', 'Alvina Pernot',
     'Clos de la Garenne', 'France', 'Burgundy', 'White', 'Wine',
     'AOP', 'sequential'),
    ('00000000-0000-4000-8000-000000009700', '1999702', 3, 'live',
     'Alvina Pernot, Les Pucelles', 'Alvina Pernot',
     'Les Pucelles', 'France', 'Burgundy', 'White', 'Wine',
     'AOP', 'sequential'),
    ('00000000-0000-4000-8000-000000009700', '1999703', 4, 'live',
     'Alvina Pernot, Le Cailleret', 'Alvina Pernot',
     'Le Cailleret', 'France', 'Burgundy', 'White', 'Wine',
     'AOP', 'sequential'),
    ('00000000-0000-4000-8000-000000009700', '1999704', 5, 'live',
     'Unnamed producer, anonymous cuvée', null,
     'Anonymous cuvée', 'France', 'Burgundy', 'White', 'Wine',
     'AOP', 'sequential');
insert into public.wines(
    id, household_id, producer, cuvee, vintage, color, format_ml
) values (
    '00000000-0000-4000-8000-000000009710',
    '00000000-0000-4000-8000-000000000100',
    'Pernot', 'Clos de la Garenne', 2022, 'white', 750
);

select lives_ok(
    $$select * from private.promote_lwin_reference(
        (select wine from public.wines wine
         where wine.id = '00000000-0000-4000-8000-000000009710'),
        '1999701', true, '00000000-0000-4000-8000-000000000001'
    )$$,
    'First LWIN confirmation creates one producer and remembers the local name'
);
select lives_ok(
    $$select * from private.promote_lwin_reference(
        (select wine from public.wines wine
         where wine.id = '00000000-0000-4000-8000-000000009710'),
        '1999702', false, '00000000-0000-4000-8000-000000000001'
    )$$,
    'A second cuvée reuses the same canonical producer'
);
select is(
    (select count(*)::integer from public.wine_reference_producers p
     where private.normalize_wine_reference_text(p.canonical_name) = 'alvina pernot'),
    1,
    'Two LWIN7 products do not create two Alvina Pernot producer rows'
);
select is(
    (select count(*)::integer from public.wine_reference_products product
     join public.wine_reference_producers producer on producer.id = product.producer_id
     where producer.canonical_name = 'Alvina Pernot'),
    2,
    'Both products remain separate under the one shared producer'
);
select is(
    (select source_producer_text from public.wine_reference_household_producer_preferences
     where household_id = '00000000-0000-4000-8000-000000000100'
       and source_producer_normalized = 'pernot'),
    'Pernot',
    'The cellar keeps its own label while mapping to the shared producer'
);

-- A same-name homonym cannot be safely picked by ordering UUIDs.
insert into public.wine_reference_entities(id, entity_type)
values ('00000000-0000-4000-8000-000000009711', 'producer');
insert into public.wine_reference_producers(id, canonical_name)
values ('00000000-0000-4000-8000-000000009711', 'Alvina Pernot');
select throws_ok(
    $$select * from private.promote_lwin_reference(
        (select wine from public.wines wine
         where wine.id = '00000000-0000-4000-8000-000000009710'),
        '1999703', false, '00000000-0000-4000-8000-000000000001'
    )$$,
    '21000',
    'Shared producer identity is ambiguous; curator reconciliation is required',
    'An ambiguous shared producer blocks a third product instead of silently picking one'
);
select is(
    (select count(*)::integer from public.wine_reference_external_identifiers
     where identifier_scheme = 'LWIN7' and identifier_value = '1999703'),
    0,
    'A blocked ambiguity leaves the third LWIN unpromoted'
);
select throws_ok(
    $$select * from private.promote_lwin_reference(
        (select wine from public.wines wine
         where wine.id = '00000000-0000-4000-8000-000000009710'),
        '1999704', false, '00000000-0000-4000-8000-000000000001'
    )$$,
    '22023',
    'LWIN producer name is missing; choose a reviewed shared identity',
    'Missing producer names cannot all collapse into one Unknown producer'
);

-- A reviewed shared alias keeps a corrected producer name stable when an old
-- LWIN record still supplies the previous spelling.
insert into public.wine_reference_entities(id, entity_type)
values ('00000000-0000-4000-8000-000000009721', 'producer'),
       ('00000000-0000-4000-8000-000000009722', 'producer');
insert into public.wine_reference_producers(id, canonical_name)
values ('00000000-0000-4000-8000-000000009721', 'Domaine des Test Bernardins'),
       ('00000000-0000-4000-8000-000000009722', 'Another Test Domaine');
insert into public.wine_reference_aliases(
    entity_id, entity_type, alias_value, normalized_value, source_name
) values (
    '00000000-0000-4000-8000-000000009721', 'producer', 'de Test Bernardins',
    private.normalize_wine_reference_text('de Test Bernardins'), 'test-lwin'
);
select is(
    private.resolve_lwin_reference_producer('de Test Bernardins'),
    '00000000-0000-4000-8000-000000009721'::uuid,
    'A curated old LWIN spelling resolves to the existing corrected producer'
);
select is(
    (select count(*)::integer from public.wine_reference_producers
     where canonical_name = 'de Test Bernardins'),
    0,
    'Alias resolution does not create a second producer under the old spelling'
);
insert into public.wine_reference_aliases(
    entity_id, entity_type, alias_value, normalized_value, source_name
) values (
    '00000000-0000-4000-8000-000000009722', 'producer', 'de Test Bernardins',
    private.normalize_wine_reference_text('de Test Bernardins'), 'test-ambiguous'
);
select throws_ok(
    $$select private.resolve_lwin_reference_producer('de Test Bernardins')$$,
    '21000',
    'Shared producer alias is ambiguous; curator reconciliation is required',
    'Ambiguous shared aliases block LWIN promotion instead of choosing one'
);

select * from finish();
rollback;
