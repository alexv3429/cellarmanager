begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-4000-8000-000000000003', 'history-reader@example.test', '{}'::jsonb);
insert into public.household_members (household_id, user_id, role) values
    ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000003', 'member');

select ok(has_table_privilege('authenticated', 'public.inventory_reporting_events', 'SELECT'),
    'Authenticated users may read the reporting view');
select ok(not has_table_privilege('anon', 'public.inventory_reporting_events', 'SELECT'),
    'Anonymous users cannot read the reporting view');
select ok(not has_table_privilege('authenticated', 'public.inventory_reporting_events', 'INSERT'),
    'Browser clients cannot insert reporting events');
select ok(not has_table_privilege('authenticated', 'public.inventory_reporting_events', 'UPDATE'),
    'Browser clients cannot edit reporting events');
select ok(not has_table_privilege('authenticated', 'public.inventory_reporting_events', 'DELETE'),
    'Browser clients cannot delete reporting events');
select ok(not has_table_privilege('service_role', 'public.inventory_reporting_events', 'UPDATE'),
    'Trusted services cannot edit through the reporting view');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is((select operation_status from public.apply_inventory_operation(
    '00000000-0000-4000-8000-000000009701',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101',
    'ADD', '00000000-0000-4000-8000-000000000110', null,
    '00000000-0000-4000-8000-000000000121', 1,
    '2026-10-01T08:00:00Z', null)), 'ACCEPTED', 'ADD accepted');

select is((select operation_status from public.apply_inventory_operation(
    '00000000-0000-4000-8000-000000009702',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101',
    'MOVE', '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000121',
    '00000000-0000-4000-8000-000000000122', 1,
    '2026-10-01T08:01:00Z', null)), 'ACCEPTED', 'MOVE accepted');

select is((select operation_status from public.apply_inventory_operation(
    '00000000-0000-4000-8000-000000009703',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101',
    'REMOVE', '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000122', null, 1,
    '2026-10-01T08:02:00Z', 'DRANK')), 'ACCEPTED', 'DRANK removal accepted');

select is((select operation_status from public.apply_inventory_operation(
    '00000000-0000-4000-8000-000000009704',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101',
    'REMOVE', '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000122', null, 99,
    '2026-10-01T08:03:00Z', 'DRANK')), 'REJECTED', 'Impossible removal rejected');

select is((select count(*) from public.inventory_reporting_events), 3::bigint,
    'Only accepted operations appear in history');
select is((select count(*) from public.inventory_reporting_events
    where event_type = 'MOVE'), 1::bigint, 'MOVE is one event');
select is((select count(*) from public.inventory_reporting_events
    where event_type = 'REMOVE' and remove_reason = 'DRANK'), 1::bigint,
    'Confirmed consumption retains its reason');
select is((select event_key from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009701'),
    'operation:00000000-0000-4000-8000-000000009701', 'The event key is stable and source-namespaced');
select is((select event_source from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009701'),
    'ACCEPTED_OPERATION', 'Modern event provenance is explicit');
select is((select occurred_at from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009701'),
    '2026-10-01T08:00:00Z'::timestamptz, 'Client-claimed action time is preserved');
select ok((select recorded_at is not null from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009701'),
    'Server receipt time is available separately');
select is((select occurred_at_precision from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009701'),
    'INSTANT', 'Modern event timestamps have instant precision');
select ok((select was_applied_to_stock from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009701'),
    'Accepted modern events record that their effect was already applied');
select is((select source_location_id from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009702'),
    '00000000-0000-4000-8000-000000000121'::uuid, 'MOVE retains source location');
select is((select destination_location_id from public.inventory_reporting_events
    where source_record_id = '00000000-0000-4000-8000-000000009702'),
    '00000000-0000-4000-8000-000000000122'::uuid, 'MOVE retains destination location');
select is((select quantity from public.holdings where wine_id =
    '00000000-0000-4000-8000-000000000110' and location_id =
    '00000000-0000-4000-8000-000000000121'), 5,
    'Reporting reads do not replay operations into holdings');

select is((select operation_status from public.apply_inventory_operation(
    '00000000-0000-4000-8000-000000009701',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101',
    'ADD', '00000000-0000-4000-8000-000000000110', null,
    '00000000-0000-4000-8000-000000000121', 1,
    '2026-10-01T08:00:00Z', null)), 'ACCEPTED', 'Operation retry remains idempotent');
select is((select count(*) from public.inventory_reporting_events), 3::bigint,
    'Retried operation does not duplicate its reporting event');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select is((select count(*) from public.inventory_reporting_events), 3::bigint,
    'Household Member can read shared history');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is((select count(*) from public.inventory_reporting_events), 0::bigint,
    'Other household cannot read private history');
select is((select operation_status from public.apply_inventory_operation(
    '00000000-0000-4000-8000-000000009705',
    '00000000-0000-4000-8000-000000000200',
    '00000000-0000-4000-8000-000000000201',
    'ADD', '00000000-0000-4000-8000-000000000210', null,
    '00000000-0000-4000-8000-000000000221', 1,
    '2026-10-01T09:00:00Z', null)), 'ACCEPTED', 'Other household ADD accepted');
select is((select count(*) from public.inventory_reporting_events), 1::bigint,
    'Other household sees only its own event');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is((select count(*) from public.inventory_reporting_events), 3::bigint,
    'First household cannot read the second household event');

select * from finish();
rollback;
