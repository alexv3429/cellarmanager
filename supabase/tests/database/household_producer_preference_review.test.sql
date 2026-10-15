begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.get_household_producer_preference_review(uuid)', 'execute'), 'Anonymous users cannot list producer preferences');
select ok(not has_function_privilege('anon', 'public.search_household_reference_producers(uuid,text)', 'execute'), 'Anonymous users cannot search through this review flow');
select ok(not has_function_privilege('anon', 'public.manage_household_producer_preference(uuid,text,text,uuid,uuid)', 'execute'), 'Anonymous users cannot manage producer preferences');
select ok(not has_table_privilege('authenticated', 'public.wine_reference_household_producer_preferences', 'insert'), 'Direct preference writes remain denied');

insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000009501', 'producer-member@example.test');
insert into public.household_members(household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009501', 'member');
insert into public.wines(id, household_id, producer, cuvee) values
('00000000-0000-4000-8000-000000009511', '00000000-0000-4000-8000-000000000100', 'Barthod', 'Les Cras'),
('00000000-0000-4000-8000-000000009512', '00000000-0000-4000-8000-000000000200', 'Barthod', 'Another cellar');
insert into public.wine_reference_entities(id, entity_type)
values ('00000000-0000-4000-8000-000000009521', 'producer');
insert into public.wine_reference_producers(id, canonical_name)
values ('00000000-0000-4000-8000-000000009521', 'Test Ghislaine Barthod');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009501';
select throws_ok(
  $$select public.get_household_producer_preference_review('00000000-0000-4000-8000-000000000100')$$,
  '42501', 'Only household owners can review producer preferences', 'Member cannot read owner decisions'
);
select throws_ok(
  $$select public.search_household_reference_producers('00000000-0000-4000-8000-000000000100', 'Barthod')$$,
  '42501', 'Only household owners can search producer references', 'Member cannot search review candidates'
);
select throws_ok(
  $$select public.manage_household_producer_preference('00000000-0000-4000-8000-000000000100', 'Barthod', 'set', '00000000-0000-4000-8000-000000009521', null)$$,
  '42501', 'Only household owners can manage producer preferences', 'Member cannot create a preference'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.get_household_producer_preference_review('00000000-0000-4000-8000-000000000200')$$,
  '42501', 'User is not a member of this household', 'Owner cannot enumerate another household'
);
select throws_ok(
  $$select public.manage_household_producer_preference('00000000-0000-4000-8000-000000000200', 'Barthod', 'set', '00000000-0000-4000-8000-000000009521', null)$$,
  '42501', 'User is not a member of this household', 'Owner cannot map another household'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.search_household_reference_producers('00000000-0000-4000-8000-000000000100', 'barthod')) item where item->>'canonical_name' = 'Test Ghislaine Barthod'),
  1, 'Owner can find the shared canonical producer'
);
select is(
  (select item->>'canonical_name' from jsonb_array_elements(public.get_household_producer_preference_review('00000000-0000-4000-8000-000000000100')->'sources') item where item->>'normalized' = 'barthod'),
  null, 'Catalogue shorthand begins without a household preference'
);
select lives_ok(
  $$select public.manage_household_producer_preference('00000000-0000-4000-8000-000000000100', 'Barthod', 'set', '00000000-0000-4000-8000-000000009521', null)$$,
  'Owner can map household shorthand to a shared producer'
);
select is(
  (select item->>'canonical_name' from jsonb_array_elements(public.get_household_producer_preference_review('00000000-0000-4000-8000-000000000100')->'sources') item where item->>'normalized' = 'barthod'),
  'Test Ghislaine Barthod', 'Owner sees saved local mapping'
);
select throws_ok(
  $$select public.manage_household_producer_preference('00000000-0000-4000-8000-000000000100', 'Barthod', 'remove', null, null)$$,
  '40001', 'Producer preference changed; refresh before saving', 'Stale form cannot erase a later decision'
);
select lives_ok(
  $$select public.manage_household_producer_preference('00000000-0000-4000-8000-000000000100', 'Barthod', 'remove', null, '00000000-0000-4000-8000-000000009521')$$,
  'Owner can remove the local preference'
);
select is(
  (select item->>'canonical_name' from jsonb_array_elements(public.get_household_producer_preference_review('00000000-0000-4000-8000-000000000100')->'sources') item where item->>'normalized' = 'barthod'),
  null, 'Removing local mapping returns catalogue shorthand to unconfirmed state'
);
reset role;
select is((select count(*)::int from public.wine_reference_aliases where alias_value = 'Barthod' and entity_type = 'producer'), 0, 'No global producer alias was created');
select is((select producer from public.wines where id = '00000000-0000-4000-8000-000000009511'), 'Barthod', 'Wine catalogue text was not renamed');
select is((select count(*)::int from public.wine_reference_household_producer_preferences where household_id = '00000000-0000-4000-8000-000000000200'), 0, 'Other household preferences were untouched');

select * from finish();
rollback;
