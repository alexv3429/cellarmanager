begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

create function pg_temp.rejects_with(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select has_function('public', 'drinking_window_preview_draft_batch',
    array['uuid', 'jsonb'], 'Canonical-key draft batch preview exists');
select has_function('public', 'drinking_window_preview_draft_coverage',
    array['uuid', 'jsonb'], 'Canonical-key draft coverage summary exists');
select ok(
    has_function_privilege('service_role',
        'public.drinking_window_preview_draft_batch(uuid,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.drinking_window_preview_draft_batch(uuid,jsonb)', 'EXECUTE')
    and not has_function_privilege('powersync_role',
        'public.drinking_window_preview_draft_batch(uuid,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.drinking_window_preview_draft_coverage(uuid,jsonb)', 'EXECUTE'),
    'Only the trusted service can run or summarize previews');
select ok(pg_temp.rejects_with($test$
    select * from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', '[]'::jsonb)
$test$, '22023'), 'A missing draft is rejected even for an empty batch');

insert into public.enrichment_places (id, place_type, canonical_name)
values ('e4000000-0000-4000-8000-000000000002', 'region',
    'Batch Preview Region');
insert into public.enrichment_places (id, parent_id, place_type, canonical_name)
values ('e4000000-0000-4000-8000-000000000003',
    'e4000000-0000-4000-8000-000000000002', 'appellation',
    'Batch Preview Appellation');
insert into public.wine_reference_entities (id, entity_type) values
    ('e4000000-0000-4000-8000-000000000004', 'producer'),
    ('e4000000-0000-4000-8000-000000000005', 'product'),
    ('e4000000-0000-4000-8000-000000000006', 'release');
insert into public.wine_reference_producers (id, canonical_name)
values ('e4000000-0000-4000-8000-000000000004', 'Batch Preview Producer');
insert into public.wine_reference_products (id, producer_id, canonical_name)
values ('e4000000-0000-4000-8000-000000000005',
    'e4000000-0000-4000-8000-000000000004', 'Batch Preview Cuvee');
insert into public.wine_reference_releases (id, product_id, vintage_year)
values ('e4000000-0000-4000-8000-000000000006',
    'e4000000-0000-4000-8000-000000000005', 2022);
insert into public.drinking_window_reference_versions (id, version_number)
values ('e4000000-0000-4000-8000-000000000001', 991310);
insert into public.drinking_window_reference_rows
    (id, version_id, scope, producer_id, product_id, release_id,
     appellation_id, region_id, wine_color, vintage_year, all_at_scope,
     first_trial_year, best_start_year, best_end_year, rationale)
values
    ('e4000000-0000-4000-8000-000000000007',
     'e4000000-0000-4000-8000-000000000001', 'release',
     'e4000000-0000-4000-8000-000000000004',
     'e4000000-0000-4000-8000-000000000005',
     'e4000000-0000-4000-8000-000000000006',
     'e4000000-0000-4000-8000-000000000003',
     'e4000000-0000-4000-8000-000000000002', 'red', 2022, true,
     2023, 2026, 2030, 'Synthetic exact window'),
    ('e4000000-0000-4000-8000-000000000008',
     'e4000000-0000-4000-8000-000000000001', 'region',
     null, null, null, null,
     'e4000000-0000-4000-8000-000000000002', 'red', 2022, true,
     2024, 2027, 2032, 'Synthetic regional window');

create function pg_temp.preview_keys()
returns jsonb language sql stable as $$
    select jsonb_build_array(
        jsonb_build_object(
            'producer_id', 'e4000000-0000-4000-8000-000000000004',
            'product_id', 'e4000000-0000-4000-8000-000000000005',
            'release_id', 'e4000000-0000-4000-8000-000000000006',
            'appellation_id', 'e4000000-0000-4000-8000-000000000003',
            'region_id', 'e4000000-0000-4000-8000-000000000002',
            'wine_color', 'red', 'vintage_year', 2022),
        jsonb_build_object(
            'producer_id', 'e4000000-0000-4000-8000-000000000004',
            'product_id', 'e4000000-0000-4000-8000-000000000005',
            'appellation_id', 'e4000000-0000-4000-8000-000000000003',
            'region_id', 'e4000000-0000-4000-8000-000000000002',
            'wine_color', 'red', 'vintage_year', 2022),
        jsonb_build_object('region_id', 'e4000000-0000-4000-8000-000000000002',
            'wine_color', 'white', 'vintage_year', 2022),
        jsonb_build_object('wine_color', 'red', 'vintage_year', 2022),
        jsonb_build_object(
            'producer_id', 'e4000000-0000-4000-8000-000000000004',
            'product_id', 'e4000000-0000-4000-8000-000000000005',
            'release_id', 'e4000000-0000-4000-8000-000000000006',
            'appellation_id', 'e4000000-0000-4000-8000-000000000003',
            'region_id', 'e4000000-0000-4000-8000-000000000002',
            'wine_color', 'red', 'vintage_year', 2023),
        jsonb_build_object(
            'producer_id', 'e4000000-0000-4000-8000-000000000004',
            'product_id', 'e4000000-0000-4000-8000-000000000005',
            'release_id', 'e4000000-0000-4000-8000-000000000006',
            'appellation_id', 'e4000000-0000-4000-8000-000000000003',
            'region_id', 'e4000000-0000-4000-8000-000000000002',
            'wine_color', 'red', 'vintage_year', 2022));
$$;

select is((select count(*) from public.drinking_window_preview_draft_batch(
    'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())),
    6::bigint, 'Each canonical lookup yields exactly one result');
select is((select string_agg(input_index::text || ':' || status || ':' ||
    coalesce(matched_scope, '-'), ',' order by input_index)
    from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())),
    '1:draft_match:release,2:draft_match:region,3:no_match:-,4:missing_key:-,5:identity_conflict:-,6:draft_match:release',
    'Batch preserves order, precedence, misses, and identity errors');
select is((select first_trial_year::text || '/' || best_start_year || '/' ||
    best_end_year from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())
    where input_index = 1), '2023/2026/2030',
    'Exact match keeps its complete three-year window');
select is((select first_trial_year::text || '/' || best_start_year || '/' ||
    best_end_year from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())
    where input_index = 2), '2024/2027/2032',
    'Broader match keeps its own complete three-year window');
select is((select status from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())
    where input_index = 3), 'no_match', 'Colour is never borrowed');
select is((select status from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())
    where input_index = 4), 'missing_key', 'Missing region is reported');
select is((select status from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())
    where input_index = 5), 'identity_conflict',
    'Release/vintage conflict does not produce a suggestion');
select is((select wine_count from public.drinking_window_preview_draft_coverage(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())
    where status = 'draft_match' and matched_scope = 'release'), 2::bigint,
    'Coverage groups duplicate exact matches without claiming publication');
select is((select sum(wine_count) from public.drinking_window_preview_draft_coverage(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())),
    6::numeric, 'Coverage accounts for every input, including misses');

select ok(pg_temp.rejects_with($test$
    select * from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001',
        '[{"household_id":"private"}]'::jsonb)
$test$, '22023'), 'Private household fields cannot be passed to the preview');
select ok(pg_temp.rejects_with($test$
    select * from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001',
        '[{"region_id":"not-a-uuid","wine_color":"red","vintage_year":2022}]'::jsonb)
$test$, '22023'), 'Malformed canonical IDs fail the whole batch');
select ok(pg_temp.rejects_with($test$
    select * from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001',
        '[{"region_id":123,"wine_color":"red","vintage_year":2022}]'::jsonb)
$test$, '22023'), 'Canonical IDs must be strings or null');
select ok(pg_temp.rejects_with($test$
    select * from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001',
        (select jsonb_agg('{}'::jsonb) from generate_series(1, 251)))
$test$, '22023'), 'Batch size is bounded');
select ok(pg_temp.rejects_with($test$
    select * from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', '[1]'::jsonb)
$test$, '22023'), 'Every batch entry must be an object');

insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition)
values ('e4000000-0000-4000-8000-000000000009',
    'e4000000-0000-4000-8000-000000000001', 'region',
    'e4000000-0000-4000-8000-000000000002', 'red',
    'competing', 'Synthetic competing regional group');
insert into public.drinking_window_ageing_group_memberships
    (version_id, group_id, member_kind, member_place_id, rationale)
values ('e4000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000009', 'place',
    'e4000000-0000-4000-8000-000000000003', 'Synthetic competing eligibility');
insert into public.drinking_window_reference_rows
    (version_id, scope, region_id, wine_color, vintage_year, ageing_group_id,
     first_trial_year, best_start_year, best_end_year, rationale)
values ('e4000000-0000-4000-8000-000000000001', 'region',
    'e4000000-0000-4000-8000-000000000002', 'red', 2022,
    'e4000000-0000-4000-8000-000000000009', 2025, 2028, 2035,
    'Synthetic conflicting regional window');
select is((select status from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())
    where input_index = 2), 'ambiguous',
    'Competing rows remain ambiguous in a batch');
select is((select reference_row_id from public.drinking_window_preview_draft_batch(
        'e4000000-0000-4000-8000-000000000001', pg_temp.preview_keys())
    where input_index = 2), null::uuid,
    'Ambiguous result exposes no arbitrary reference row');
select throws_ok($test$
    update public.drinking_window_reference_versions set status = 'active'
    where id = 'e4000000-0000-4000-8000-000000000001'
$test$, '23514', 'Drinking-window reference publication is not enabled',
    'Batch preview does not open publication');

select * from finish();
rollback;
