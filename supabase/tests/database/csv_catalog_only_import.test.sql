begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.import_row(p_record integer, p_wine uuid, p_quantity integer,
    p_producer text default 'Catalog Estate', p_cuvee text default 'Archive',
    p_action text default 'create', p_destination uuid default null)
returns jsonb language sql as $$
    select jsonb_build_object('record_number', p_record,
        'operation_id', ('20000000-0000-4000-8000-' || lpad(p_record::text, 12, '0'))::uuid,
        'requested_wine_id', p_wine, 'quantity', p_quantity, 'wine_action', p_action,
        'destination_location_id', p_destination, 'wine_producer', p_producer, 'wine_cuvee', p_cuvee,
        'wine_vintage', 2020, 'wine_color', 'red', 'wine_appellation', null, 'wine_area', null, 'wine_format_ml', 750);
$$;

select ok(not has_function_privilege('authenticated',
    'private.resolve_csv_catalog_wine(uuid,uuid,text,text,integer,text,text,text,integer)', 'EXECUTE'),
    'Catalog-only resolver is not an exposed permission bypass');
select ok(not has_function_privilege('authenticated',
    'private.commit_csv_import_unchecked(uuid,uuid,uuid,jsonb,timestamptz)', 'EXECUTE'),
    'Import implementation remains private');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
create temporary table zero_plan as select jsonb_build_array(
    pg_temp.import_row(2, '00000000-0000-4000-8000-000000009501', 0),
    pg_temp.import_row(3, '00000000-0000-4000-8000-000000009501', 0),
    pg_temp.import_row(4, '00000000-0000-4000-8000-000000000110', 0, 'Domaine Test', 'Cuvée Offline', 'reuse')
) as payload;
create temporary table zero_result as select * from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009500', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', (select payload from zero_plan), '2026-09-20T12:00:00Z');
select is((select imported_row_count from zero_result), 3, 'Every catalog-only row is accounted for');
select is((select imported_bottle_count from zero_result), 0::bigint, 'A zero-only import has a durable zero-bottle receipt');
select is((select created_wine_count from zero_result), 1, 'Repeated zero rows create one wine');
select is((select reused_wine_count from zero_result), 1, 'The existing catalog wine is reused');
select is((select count(*) from public.holdings where wine_id = '00000000-0000-4000-8000-000000009501'),
    0::bigint, 'Catalog-only import creates no physical position');
select is((select quantity from public.holdings where wine_id = '00000000-0000-4000-8000-000000000110'
    and location_id = '00000000-0000-4000-8000-000000000121'), 5, 'Zero never resets existing stock');
select is((select count(*) from public.inventory_operations where id::text like '20000000-%'),
    0::bigint, 'Catalog-only rows create no ADD or consumption events');
select is((select imported_row_count from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009500', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', (select payload from zero_plan), '2026-09-20T12:00:00Z')),
    3, 'Identical retry returns the original receipt');
select throws_ok($q$select * from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009500', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', '[]', '2026-09-20T12:00:00Z')$q$,
    '22023', null, 'Changed retry payload cannot silently reuse a receipt');
select is((select imported_bottle_count from public.get_csv_import_receipt(
    '00000000-0000-4000-8000-000000009500', '00000000-0000-4000-8000-000000000100')),
    0::bigint, 'Recovery can read a catalog-only receipt');

create temporary table mixed_result as select * from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009502', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', jsonb_build_array(
        pg_temp.import_row(5, '00000000-0000-4000-8000-000000009503', 0, 'Mixed Estate'),
        pg_temp.import_row(6, '00000000-0000-4000-8000-000000009503', 2, 'Mixed Estate', 'Archive', 'create',
            '00000000-0000-4000-8000-000000000121'),
        pg_temp.import_row(7, '00000000-0000-4000-8000-000000009503', 0, 'Mixed Estate')
    ), '2026-09-20T12:00:00Z');
select is((select imported_bottle_count from mixed_result), 2::bigint, 'Mixed receipt counts only actual bottles');
select is((select created_wine_count from mixed_result), 1, 'Zero and stocked rows share one wine');
select is((select quantity from public.holdings where wine_id = '00000000-0000-4000-8000-000000009503'),
    2, 'Only the positive row creates stock');
select is((select count(*) from public.inventory_operations where wine_id = '00000000-0000-4000-8000-000000009503'),
    1::bigint, 'Only the positive row creates an inventory event');

-- Failure of any row rolls back the catalog-only rows in the same transaction.
select throws_ok($q$select * from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009504', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', jsonb_build_array(
        pg_temp.import_row(8, '00000000-0000-4000-8000-000000009505', 0, 'Rollback Estate'),
        pg_temp.import_row(9, '00000000-0000-4000-8000-000000009506', -1)
    ), now())$q$, '22023', null, 'Negative quantity aborts the whole import');
select is((select count(*) from public.wines where producer = 'Rollback Estate'), 0::bigint,
    'No catalog row survives a failed transaction');
select is((select count(*) from public.get_csv_import_receipt(
    '00000000-0000-4000-8000-000000009504', '00000000-0000-4000-8000-000000000100')), 0::bigint,
    'Failed transaction has no receipt');

select throws_ok(format($q$select * from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009507', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', jsonb_build_array(%L::jsonb), now())$q$,
    pg_temp.import_row(10, '00000000-0000-4000-8000-000000009508', 0) || bad.patch),
    '22023', null, bad.label)
from (values
    ('{"quantity":null}'::jsonb, 'Missing quantity is not zero'),
    ('{"quantity":0.5}', 'Fractional quantity is rejected'),
    ('{"wine_action":null}', 'Missing action is rejected'),
    ('{"wine_format_ml":0}', 'Catalog-only wine still needs a valid bottle format'),
    ('{"wine_cuvee":""}', 'Catalog-only wine still needs a valid name'),
    ('{"destination_location_id":"00000000-0000-4000-8000-000000000121"}', 'Catalog-only rows never use storage'),
    ('{"requested_wine_id":"00000000-0000-4000-8000-000000000110","wine_action":"reuse"}', 'Existing identity cannot be overwritten')
) bad(patch, label);

reset role;
insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000009509', 'csv-reader@example.test');
insert into public.household_members(household_id, user_id, role) values
    ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009509', 'member');
insert into public.devices(id, household_id, user_id, name, revoked_at) values
    ('00000000-0000-4000-8000-000000009510', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000001', 'Revoked synthetic importer', now());
set local role authenticated;
select throws_ok($q$select * from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009511', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000009510', (select payload from zero_plan), now())$q$,
    '42501', null, 'A revoked device cannot import catalog-only rows');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009509';
select throws_ok($q$select * from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009511', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', (select payload from zero_plan), now())$q$,
    '42501', 'Household owner permission is required', 'A member cannot use catalog-only import to mutate the catalog');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select throws_ok($q$select * from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009511', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', (select payload from zero_plan), now())$q$,
    '42501', null, 'An outsider cannot import into another household');

select * from finish();
rollback;
