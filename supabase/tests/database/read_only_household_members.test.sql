begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id, email, raw_user_meta_data) values
('00000000-0000-4000-8000-000000000003', 'reader@example.test', '{}'::jsonb);
insert into public.household_members(id, household_id, user_id, role) values
('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000003', 'member');
insert into public.devices(id, household_id, user_id, name) values
('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000003', 'Reader phone');

select ok(not has_function_privilege('authenticated',
  'private.apply_inventory_operation_owner_unchecked(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text)', 'EXECUTE'),
  'The existing-stock implementation cannot bypass the Owner guard');
select ok(not has_function_privilege('authenticated',
  'private.apply_add_inventory_operation_owner_unchecked(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz)', 'EXECUTE'),
  'The new-wine implementation cannot bypass the Owner guard');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';

select throws_ok(pg_catalog.format(
  'select * from public.apply_inventory_operation(''%s'', ''00000000-0000-4000-8000-000000000100'', ''00000000-0000-4000-8000-000000000303'', %L, ''00000000-0000-4000-8000-000000000110'', %L::uuid, %L::uuid, 1, now(), %L)',
  operation_id, kind, source, destination, reason), '42501',
  'Household owner permission is required', 'Member cannot perform ' || kind)
from (values
  ('00000000-0000-4000-8000-000000009801', 'ADD', null, '00000000-0000-4000-8000-000000000121', null),
  ('00000000-0000-4000-8000-000000009802', 'MOVE', '00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000122', null),
  ('00000000-0000-4000-8000-000000009803', 'REMOVE', '00000000-0000-4000-8000-000000000121', null, 'DRANK')
) operation(operation_id, kind, source, destination, reason);

select throws_ok($test$
  select * from public.apply_add_inventory_operation(
    '00000000-0000-4000-8000-000000009804', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000310',
    'New producer', 'No write', 2024, '00000000-0000-4000-8000-000000000121', 1, now())
$test$, '42501', 'Household owner permission is required', 'Legacy ADD cannot bypass the Owner guard');

select throws_ok($test$
  select * from public.apply_add_inventory_operation(
    '00000000-0000-4000-8000-000000009805', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000310',
    'New producer', 'No write', 2024, 'white', 'Appellation', 'Region', 750,
    '00000000-0000-4000-8000-000000000121', 1, now())
$test$, '42501', 'Household owner permission is required', 'Rich new-wine ADD cannot bypass the Owner guard');

select throws_ok($test$update public.holdings set quantity = 0 where household_id = '00000000-0000-4000-8000-000000000100'$test$,
  '42501', 'permission denied for table holdings', 'Members cannot write stock directly');
select is((select quantity from public.holdings where wine_id = '00000000-0000-4000-8000-000000000110' and location_id = '00000000-0000-4000-8000-000000000121'),
  5, 'Member still reads unchanged stock');
select is((select count(*) from public.wines where id = '00000000-0000-4000-8000-000000000310'),
  0::bigint, 'Denials never create a new wine');
select is((select count(*) from public.inventory_operations where user_id = '00000000-0000-4000-8000-000000000003'),
  0::bigint, 'Denials never create inventory history');

-- Existing Owner behavior and idempotency still work.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is((select operation_status from public.apply_inventory_operation(
  '00000000-0000-4000-8000-000000009806', '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000101', 'ADD', '00000000-0000-4000-8000-000000000110',
  null, '00000000-0000-4000-8000-000000000121', 1, '2026-09-08T08:00:00Z', null)),
  'ACCEPTED', 'Owner ADD remains accepted');
select is((select operation_status from public.apply_inventory_operation(
  '00000000-0000-4000-8000-000000009806', '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000101', 'ADD', '00000000-0000-4000-8000-000000000110',
  null, '00000000-0000-4000-8000-000000000121', 1, '2026-09-08T08:00:00Z', null)),
  'ACCEPTED', 'Owner retry returns the accepted receipt');
select is((select quantity from public.holdings where wine_id = '00000000-0000-4000-8000-000000000110' and location_id = '00000000-0000-4000-8000-000000000121'),
  6, 'Retry does not add twice');

-- Promote the other collaborator, then demote the original Owner using the
-- real membership RPCs. The original device remains active, not authoritative.
select changed.member_role from public.update_household_member_role(
  '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000403', 'owner') changed;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select changed.member_role from public.update_household_member_role(
  '00000000-0000-4000-8000-000000000100',
  (select id from public.household_members where household_id = '00000000-0000-4000-8000-000000000100' and user_id = '00000000-0000-4000-8000-000000000001'),
  'member') changed;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok($test$
  select * from public.apply_inventory_operation(
    '00000000-0000-4000-8000-000000009807', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', 'REMOVE', '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000121', null, 1, '2026-09-01T08:00:00Z', 'DRANK')
$test$, '42501', 'Household owner permission is required', 'Demotion blocks a previously queued operation, even with an active device and old timestamp');
select throws_ok($test$
  select * from public.apply_inventory_operation(
    '00000000-0000-4000-8000-000000009806', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101', 'ADD', '00000000-0000-4000-8000-000000000110',
    null, '00000000-0000-4000-8000-000000000121', 1, '2026-09-08T08:00:00Z', null)
$test$, '42501', 'Household owner permission is required', 'Demotion cannot bypass the guard by replaying an old operation ID');
select is((select quantity from public.holdings where wine_id = '00000000-0000-4000-8000-000000000110' and location_id = '00000000-0000-4000-8000-000000000121'),
  6, 'Former Owner sees unchanged stock after denied uploads');

-- Current Owners still need a valid device; the new guard does not weaken it.
reset role;
update public.devices set revoked_at = now() where id = '00000000-0000-4000-8000-000000000303';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select throws_ok($test$
  select * from public.apply_inventory_operation(
    '00000000-0000-4000-8000-000000009808', '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000303', 'REMOVE', '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000121', null, 1, now(), 'DRANK')
$test$, '42501', 'Device registration is no longer active', 'An Owner cannot upload through a revoked device');

select * from finish();
rollback;
