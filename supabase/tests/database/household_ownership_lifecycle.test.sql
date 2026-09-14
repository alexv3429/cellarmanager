begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Standard local seed identities only. Every change is rolled back.
create function pg_temp.actor_membership() returns uuid language sql as $$
    select id from public.household_members where household_id = '00000000-0000-4000-8000-000000000100'
        and user_id = '00000000-0000-4000-8000-000000000001';
$$;
create temp table original_membership as select pg_temp.actor_membership() id;
grant select on original_membership to authenticated;
create temp table stock_before as select md5(coalesce(jsonb_agg(to_jsonb(h) order by id)::text, '')) fingerprint from public.holdings h;

select ok(has_function_privilege('authenticated', f, 'EXECUTE'), f || ' is available to authenticated sessions')
from unnest(array['public.get_my_household_membership(uuid)', 'public.leave_household(uuid,uuid,text)', 'public.transfer_household_ownership(uuid,uuid,uuid,text)']) f;
select ok(not has_function_privilege('anon', f, 'EXECUTE'), f || ' denies anonymous calls')
from unnest(array['public.get_my_household_membership(uuid)', 'public.leave_household(uuid,uuid,text)', 'public.transfer_household_ownership(uuid,uuid,uuid,text)']) f;
select ok(not has_table_privilege('authenticated', 'public.household_members', 'UPDATE,DELETE'), 'No direct membership writes');
select ok(not has_table_privilege('authenticated', 'private.household_membership_events', 'SELECT'), 'Audit remains private');

insert into auth.users(id, email) values
    ('00000000-0000-4000-8000-000000000003', 'lifecycle-a@example.test'),
    ('00000000-0000-4000-8000-000000000004', 'lifecycle-b@example.test');
insert into public.household_members(id, household_id, user_id, role) values
    ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000003', 'member'),
    ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000004', 'owner');
insert into public.household_wine_observations(id, household_id, wine_id, recorded_by, visibility, observation_type, observed_on, note) values
    ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000001', 'personal', 'other', current_date, 'Private synthetic note'),
    ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000001', 'household', 'other', current_date, 'Shared synthetic note');
insert into public.wine_pairing_preferences(household_id, user_id, dish_key, preferred_colors, preferred_style) values
    ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000001', 'lamb-stew', array['red'], 'rich');
insert into private.member_maturity_calibrations(user_id, year_shift) values ('00000000-0000-4000-8000-000000000001', -2);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is(public.get_my_household_membership('00000000-0000-4000-8000-000000000100')->>'role', null::text, 'An outsider only sees their own absent membership');
select throws_ok($$ select public.leave_household('00000000-0000-4000-8000-000000000100', (select id from original_membership), 'owner') $$,
    '42501', 'User is not a member of this household', 'Cross-household leaving denied');
select throws_ok($$ select public.transfer_household_ownership('00000000-0000-4000-8000-000000000100', (select id from original_membership), '00000000-0000-4000-8000-000000000401', 'member') $$,
    '42501', 'User is not a member of this household', 'Cross-household transfer denied');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select throws_ok($$ select public.transfer_household_ownership('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402', 'owner') $$,
    '42501', 'Household owner permission is required', 'Member cannot transfer ownership');
select throws_ok($$ select public.leave_household('00000000-0000-4000-8000-000000000100', (select id from original_membership), 'owner') $$,
    '40001', 'Your membership changed; refresh before leaving', 'Leaving cannot target another account');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select is(public.leave_household('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000402', 'owner')->>'role', null::text, 'An Owner may leave while another Owner remains');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok($$ select public.leave_household('00000000-0000-4000-8000-000000000100', (select id from original_membership), 'owner') $$,
    '23514', 'Transfer ownership before leaving: a household must retain at least one Owner', 'Last Owner cannot leave');
select throws_ok($$ select public.transfer_household_ownership('00000000-0000-4000-8000-000000000100', (select id from original_membership), (select id from original_membership), 'owner') $$,
    '22023', 'Choose another current household member', 'Cannot transfer to yourself');
select throws_ok($$ select public.transfer_household_ownership('00000000-0000-4000-8000-000000000100', (select id from original_membership), '00000000-0000-4000-8000-000000000402', 'owner') $$,
    '22023', 'Choose another current household member', 'Departed successor cannot be selected');
select throws_ok($$ select public.transfer_household_ownership('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009999', '00000000-0000-4000-8000-000000000401', 'member') $$,
    '42501', 'Your membership changed; refresh before transferring ownership', 'Stale actor membership cannot transfer');
select throws_ok($$ select public.transfer_household_ownership('00000000-0000-4000-8000-000000000100', (select id from original_membership), '00000000-0000-4000-8000-000000000401', 'owner') $$,
    '40001', 'The successor role changed; refresh before transferring ownership', 'Stale successor role cannot transfer');
select throws_ok($$ select public.leave_household('00000000-0000-4000-8000-000000000100', (select id from original_membership), 'member') $$,
    '40001', 'Your membership changed; refresh before leaving', 'Stale actor role cannot leave');

select is(public.transfer_household_ownership('00000000-0000-4000-8000-000000000100', (select id from original_membership), '00000000-0000-4000-8000-000000000401', 'member')->>'role', 'member', 'Owner atomically transfers and stays as Member');
select is(public.get_my_household_membership('00000000-0000-4000-8000-000000000100')->>'role', 'member', 'Live read reports reduced access');
select throws_ok($$ select public.transfer_household_ownership('00000000-0000-4000-8000-000000000100', (select id from original_membership), '00000000-0000-4000-8000-000000000401', 'member') $$,
    '42501', 'Household owner permission is required', 'Repeated transfer cannot change roles again');
select throws_ok($$ select public.apply_inventory_operation('00000000-0000-4000-8000-000000009801', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'REMOVE', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000121', null, 1, now(), 'DRANK') $$,
    '42501', 'Household owner permission is required', 'Old Owner stock requests cannot execute after transfer');

reset role;
select is((select role from public.household_members where id = '00000000-0000-4000-8000-000000000401'), 'owner', 'Successor is Owner');
select is((select count(*) from private.household_membership_events where event_type = 'ownership_transferred' and household_id = '00000000-0000-4000-8000-000000000100'), 2::bigint, 'Both sides of transfer are audited');
select is((select count(*) from public.household_wine_observations where id in ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502')), 2::bigint, 'Transfer preserves both private and shared notes');
select is((select count(*) from public.wine_pairing_preferences where user_id = '00000000-0000-4000-8000-000000000001'), 1::bigint, 'Transfer preserves private household preferences');
select is((select count(*) from public.devices where user_id = '00000000-0000-4000-8000-000000000001' and revoked_at is not null), 0::bigint, 'Transfer preserves device registrations for reading');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(public.leave_household('00000000-0000-4000-8000-000000000100', (select id from original_membership), 'member')->>'role', null::text, 'Former Owner explicitly leaves as Member');
select is(public.get_my_household_membership('00000000-0000-4000-8000-000000000100')->>'membership_id', null::text, 'Live recovery read confirms own absent membership after leaving');
select throws_ok($$ select * from public.get_household_members('00000000-0000-4000-8000-000000000100') $$,
    '42501', 'User is not a member of this household', 'Departure immediately removes directory access');
select is((select count(*) from public.wines where household_id = '00000000-0000-4000-8000-000000000100'), 0::bigint, 'RLS hides former household wines');
select throws_ok($$ select public.leave_household('00000000-0000-4000-8000-000000000100', (select id from original_membership), 'member') $$,
    '42501', 'User is not a member of this household', 'Repeated departure is a safe denial');

reset role;
select is((select count(*) from public.household_wine_observations where id = '00000000-0000-4000-8000-000000000501'), 0::bigint, 'Departure deletes personal household note');
select is((select count(*) from public.household_wine_observations where id = '00000000-0000-4000-8000-000000000502'), 1::bigint, 'Departure preserves attributed shared note');
select is((select count(*) from public.wine_pairing_preferences where user_id = '00000000-0000-4000-8000-000000000001'), 0::bigint, 'Departure deletes private household preferences');
select is((select count(*) from public.devices where user_id = '00000000-0000-4000-8000-000000000001' and household_id = '00000000-0000-4000-8000-000000000100' and revoked_at is null), 0::bigint, 'Departure revokes all own household devices');
select is((select count(*) from private.member_maturity_calibrations where user_id = '00000000-0000-4000-8000-000000000001'), 1::bigint, 'Account-level taste calibration remains');
select is((select count(*) from auth.users where id = '00000000-0000-4000-8000-000000000001'), 1::bigint, 'The account is not deleted');
select is((select count(*) from private.household_membership_events where membership_id = (select id from original_membership) and event_type = 'left' and actor_user_id = member_user_id), 1::bigint, 'Departure has one self-attributed audit event');
select is((select count(*) from public.household_members where household_id = '00000000-0000-4000-8000-000000000100' and role = 'owner'), 1::bigint, 'Household retains an Owner');
select is((select md5(coalesce(jsonb_agg(to_jsonb(h) order by id)::text, '')) from public.holdings h), (select fingerprint from stock_before), 'All stock rows remain identical');

insert into public.household_members(id, household_id, user_id, role) values
    ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000001', 'member');
set local role authenticated;
select throws_ok($$ select public.leave_household('00000000-0000-4000-8000-000000000100', (select id from original_membership), 'member') $$,
    '40001', 'Your membership changed; refresh before leaving', 'An old request cannot remove a newly accepted membership');
select is(public.get_my_household_membership('00000000-0000-4000-8000-000000000100')->>'membership_id', '00000000-0000-4000-8000-000000000403', 'Rejoined membership remains intact');
select throws_ok($$ select * from public.register_device('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000100', 'Old device') $$,
    '55000', 'Device registration was revoked; register a new device identifier', 'Rejoining does not revive old device');

select * from finish();
rollback;
