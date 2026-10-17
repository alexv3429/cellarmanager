begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function('public', 'drinking_window_preview_draft_match',
    array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'text', 'integer', 'uuid'],
    'A draft-only reference selector exists');
select ok(
    has_function_privilege('service_role',
        'public.drinking_window_preview_draft_match(uuid,uuid,uuid,uuid,uuid,uuid,text,integer,uuid)',
        'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.drinking_window_preview_draft_match(uuid,uuid,uuid,uuid,uuid,uuid,text,integer,uuid)',
        'EXECUTE')
    and not has_function_privilege('powersync_role',
        'public.drinking_window_preview_draft_match(uuid,uuid,uuid,uuid,uuid,uuid,text,integer,uuid)',
        'EXECUTE'),
    'Only the trusted service can preview draft matches');

insert into public.enrichment_places (id, place_type, canonical_name) values
    ('d3000000-0000-4000-8000-000000000002', 'region', 'Selector Region'),
    ('d3000000-0000-4000-8000-000000000003', 'region', 'Other Selector Region');
insert into public.enrichment_places (id, parent_id, place_type, canonical_name) values
    ('d3000000-0000-4000-8000-000000000004',
     'd3000000-0000-4000-8000-000000000002', 'appellation', 'Selector Appellation'),
    ('d3000000-0000-4000-8000-000000000005',
     'd3000000-0000-4000-8000-000000000002', 'appellation', 'Other Selector Appellation');
insert into public.wine_reference_entities (id, entity_type) values
    ('d3000000-0000-4000-8000-000000000006', 'producer'),
    ('d3000000-0000-4000-8000-000000000007', 'producer'),
    ('d3000000-0000-4000-8000-000000000008', 'product'),
    ('d3000000-0000-4000-8000-000000000009', 'product'),
    ('d3000000-0000-4000-8000-000000000010', 'release');
insert into public.wine_reference_producers (id, canonical_name) values
    ('d3000000-0000-4000-8000-000000000006', 'Selector Producer'),
    ('d3000000-0000-4000-8000-000000000007', 'Other Selector Producer');
insert into public.wine_reference_products (id, producer_id, canonical_name) values
    ('d3000000-0000-4000-8000-000000000008',
     'd3000000-0000-4000-8000-000000000006', 'Selector Cuvee'),
    ('d3000000-0000-4000-8000-000000000009',
     'd3000000-0000-4000-8000-000000000007', 'Other Selector Cuvee');
insert into public.wine_reference_releases (id, product_id, vintage_year) values
    ('d3000000-0000-4000-8000-000000000010',
     'd3000000-0000-4000-8000-000000000008', 2022);
insert into public.drinking_window_reference_versions (id, version_number) values
    ('d3000000-0000-4000-8000-000000000001', 991309);

insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition,
     producer_id, appellation_id)
values
    ('d3000000-0000-4000-8000-000000000011',
     'd3000000-0000-4000-8000-000000000001', 'producer_appellation',
     'd3000000-0000-4000-8000-000000000002', 'red',
     'cuvee', 'Synthetic cuvee group',
     'd3000000-0000-4000-8000-000000000006',
     'd3000000-0000-4000-8000-000000000004'),
    ('d3000000-0000-4000-8000-000000000012',
     'd3000000-0000-4000-8000-000000000001', 'producer_region',
     'd3000000-0000-4000-8000-000000000002', 'red',
     'cuvee', 'Synthetic producer-wide group',
     'd3000000-0000-4000-8000-000000000006', null),
    ('d3000000-0000-4000-8000-000000000013',
     'd3000000-0000-4000-8000-000000000001', 'appellation',
     'd3000000-0000-4000-8000-000000000002', 'red',
     'all', 'Synthetic appellation group', null,
     'd3000000-0000-4000-8000-000000000004'),
    ('d3000000-0000-4000-8000-000000000014',
     'd3000000-0000-4000-8000-000000000001', 'region',
     'd3000000-0000-4000-8000-000000000002', 'red',
     'all', 'Synthetic regional group', null, null);
insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_place_id,
     member_product_id, first_vintage_year, last_vintage_year, rationale)
values
    ('d3000000-0000-4000-8000-000000000015',
     'd3000000-0000-4000-8000-000000000001',
     'd3000000-0000-4000-8000-000000000011', 'product',
     'd3000000-0000-4000-8000-000000000004',
     'd3000000-0000-4000-8000-000000000008', 2022, 2022,
     'Synthetic product and place eligibility'),
    ('d3000000-0000-4000-8000-000000000016',
     'd3000000-0000-4000-8000-000000000001',
     'd3000000-0000-4000-8000-000000000012', 'product',
     'd3000000-0000-4000-8000-000000000004',
     'd3000000-0000-4000-8000-000000000008', 2022, 2022,
     'Synthetic producer-wide eligibility'),
    ('d3000000-0000-4000-8000-000000000017',
     'd3000000-0000-4000-8000-000000000001',
     'd3000000-0000-4000-8000-000000000013', 'place',
     'd3000000-0000-4000-8000-000000000004', null, null, null,
     'Synthetic appellation eligibility'),
    ('d3000000-0000-4000-8000-000000000018',
     'd3000000-0000-4000-8000-000000000001',
     'd3000000-0000-4000-8000-000000000014', 'place',
     'd3000000-0000-4000-8000-000000000002', null, null, null,
     'Synthetic regional eligibility');

insert into public.drinking_window_reference_rows
    (id, version_id, scope, producer_id, product_id, release_id,
     appellation_id, region_id, wine_color, vintage_year, ageing_group_id,
     all_at_scope, first_trial_year, best_start_year, best_end_year, rationale)
values
    ('d3000000-0000-4000-8000-000000000019',
     'd3000000-0000-4000-8000-000000000001', 'release',
     'd3000000-0000-4000-8000-000000000006',
     'd3000000-0000-4000-8000-000000000008',
     'd3000000-0000-4000-8000-000000000010',
     'd3000000-0000-4000-8000-000000000004',
     'd3000000-0000-4000-8000-000000000002', 'red', 2022,
     null, true, 2023, 2026, 2030, 'Synthetic exact release'),
    ('d3000000-0000-4000-8000-000000000020',
     'd3000000-0000-4000-8000-000000000001', 'producer_appellation',
     'd3000000-0000-4000-8000-000000000006', null, null,
     'd3000000-0000-4000-8000-000000000004',
     'd3000000-0000-4000-8000-000000000002', 'red', 2022,
     'd3000000-0000-4000-8000-000000000011', false,
     2024, 2027, 2031, 'Synthetic producer-appellation'),
    ('d3000000-0000-4000-8000-000000000021',
     'd3000000-0000-4000-8000-000000000001', 'producer_region',
     'd3000000-0000-4000-8000-000000000006', null, null, null,
     'd3000000-0000-4000-8000-000000000002', 'red', 2022,
     'd3000000-0000-4000-8000-000000000012', false,
     2025, 2028, 2032, 'Synthetic producer-region'),
    ('d3000000-0000-4000-8000-000000000022',
     'd3000000-0000-4000-8000-000000000001', 'appellation',
     null, null, null, 'd3000000-0000-4000-8000-000000000004',
     'd3000000-0000-4000-8000-000000000002', 'red', 2022,
     'd3000000-0000-4000-8000-000000000013', false,
     2026, 2029, 2033, 'Synthetic appellation'),
    ('d3000000-0000-4000-8000-000000000023',
     'd3000000-0000-4000-8000-000000000001', 'region',
     null, null, null, null,
     'd3000000-0000-4000-8000-000000000002', 'red', 2022,
     'd3000000-0000-4000-8000-000000000014', false,
     2027, 2030, 2034, 'Synthetic region');

create function pg_temp.match_selector(
    p_producer uuid default 'd3000000-0000-4000-8000-000000000006',
    p_product uuid default 'd3000000-0000-4000-8000-000000000008',
    p_release uuid default 'd3000000-0000-4000-8000-000000000010',
    p_appellation uuid default 'd3000000-0000-4000-8000-000000000004',
    p_region uuid default 'd3000000-0000-4000-8000-000000000002',
    p_color text default 'red', p_vintage integer default 2022)
returns table(status text, matched_scope text, reference_row_id uuid,
    first_trial_year integer, best_start_year integer, best_end_year integer,
    reason text)
language sql stable as $$
    select * from public.drinking_window_preview_draft_match(
        'd3000000-0000-4000-8000-000000000001',
        p_producer, p_product, p_release, p_appellation,
        p_region, p_color, p_vintage);
$$;

select is((select matched_scope from pg_temp.match_selector()),
    'release', 'Exact release wins over every broader scope');
select is((select first_trial_year::text || '/' || best_start_year || '/' ||
                  best_end_year from pg_temp.match_selector()),
    '2023/2026/2030', 'All three years come from the exact release row');

delete from public.drinking_window_reference_rows
where id = 'd3000000-0000-4000-8000-000000000019';
select is((select matched_scope from pg_temp.match_selector()),
    'producer_appellation', 'Producer-appellation wins after exact release');

select is((select matched_scope from pg_temp.match_selector(
    p_product => null, p_release => null)), 'appellation',
    'Unknown cuvee cannot inherit a product-specific producer group');
select is((select matched_scope from pg_temp.match_selector(
    p_appellation => 'd3000000-0000-4000-8000-000000000005')),
    'region', 'A producer group anchored to another appellation cannot match');

delete from public.drinking_window_reference_rows
where id = 'd3000000-0000-4000-8000-000000000020';
select is((select matched_scope from pg_temp.match_selector()),
    'producer_region', 'Producer-region wins after producer-appellation');
delete from public.drinking_window_reference_rows
where id = 'd3000000-0000-4000-8000-000000000021';
select is((select matched_scope from pg_temp.match_selector()),
    'appellation', 'Appellation wins after producer-region');
delete from public.drinking_window_reference_rows
where id = 'd3000000-0000-4000-8000-000000000022';
select is((select matched_scope from pg_temp.match_selector()),
    'region', 'Region is the final authored reference scope');
select is((select first_trial_year::text || '/' || best_start_year || '/' ||
                  best_end_year from pg_temp.match_selector()),
    '2027/2030/2034', 'The regional result keeps its own complete window');

select is((select status from pg_temp.match_selector(p_color => 'white')),
    'no_match', 'A different colour does not borrow red dates');
select is((select status from pg_temp.match_selector(
    p_region => 'd3000000-0000-4000-8000-000000000003',
    p_appellation => null, p_release => null)),
    'no_match', 'A different region does not borrow dates');
select is((select status from pg_temp.match_selector(p_vintage => 2023,
    p_release => null)), 'no_match', 'A different vintage does not borrow dates');
select is((select status from pg_temp.match_selector(p_region => null)),
    'missing_key', 'Missing region yields no suggestion');
select is((select status from pg_temp.match_selector(p_vintage => 2023)),
    'identity_conflict', 'Release/vintage disagreement is rejected');
select is((select status from pg_temp.match_selector(
    p_product => 'd3000000-0000-4000-8000-000000000009', p_release => null)),
    'identity_conflict', 'Producer/product disagreement is rejected');

insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition)
values ('d3000000-0000-4000-8000-000000000024',
    'd3000000-0000-4000-8000-000000000001', 'region',
    'd3000000-0000-4000-8000-000000000002', 'red',
    'competing', 'Synthetic competing group');
insert into public.drinking_window_ageing_group_memberships
    (version_id, group_id, member_kind, member_place_id, rationale)
values ('d3000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000024', 'place',
    'd3000000-0000-4000-8000-000000000004', 'Synthetic overlapping place');
insert into public.drinking_window_reference_rows
    (version_id, scope, region_id, wine_color, vintage_year,
     ageing_group_id, first_trial_year, best_start_year, best_end_year, rationale)
values ('d3000000-0000-4000-8000-000000000001', 'region',
    'd3000000-0000-4000-8000-000000000002', 'red', 2022,
    'd3000000-0000-4000-8000-000000000024',
    2025, 2028, 2035, 'Synthetic conflicting window');
select is((select status from pg_temp.match_selector()), 'ambiguous',
    'Same-scope conflicting windows stop selection');
select is((select reference_row_id from pg_temp.match_selector()), null::uuid,
    'Ambiguous result exposes no arbitrary row or dates');

select throws_ok($test$
    update public.drinking_window_reference_versions set status = 'active'
    where id = 'd3000000-0000-4000-8000-000000000001'
$test$, '23514', 'Drinking-window reference publication requires the trusted publisher',
    'Preview does not open publication');

select * from finish();
rollback;
