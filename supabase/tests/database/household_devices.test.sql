begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.get_household_devices(uuid)', 'execute'), 'Anonymous users cannot list registrations');
select ok(not has_function_privilege('anon', 'public.manage_household_device(uuid,uuid,text,text)', 'execute'), 'Anonymous users cannot manage registrations');
select ok(not has_function_privilege('authenticated', 'private.register_device_unlocked(uuid,uuid,text)', 'execute'), 'Registration lock cannot be bypassed');
select ok(not has_table_privilege('authenticated', 'public.devices', 'update'), 'Direct device updates remain denied');
select ok(not has_table_privilege('authenticated', 'public.devices', 'delete'), 'Direct deletion remains denied');
select ok(not has_table_privilege('authenticated', 'private.household_device_events', 'select'), 'Device audit is private');

insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000009003', 'member-devices@example.test');
insert into public.household_members(household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009003', 'member');
insert into public.devices(id, household_id, user_id, name) values
('00000000-0000-4000-8000-000000009301', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009003', 'Member phone');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009003';
select is(jsonb_array_length(public.get_household_devices('00000000-0000-4000-8000-000000000100')->'devices'), 1, 'Member sees only own registrations');
select is(public.get_household_devices('00000000-0000-4000-8000-000000000100')->>'role', 'member', 'Response carries live membership role');
select is(public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009301', 'rename', '  Travel phone  ')->>'name', 'Travel phone', 'Member can rename own registration');
select throws_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'revoke')$$,
 '42501', 'Device is not available for this account and household', 'Member cannot revoke Owner device');
select throws_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'rename', 'Stolen')$$,
 '42501', 'Device is not available for this account and household', 'Member cannot rename Owner device');
select throws_ok($$select public.get_household_devices('00000000-0000-4000-8000-000000000200')$$,
 '42501', 'User is not a member of this household', 'Unrelated household cannot be enumerated');
select throws_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009301', 'rename', '')$$,
 '22023', 'Device name must contain 1 to 120 characters', 'Empty names rejected');
select throws_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009301', 'rename', repeat('a',121))$$,
 '22023', 'Device name must contain 1 to 120 characters', 'Long names rejected');
select throws_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009301', 'restore')$$,
 '22023', 'Choose rename or revoke', 'No restore or arbitrary action');
select lives_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009301', 'revoke')$$, 'Member can revoke own device');
select lives_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009301', 'revoke')$$, 'Repeat revocation is idempotent');
select isnt(public.get_household_devices('00000000-0000-4000-8000-000000000100')->'devices'->0->>'revoked_at', null, 'Revoked device stays in own history');
select throws_ok($$select public.register_device('00000000-0000-4000-8000-000000009301', '00000000-0000-4000-8000-000000000100', 'Revive')$$,
 '55000', 'Device registration was revoked; register a new device identifier', 'Revocation cannot be undone by registration');
select throws_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009301', 'rename', 'Revive')$$,
 '55000', 'A revoked registration cannot be renamed', 'Revoked name is historical');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(jsonb_array_length(public.get_household_devices('00000000-0000-4000-8000-000000000100')->'devices'), 2, 'Owner sees own and Member history, only this household');
select throws_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000201', 'revoke')$$,
 '42501', 'Device is not available for this account and household', 'Owner cannot act across households');
select lives_ok($$select public.apply_inventory_operation('00000000-0000-4000-8000-000000009401', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'MOVE', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000122', 1, now(), null)$$, 'Active Owner registration can upload before revocation');
select lives_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'revoke')$$, 'Owner can revoke own registration');
select throws_ok($$select public.apply_inventory_operation('00000000-0000-4000-8000-000000009402', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'MOVE', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000122', 1, now(), null)$$,
 '42501', 'Device registration is no longer active', 'New or offline-queued upload cannot use revoked registration');
select is((select count(*)::int from public.inventory_operations where id = '00000000-0000-4000-8000-000000009401'), 1, 'Previously accepted history survives revocation');
select is((select count(*)::int from public.inventory_operations where id = '00000000-0000-4000-8000-000000009402'), 0, 'Denied operation made no journal changes');
select is((select quantity from public.holdings where wine_id = '00000000-0000-4000-8000-000000000110' and location_id = '00000000-0000-4000-8000-000000000122'), 1, 'No extra stock was moved after revocation');

reset role;
insert into public.devices(id, household_id, user_id, name) values
('00000000-0000-4000-8000-000000009302', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009003', 'Member tablet');
set local role authenticated;
select is(public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009302', 'rename', 'Shared tablet')->>'name', 'Shared tablet', 'Owner can rename another account registration');
select lives_ok($$select public.manage_household_device('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009302', 'revoke')$$, 'Owner can revoke another account registration');
select lives_ok($$select public.apply_inventory_operation('00000000-0000-4000-8000-000000009401', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'MOVE', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000122', 1, now(), null)$$, 'Retry of an already accepted operation remains idempotent after revocation');
select is((select quantity from public.holdings where wine_id = '00000000-0000-4000-8000-000000000110' and location_id = '00000000-0000-4000-8000-000000000122'), 1, 'Accepted retry never doubles stock movement');
reset role;
select is((select count(*)::int from private.household_device_events where device_id = '00000000-0000-4000-8000-000000009301'), 2, 'Only rename and first revocation emit audit events');
select is((select count(*)::int from public.household_members where household_id = '00000000-0000-4000-8000-000000000100'), 2, 'Revocation does not remove memberships');
select * from finish();
rollback;
