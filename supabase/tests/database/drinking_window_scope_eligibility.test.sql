begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.rejects_with(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select has_function('public', 'drinking_window_eligibility_issues', array['uuid'],
    'Scope and membership eligibility has a draft report');
select ok(
    has_function_privilege('service_role',
        'public.drinking_window_eligibility_issues(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.drinking_window_eligibility_issues(uuid)', 'EXECUTE')
    and not has_function_privilege('powersync_role',
        'public.drinking_window_eligibility_issues(uuid)', 'EXECUTE'),
    'Eligibility report is only available to the trusted service'
);
select ok(pg_temp.rejects_with($test$
    select * from public.drinking_window_eligibility_issues(
        'c1000000-0000-4000-8000-000000000001')
$test$, '22023'), 'A missing draft cannot be assessed');

insert into public.enrichment_places (id, place_type, canonical_name) values
    ('c1000000-0000-4000-8000-000000000002', 'region', 'Eligibility Region'),
    ('c1000000-0000-4000-8000-000000000003', 'region', 'Other Eligibility Region');
insert into public.enrichment_places (id, parent_id, place_type, canonical_name) values
    ('c1000000-0000-4000-8000-000000000004',
     'c1000000-0000-4000-8000-000000000002', 'appellation', 'Appellation One'),
    ('c1000000-0000-4000-8000-000000000005',
     'c1000000-0000-4000-8000-000000000002', 'appellation', 'Appellation Two');
insert into public.wine_reference_entities (id, entity_type) values
    ('c1000000-0000-4000-8000-000000000006', 'producer'),
    ('c1000000-0000-4000-8000-000000000007', 'producer'),
    ('c1000000-0000-4000-8000-000000000008', 'product'),
    ('c1000000-0000-4000-8000-000000000009', 'product');
insert into public.wine_reference_producers (id, canonical_name) values
    ('c1000000-0000-4000-8000-000000000006', 'First Eligibility Producer'),
    ('c1000000-0000-4000-8000-000000000007', 'Second Eligibility Producer');
insert into public.wine_reference_products (id, producer_id, canonical_name) values
    ('c1000000-0000-4000-8000-000000000008',
     'c1000000-0000-4000-8000-000000000006', 'First Eligibility Cuvee'),
    ('c1000000-0000-4000-8000-000000000009',
     'c1000000-0000-4000-8000-000000000007', 'Other Eligibility Cuvee');
insert into public.drinking_window_reference_versions (id, version_number)
values ('c1000000-0000-4000-8000-000000000001', 991301);

select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_ageing_groups
        (version_id, scope, region_id, wine_color, group_key, definition)
    values ('c1000000-0000-4000-8000-000000000001', 'appellation',
        'c1000000-0000-4000-8000-000000000002', 'red',
        'structured', 'Missing appellation identity')
$test$, '23514'), 'New appellation groups require an appellation identity');
select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_ageing_groups
        (version_id, scope, region_id, wine_color, group_key, definition)
    values ('c1000000-0000-4000-8000-000000000001', 'producer_region',
        'c1000000-0000-4000-8000-000000000002', 'red',
        'structured', 'Missing producer identity')
$test$, '23514'), 'New producer-region groups require a producer identity');

insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition,
     producer_id, appellation_id)
values
    ('c1000000-0000-4000-8000-000000000010',
     'c1000000-0000-4000-8000-000000000001', 'region',
     'c1000000-0000-4000-8000-000000000002', 'red',
     'structured', 'Regional structured group', null, null),
    ('c1000000-0000-4000-8000-000000000011',
     'c1000000-0000-4000-8000-000000000001', 'region',
     'c1000000-0000-4000-8000-000000000002', 'red',
     'early', 'Regional early group', null, null),
    ('c1000000-0000-4000-8000-000000000012',
     'c1000000-0000-4000-8000-000000000001', 'appellation',
     'c1000000-0000-4000-8000-000000000002', 'red',
     'structured', 'First appellation group', null,
     'c1000000-0000-4000-8000-000000000004'),
    ('c1000000-0000-4000-8000-000000000013',
     'c1000000-0000-4000-8000-000000000001', 'appellation',
     'c1000000-0000-4000-8000-000000000002', 'red',
     'structured', 'Second appellation group', null,
     'c1000000-0000-4000-8000-000000000005'),
    ('c1000000-0000-4000-8000-000000000014',
     'c1000000-0000-4000-8000-000000000001', 'producer_appellation',
     'c1000000-0000-4000-8000-000000000002', 'red',
     'structured', 'Producer appellation group',
     'c1000000-0000-4000-8000-000000000006',
     'c1000000-0000-4000-8000-000000000004');
select is((select count(*) from public.drinking_window_ageing_groups
    where group_key = 'structured' and scope = 'appellation'
      and version_id = 'c1000000-0000-4000-8000-000000000001'),
    2::bigint, 'The same local group name is valid in different appellations');

insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     ageing_group_id, first_trial_year, best_start_year, best_end_year, rationale)
values
    ('c1000000-0000-4000-8000-000000000015',
     'c1000000-0000-4000-8000-000000000001', 'region',
     'c1000000-0000-4000-8000-000000000002', 'red', 2022,
     'c1000000-0000-4000-8000-000000000010',
     2024, 2027, 2034, 'First complete synthetic regional window'),
    ('c1000000-0000-4000-8000-000000000016',
     'c1000000-0000-4000-8000-000000000001', 'region',
     'c1000000-0000-4000-8000-000000000002', 'red', 2022,
     'c1000000-0000-4000-8000-000000000011',
     2024, 2025, 2030, 'Second complete synthetic regional window');
insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_product_id, rationale)
values ('c1000000-0000-4000-8000-000000000017',
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000010', 'product',
    'c1000000-0000-4000-8000-000000000008', 'Legacy unanchored cuvee');
select is((select count(*) from public.drinking_window_eligibility_issues(
    'c1000000-0000-4000-8000-000000000001')
    where issue_code = 'membership_place_missing'), 1::bigint,
    'An unanchored product membership cannot silently cover every place');
update public.drinking_window_ageing_group_memberships
set member_place_id = 'c1000000-0000-4000-8000-000000000004'
where id = 'c1000000-0000-4000-8000-000000000017';
select is((select count(*) from public.drinking_window_eligibility_issues(
    'c1000000-0000-4000-8000-000000000001')
    where issue_code = 'membership_place_missing'), 0::bigint,
    'Anchoring the cuvee to its appellation resolves the ambiguity');

insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_place_id, rationale)
values ('c1000000-0000-4000-8000-000000000018',
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000011', 'place',
    'c1000000-0000-4000-8000-000000000004', 'Overlapping appellation membership');
select is((select count(*) from public.drinking_window_eligibility_issues(
    'c1000000-0000-4000-8000-000000000001')
    where issue_code = 'membership_place_overlap'), 1::bigint,
    'Place and cuvee memberships in competing regional groups overlap');
update public.drinking_window_ageing_group_memberships
set member_place_id = 'c1000000-0000-4000-8000-000000000005'
where id = 'c1000000-0000-4000-8000-000000000018';
select is((select count(*) from public.drinking_window_eligibility_issues(
    'c1000000-0000-4000-8000-000000000001')
    where issue_code = 'membership_place_overlap'), 0::bigint,
    'Distinct appellations do not create a false overlap');

insert into public.drinking_window_reference_rows
    (id, version_id, scope, appellation_id, region_id, wine_color,
     vintage_year, ageing_group_id, first_trial_year, best_start_year,
     best_end_year, rationale)
values ('c1000000-0000-4000-8000-000000000019',
    'c1000000-0000-4000-8000-000000000001', 'appellation',
    'c1000000-0000-4000-8000-000000000005',
    'c1000000-0000-4000-8000-000000000002', 'red', 2022,
    'c1000000-0000-4000-8000-000000000012', 2024, 2027, 2034,
    'Synthetic row using another appellation group');
select is((select count(*) from public.drinking_window_eligibility_issues(
    'c1000000-0000-4000-8000-000000000001')
    where issue_code = 'row_group_identity_mismatch'), 1::bigint,
    'A row cannot borrow an ageing group from another appellation');

insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_place_id, rationale)
values ('c1000000-0000-4000-8000-000000000020',
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000012', 'place',
    'c1000000-0000-4000-8000-000000000005', 'Place outside scoped appellation');
select is((select count(*) from public.drinking_window_eligibility_issues(
    'c1000000-0000-4000-8000-000000000001')
    where issue_code = 'membership_outside_group_place'), 1::bigint,
    'Scoped group membership must stay within its appellation');

insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_place_id,
     member_product_id, rationale)
values ('c1000000-0000-4000-8000-000000000021',
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000014', 'product',
    'c1000000-0000-4000-8000-000000000004',
    'c1000000-0000-4000-8000-000000000009',
    'Other producers cuvee is ineligible');
select is((select count(*) from public.drinking_window_eligibility_issues(
    'c1000000-0000-4000-8000-000000000001')
    where issue_code = 'membership_producer_mismatch'), 1::bigint,
    'Producer-appellation group rejects another producers cuvee');

select ok(pg_temp.rejects_with($test$
    update public.drinking_window_reference_versions set status = 'active',
        published_at = now()
    where id = 'c1000000-0000-4000-8000-000000000001'
$test$, '23514'), 'Publication remains disabled');

select * from finish();
rollback;
