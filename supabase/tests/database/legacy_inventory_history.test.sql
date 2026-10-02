begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_table_privilege('authenticated', 'public.legacy_inventory_events', 'INSERT'),
    'Browser clients cannot insert archived history');
select ok(not has_table_privilege('authenticated', 'public.legacy_inventory_events', 'UPDATE'),
    'Browser clients cannot edit archived history');
select ok(not has_table_privilege('authenticated', 'public.legacy_inventory_events', 'DELETE'),
    'Browser clients cannot delete archived history');
select ok(has_table_privilege('service_role', 'public.legacy_inventory_events', 'INSERT'),
    'Trusted preview-approved importer can insert');
select ok(not has_table_privilege('service_role', 'public.legacy_inventory_events', 'UPDATE'),
    'Trusted importer cannot rewrite archived history');
select ok(not has_table_privilege('service_role', 'public.legacy_inventory_events', 'DELETE'),
    'Trusted importer cannot delete archived history');

insert into public.legacy_inventory_events (
    id, household_id, wine_id, archive_source_sha256, source_record_id,
    source_holding_id, event_type, quantity, remove_reason,
    occurred_at, recorded_at, source_from_cellar_id, source_from_location,
    source_to_cellar_id, source_to_location, imported_by
) values (
    '00000000-0000-4000-8000-000000009711',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    repeat('a', 64),
    '00000000-0000-4000-8000-000000009712',
    '00000000-0000-4000-8000-000000000130',
    'OPENING_BALANCE', 5, null,
    '2026-07-16T12:00:00Z', '2026-07-16T12:01:00Z',
    null, null, '00000000-0000-4000-8000-000000000120', 'A',
    '00000000-0000-4000-8000-000000000001'
), (
    '00000000-0000-4000-8000-000000009713',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    repeat('a', 64),
    '00000000-0000-4000-8000-000000009714',
    '00000000-0000-4000-8000-000000000130',
    'REMOVE', 1, 'DRANK',
    '2026-07-30T12:00:00Z', '2026-07-30T12:01:00Z',
    '00000000-0000-4000-8000-000000000120', 'A', null, null,
    '00000000-0000-4000-8000-000000000001'
), (
    '00000000-0000-4000-8000-000000009715',
    '00000000-0000-4000-8000-000000000200',
    '00000000-0000-4000-8000-000000000210',
    repeat('a', 64),
    '00000000-0000-4000-8000-000000009716',
    null,
    'OPENING_BALANCE', 1, null,
    '2026-07-16T12:00:00Z', '2026-07-16T12:01:00Z',
    null, null, '00000000-0000-4000-8000-000000000220', null,
    '00000000-0000-4000-8000-000000000002'
);

select is((select quantity from public.holdings where id =
    '00000000-0000-4000-8000-000000000130'), 5,
    'Importing history does not replay opening stock or removals');
select is((select count(*) from public.inventory_operations where id in (
    '00000000-0000-4000-8000-000000009711',
    '00000000-0000-4000-8000-000000009713')),
    0::bigint, 'History import does not create modern stock operations');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is((select count(*) from public.legacy_inventory_events), 2::bigint,
    'Owner reads only own household legacy rows');
select is((select count(*) from public.inventory_reporting_events
    where event_source = 'LEGACY_V01'), 2::bigint,
    'Reporting view includes only own household legacy rows');
select is((select event_type from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009712'),
    'OPENING_BALANCE', 'Opening balance is not represented as acquisition ADD');
select is((select remove_reason from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009714'),
    'DRANK', 'Confirmed historic removal retains its reason');
select ok(not (select was_applied_to_stock from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009712'),
    'Legacy event is not a modern stock operation');
select is((select actor_user_id from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009714'),
    null::uuid, 'No current user is falsely attributed to legacy activity');
select is((select destination_legacy_location from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009712'),
    'A', 'Original location label remains separate from current location IDs');
select is((select source_location_id from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009714'),
    null::uuid, 'Legacy location is not guessed into a current location ID');

select throws_ok($test$
    insert into public.legacy_inventory_events (
        id, household_id, wine_id, archive_source_sha256, source_record_id,
        event_type, quantity, occurred_at, recorded_at, source_to_cellar_id,
        imported_by
    ) values (
        '00000000-0000-4000-8000-000000009717',
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000110',
        repeat('a', 64),
        '00000000-0000-4000-8000-000000009718',
        'OPENING_BALANCE', 1,
        now(), now(), '00000000-0000-4000-8000-000000000120',
        '00000000-0000-4000-8000-000000000001'
    )
$test$, '42501', 'permission denied for table legacy_inventory_events',
    'Owner cannot invent historic events through the browser');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is((select count(*) from public.legacy_inventory_events), 1::bigint,
    'Second household sees only its own archived event');

select * from finish();
rollback;
