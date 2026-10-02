begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_table_privilege('authenticated', 'public.wine_acquisitions', 'SELECT'),
    'Authenticated users can query owner-filtered acquisition history');
select ok(not has_table_privilege('authenticated', 'public.wine_acquisitions', 'INSERT'),
    'Browser cannot insert acquisition rows directly');
select ok(not has_table_privilege('authenticated', 'public.wine_acquisitions', 'UPDATE'),
    'Browser cannot bypass the guarded correction RPC');
select ok(not has_table_privilege('authenticated', 'public.wine_acquisitions', 'DELETE'),
    'Browser cannot erase purchase history directly');
select ok(has_table_privilege('service_role', 'public.wine_acquisitions', 'INSERT'),
    'Trusted historical importer may insert reviewed source records');
select ok(not has_table_privilege('service_role', 'public.wine_acquisitions', 'UPDATE'),
    'Trusted importer cannot rewrite source records');

insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000003', 'acquisition-reader@example.test', '{}'::jsonb);
insert into public.household_members (household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000003', 'member');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(public.upsert_wine_acquisition(
    '00000000-0000-4000-8000-000000009801',
    '00000000-0000-4000-8000-000000000110',
    'PURCHASE', 3, '2024-05-02', 12.50, 'eur', 'Wine shop', 'Invoice checked'
), '00000000-0000-4000-8000-000000009801'::uuid,
    'Owner can record a wine purchase without a stock operation');
select is((select unit_price_amount from public.wine_acquisitions
    where id = '00000000-0000-4000-8000-000000009801'), 12.50::numeric,
    'Price paid per bottle is retained exactly');
select is((select price_currency from public.wine_acquisitions
    where id = '00000000-0000-4000-8000-000000009801'), 'EUR',
    'Currency is normalized');
select is((select quantity from public.holdings
    where id = '00000000-0000-4000-8000-000000000130'), 5,
    'Purchase history does not add to current stock');
select is((select count(*) from public.inventory_operations
    where wine_id = '00000000-0000-4000-8000-000000000110'), 0::bigint,
    'Purchase history does not invent an inventory ADD');

select is(public.upsert_wine_acquisition(
    '00000000-0000-4000-8000-000000009801',
    '00000000-0000-4000-8000-000000000110',
    'PURCHASE', 2, '2024-05-02', 11.25, 'EUR', 'Wine shop', null
), '00000000-0000-4000-8000-000000009801'::uuid,
    'Owner can correct an existing manual record idempotently');
select is((select count(*) from public.wine_acquisitions
    where id = '00000000-0000-4000-8000-000000009801'), 1::bigint,
    'Correction does not duplicate the purchase');
select is((select quantity from public.wine_acquisitions
    where id = '00000000-0000-4000-8000-000000009801'), 2,
    'Correction changes only the acquisition record');

select is(public.upsert_wine_acquisition(
    '00000000-0000-4000-8000-000000009802',
    '00000000-0000-4000-8000-000000000110',
    'GIFT', 1, null, null, null, 'Friend', null
), '00000000-0000-4000-8000-000000009802'::uuid,
    'An unpriced gift can be recorded with an unknown date');
select throws_ok($test$
    select public.upsert_wine_acquisition(
        '00000000-0000-4000-8000-000000009803',
        '00000000-0000-4000-8000-000000000110',
        'GIFT', 1, null, 10, 'EUR', null, null)
$test$, '22023', 'Acquisition details are invalid',
    'A gift cannot masquerade as a paid purchase');
select throws_ok($test$
    select public.upsert_wine_acquisition(
        '00000000-0000-4000-8000-000000009803',
        '00000000-0000-4000-8000-000000000110',
        'PURCHASE', 1, null, 10.123, 'EUR', null, null)
$test$, '22023', 'Acquisition details are invalid',
    'A price is not silently rounded');
select throws_ok($test$
    select public.upsert_wine_acquisition(
        '00000000-0000-4000-8000-000000009803',
        '00000000-0000-4000-8000-000000000110',
        'PURCHASE', 0, null, null, null, null, null)
$test$, '22023', 'Acquisition details are invalid',
    'Quantity must be positive');

select is(public.void_wine_acquisition('00000000-0000-4000-8000-000000009802'),
    '00000000-0000-4000-8000-000000009802'::uuid,
    'Owner can void an erroneous manual record');
select ok((select voided_at is not null from public.wine_acquisitions
    where id = '00000000-0000-4000-8000-000000009802'),
    'Voiding is recoverable and does not erase the row');
select throws_ok($test$
    select public.upsert_wine_acquisition(
        '00000000-0000-4000-8000-000000009802',
        '00000000-0000-4000-8000-000000000110',
        'GIFT', 1, null, null, null, null, null)
$test$, '42501', 'This acquisition cannot be edited',
    'Voided records cannot be silently revived');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select is(auth.uid(), '00000000-0000-4000-8000-000000000003'::uuid,
    'Member test runs with the Member identity');
select is((select count(*) from public.wine_acquisitions), 0::bigint,
    'Household Member cannot see owner-private prices');
select throws_ok($test$
    select public.upsert_wine_acquisition(
        '00000000-0000-4000-8000-000000009804',
        '00000000-0000-4000-8000-000000000110',
        'PURCHASE', 1, null, null, null, null, null)
$test$, '42501', 'Only a household owner can record acquisitions',
    'Member cannot record purchases');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is(auth.uid(), '00000000-0000-4000-8000-000000000002'::uuid,
    'Cross-household test runs with the other Owner identity');
select is((select count(*) from public.wine_acquisitions), 0::bigint,
    'Other household Owner cannot read these records');
select throws_ok($test$
    select public.upsert_wine_acquisition(
        '00000000-0000-4000-8000-000000009804',
        '00000000-0000-4000-8000-000000000110',
        'PURCHASE', 1, null, null, null, null, null)
$test$, '42501', 'Only a household owner can record acquisitions',
    'Other household Owner cannot record against this wine');
select throws_ok($test$
    select public.void_wine_acquisition('00000000-0000-4000-8000-000000009801')
$test$, '42501', 'This acquisition cannot be removed',
    'Other household Owner cannot void a private record');
reset role;
insert into public.wine_acquisitions (
    id, household_id, wine_id, acquisition_kind, quantity, acquired_on,
    unit_price_amount, price_currency, source_kind, source_fingerprint,
    source_record_id
) values (
    '00000000-0000-4000-8000-000000009805',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    'PURCHASE', 2, '2020-01-01', 9.50, 'EUR', 'LEGACY_V01',
    repeat('a', 64), 'source-purchase-1'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok($test$
    select public.void_wine_acquisition('00000000-0000-4000-8000-000000009805')
$test$, '42501', 'This acquisition cannot be removed',
    'Imported source evidence cannot be voided by the browser');
select throws_ok($test$
    select public.upsert_wine_acquisition(
        '00000000-0000-4000-8000-000000009805',
        '00000000-0000-4000-8000-000000000110',
        'PURCHASE', 2, '2020-01-01', 1, 'EUR', null, null)
$test$, '42501', 'This acquisition cannot be edited',
    'Imported source evidence cannot be rewritten by the browser');

select * from finish();
rollback;
