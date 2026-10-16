begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.search_household_wine_references(uuid,text)', 'execute'), 'Anonymous search is denied');
select ok(not has_function_privilege('anon', 'public.get_household_wine_identity_status(uuid)', 'execute'), 'Anonymous status is denied');
select ok(not has_function_privilege('anon', 'public.manage_household_wine_identity(uuid,text,uuid,text,uuid)', 'execute'), 'Anonymous decisions are denied');
select ok(not has_function_privilege('anon', 'public.request_household_wine_identity(uuid,text)', 'execute'), 'Anonymous requests are denied');
select ok(not has_table_privilege('authenticated', 'private.household_wine_identity_decisions', 'insert'), 'Clients cannot forge audit decisions');
select ok(not has_table_privilege('authenticated', 'private.household_wine_identity_requests', 'insert'), 'Clients cannot forge missing-identity requests');

insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000009601', 'wine-identity-member@example.test');
insert into public.household_members(household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009601', 'member');
insert into public.wines(id, household_id, producer, cuvee, vintage, color, appellation, area) values
('00000000-0000-4000-8000-000000009611', '00000000-0000-4000-8000-000000000100', 'Barraud', 'Sur La Roche', 2023, 'white', 'Pouilly-Fuissé', 'Bourgogne'),
('00000000-0000-4000-8000-000000009612', '00000000-0000-4000-8000-000000000100', 'Barraud', 'En France', null, 'white', 'Pouilly-Fuissé', 'Bourgogne'),
('00000000-0000-4000-8000-000000009613', '00000000-0000-4000-8000-000000000200', 'Barraud', 'Other', 2023, 'white', 'Pouilly-Fuissé', 'Bourgogne');
insert into public.wine_reference_entities(id, entity_type) values
('00000000-0000-4000-8000-000000009621', 'producer'),
('00000000-0000-4000-8000-000000009622', 'product'),
('00000000-0000-4000-8000-000000009623', 'release'),
('00000000-0000-4000-8000-000000009624', 'release');
insert into public.wine_reference_producers(id, canonical_name)
values ('00000000-0000-4000-8000-000000009621', 'Daniel Barraud');
insert into public.wine_reference_products(id, producer_id, canonical_name)
values ('00000000-0000-4000-8000-000000009622', '00000000-0000-4000-8000-000000009621', 'Pouilly-Fuissé Premier Cru Sur La Roche');
insert into public.wine_reference_releases(id, product_id, vintage_year) values
('00000000-0000-4000-8000-000000009623', '00000000-0000-4000-8000-000000009622', 2023),
('00000000-0000-4000-8000-000000009624', '00000000-0000-4000-8000-000000009622', 2022);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009601';
select throws_ok(
  $$select public.search_household_wine_references('00000000-0000-4000-8000-000000009611', 'Barraud')$$,
  '42501', 'Only household owners can review wine identities', 'Member cannot search identities'
);
select throws_ok(
  $$select public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')$$,
  '42501', 'Only household owners can review wine identities', 'Member cannot read owner status'
);
select throws_ok(
  $$select public.manage_household_wine_identity('00000000-0000-4000-8000-000000009611', 'link', '00000000-0000-4000-8000-000000009623', 'stale', null)$$,
  '42501', 'Only household owners can review wine identities', 'Member cannot confirm an identity'
);
select throws_ok(
  $$select public.request_household_wine_identity('00000000-0000-4000-8000-000000009611', 'stale')$$,
  '42501', 'Only household owners can request shared wine identities', 'Member cannot request a shared entry'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is((public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')->>'request_status'), null, 'No request exists initially');
select throws_ok(
  $$select public.search_household_wine_references('00000000-0000-4000-8000-000000009613', 'Barraud')$$,
  '42501', 'User is not a member of this household', 'Owner cannot search another household wine'
);
select throws_ok(
  $$select public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009613')$$,
  '42501', 'User is not a member of this household', 'Owner cannot read another household status'
);
select throws_ok(
  $$select public.request_household_wine_identity('00000000-0000-4000-8000-000000009613', 'stale')$$,
  '42501', 'User is not a member of this household', 'Owner cannot request a shared entry for another household'
);
select is(
  (select bool_and(item->>'vintage_year' = '2023' and item->>'reference_type' = 'release') from jsonb_array_elements(public.search_household_wine_references('00000000-0000-4000-8000-000000009611', 'Barraud')) item),
  true, 'Search offers only same-vintage releases'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.search_household_wine_references('00000000-0000-4000-8000-000000009611', 'Barraud')) item where item->>'reference_id' = '00000000-0000-4000-8000-000000009623'),
  1, 'Search includes the reviewed 2023 release'
);
select is(
  (select bool_and(item->>'vintage_year' is null and item->>'reference_type' = 'product') from jsonb_array_elements(public.search_household_wine_references('00000000-0000-4000-8000-000000009612', 'Barraud')) item),
  true, 'NV wine searches at product level'
);
select throws_ok(
  $$select public.search_household_wine_references('00000000-0000-4000-8000-000000009611', 'x')$$,
  '22023', 'Search with 2 to 100 characters', 'Short search is rejected'
);
select throws_ok(
  $$select public.manage_household_wine_identity('00000000-0000-4000-8000-000000009611', 'link', '00000000-0000-4000-8000-000000009623', 'stale', null)$$,
  '40001', 'Wine identity changed; refresh before saving', 'Stale source snapshot is rejected'
);
select throws_ok(
  format(
    $$select public.manage_household_wine_identity('00000000-0000-4000-8000-000000009611', 'link', '00000000-0000-4000-8000-000000009624', %L, null)$$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')->>'source_fingerprint'
  ),
  '22023', 'Choose a shared wine with the same vintage', 'Owner cannot link the wrong vintage even by calling the RPC directly'
);
select lives_ok(
  format(
    $$select public.manage_household_wine_identity('00000000-0000-4000-8000-000000009612', 'link', '00000000-0000-4000-8000-000000009622', %L, null)$$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009612')->>'source_fingerprint'
  ),
  'NV wine can link to a shared product without inventing a vintage'
);
select is((select wine_reference_type from public.wines where id = '00000000-0000-4000-8000-000000009612'),
  'product', 'NV link stays at product scope');
select lives_ok(
  format(
    $$select public.manage_household_wine_identity('00000000-0000-4000-8000-000000009611', 'link', '00000000-0000-4000-8000-000000009623', %L, null)$$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')->>'source_fingerprint'
  ),
  'Owner confirms an exact-vintage curated release'
);
select is((select wine_reference_id::text from public.wines where id = '00000000-0000-4000-8000-000000009611'),
  '00000000-0000-4000-8000-000000009623', 'Only local wine link is updated');
select is((public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')->'matched_reference'->>'reference_id'),
  '00000000-0000-4000-8000-000000009623', 'Owner status shows the confirmed link');
select is((select producer from public.wines where id = '00000000-0000-4000-8000-000000009611'),
  'Barraud', 'Household spelling is preserved');
select throws_ok(
  format(
    $$select public.manage_household_wine_identity('00000000-0000-4000-8000-000000009611', 'remove', null, %L, null)$$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')->>'source_fingerprint'
  ),
  '40001', 'Wine identity changed; refresh before saving', 'Stale current link cannot be removed'
);
select lives_ok(
  format(
    $$select public.manage_household_wine_identity('00000000-0000-4000-8000-000000009611', 'remove', null, %L, '00000000-0000-4000-8000-000000009623')$$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')->>'source_fingerprint'
  ),
  'Owner can undo a local identity link'
);
select throws_ok(
  $$select public.request_household_wine_identity('00000000-0000-4000-8000-000000009611', 'stale')$$,
  '40001', 'Wine identity changed; refresh before requesting', 'Stale request source is rejected'
);
select lives_ok(
  format(
    $$select public.request_household_wine_identity('00000000-0000-4000-8000-000000009611', %L)$$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')->>'source_fingerprint'
  ),
  'Owner can request review of a missing shared entry'
);
select lives_ok(
  format(
    $$select public.request_household_wine_identity('00000000-0000-4000-8000-000000009611', %L)$$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')->>'source_fingerprint'
  ),
  'Repeating the request is safe'
);
select is((public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009611')->>'request_status'),
  'pending', 'Request status persists for the owner');
reset role;
select is((select count(*)::int from private.household_wine_identity_decisions where wine_id = '00000000-0000-4000-8000-000000009611'), 2, 'Link and removal are both audited');
select is((select count(*)::int from private.household_wine_identity_requests where wine_id = '00000000-0000-4000-8000-000000009611'), 1, 'One private request is queued per wine and source fingerprint');
select is((select count(*)::int from public.wine_reference_aliases where alias_value = 'Barraud'), 0, 'No global alias is created');
select is((select count(*)::int from public.wine_reference_products where producer_id = '00000000-0000-4000-8000-000000009621'), 1, 'No new shared product is created');
select is((select wine_reference_id::text from public.wines where id = '00000000-0000-4000-8000-000000009613'), null, 'Another household is untouched');

select * from finish();
rollback;
