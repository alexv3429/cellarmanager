begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_table_privilege('authenticated', 'public.legacy_holding_prices', 'SELECT'),
    'Browser can query owner-filtered legacy price evidence');
select ok(not has_table_privilege('authenticated', 'public.legacy_holding_prices', 'INSERT'),
    'Browser cannot import legacy prices');
select ok(not has_table_privilege('authenticated', 'public.legacy_holding_prices', 'UPDATE'),
    'Browser cannot alter source price evidence');
select ok(not has_table_privilege('authenticated', 'public.legacy_holding_prices', 'DELETE'),
    'Browser cannot erase source price evidence');

insert into public.legacy_holding_prices (
    household_id, source_sha256, source_holding_id, wine_id,
    price_bought, acquired_on, source_quantity, source_state, imported_by
) values (
    '00000000-0000-4000-8000-000000000100', repeat('a', 64),
    '00000000-0000-4000-8000-000000000130',
    '00000000-0000-4000-8000-000000000110',
    12.50, null, 5, 'in_cellar', '00000000-0000-4000-8000-000000000001'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is((select count(*) from public.legacy_holding_prices), 1::bigint,
    'Household Owner can see the archived price');
select is((select price_bought from public.legacy_holding_prices), 12.50::numeric,
    'Archived price is exact and has no invented currency');
select is((select quantity from public.holdings
    where id = '00000000-0000-4000-8000-000000000130'), 5,
    'Legacy price evidence does not alter bottle stock');

reset role;
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000003', 'price-reader@example.test', '{}'::jsonb);
insert into public.household_members (household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000003', 'member');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select is((select count(*) from public.legacy_holding_prices), 0::bigint,
    'Member cannot read owner-private historical prices');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is((select count(*) from public.legacy_holding_prices), 0::bigint,
    'Other household Owner cannot read prices');

select * from finish();
rollback;
