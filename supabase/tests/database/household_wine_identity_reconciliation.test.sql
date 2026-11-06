begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.preview_household_wine_identity_reconciliation(uuid[])', 'execute'), 'Anonymous preview is denied');
select ok(not has_function_privilege('anon', 'public.confirm_household_wine_identity_reconciliation(jsonb)', 'execute'), 'Anonymous batch confirmation is denied');

insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000009701', 'reconciliation-member@example.test');
insert into public.household_members(household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009701', 'member');
insert into public.wines(id, household_id, producer, cuvee, vintage, color, appellation, area) values
('00000000-0000-4000-8000-000000009711', '00000000-0000-4000-8000-000000000100', 'Estate Cobalt', 'Glacial Star', 2023, 'white', 'Pouilly-Fuissé', 'Bourgogne'),
('00000000-0000-4000-8000-000000009712', '00000000-0000-4000-8000-000000000100', 'Estate Cobalt', 'Glacial Star', 2022, 'white', 'Pouilly-Fuissé', 'Bourgogne'),
('00000000-0000-4000-8000-000000009713', '00000000-0000-4000-8000-000000000100', 'Unknown', 'Unknown', 2023, 'red', 'Unknown', 'Unknown'),
('00000000-0000-4000-8000-000000009714', '00000000-0000-4000-8000-000000000200', 'Estate Cobalt', 'Glacial Star', 2023, 'white', 'Pouilly-Fuissé', 'Bourgogne');
insert into public.wine_reference_entities(id, entity_type) values
('00000000-0000-4000-8000-000000009721', 'producer'),
('00000000-0000-4000-8000-000000009722', 'product'),
('00000000-0000-4000-8000-000000009723', 'release'),
('00000000-0000-4000-8000-000000009724', 'release');
insert into public.wine_reference_producers(id, canonical_name) values
('00000000-0000-4000-8000-000000009721', 'Fixture Estate Cobalt');
insert into public.wine_reference_products(id, producer_id, canonical_name) values
('00000000-0000-4000-8000-000000009722', '00000000-0000-4000-8000-000000009721', 'Grand Cru Glacial Star');
insert into public.wine_reference_releases(id, product_id, vintage_year) values
('00000000-0000-4000-8000-000000009723', '00000000-0000-4000-8000-000000009722', 2023),
('00000000-0000-4000-8000-000000009724', '00000000-0000-4000-8000-000000009722', 2022);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009701';
select throws_ok(
  $$select public.preview_household_wine_identity_reconciliation(array['00000000-0000-4000-8000-000000009711']::uuid[])$$,
  '42501', 'Only household owners can review wine identities', 'Member cannot preview cellar matches');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.preview_household_wine_identity_reconciliation(array['00000000-0000-4000-8000-000000009714']::uuid[])$$,
  '42501', 'User is not a member of this household', 'Other household is inaccessible');
select is((public.preview_household_wine_identity_reconciliation(array['00000000-0000-4000-8000-000000009711']::uuid[])->0->>'candidate_count')::integer,
  1, 'A local abbreviated name finds one canonical release');
select is(public.preview_household_wine_identity_reconciliation(array['00000000-0000-4000-8000-000000009711']::uuid[])->0#>>'{candidates,0,reference_id}',
  '00000000-0000-4000-8000-000000009723', 'The proposed release has the same vintage');
select is((public.preview_household_wine_identity_reconciliation(array['00000000-0000-4000-8000-000000009713']::uuid[])->0->>'candidate_count')::integer,
  0, 'Missing shared identity stays missing');
select is((select wine_reference_id::text from public.wines where id = '00000000-0000-4000-8000-000000009711'),
  null, 'Preview never links a wine');
select throws_ok(
  $$select public.confirm_household_wine_identity_reconciliation('[{"wine_id":"00000000-0000-4000-8000-000000009711","reference_id":"00000000-0000-4000-8000-000000009723","source_fingerprint":"stale"}]'::jsonb)$$,
  '40001', 'Wine identity suggestions changed; refresh before saving', 'Stale batch cannot save');
select throws_ok(
  format($f$select public.confirm_household_wine_identity_reconciliation('[{"wine_id":"00000000-0000-4000-8000-000000009711","reference_id":"00000000-0000-4000-8000-000000009724","source_fingerprint":"%s"}]'::jsonb)$f$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009711')->>'source_fingerprint'),
  '40001', 'Wine identity suggestions changed; refresh before saving', 'Wrong-vintage candidate cannot be submitted');
select lives_ok(
  format($f$select public.confirm_household_wine_identity_reconciliation('[{"wine_id":"00000000-0000-4000-8000-000000009711","reference_id":"00000000-0000-4000-8000-000000009723","source_fingerprint":"%s"}]'::jsonb)$f$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009711')->>'source_fingerprint'),
  'Owner confirms one proposed link with one action');
select is((select wine_reference_id::text from public.wines where id = '00000000-0000-4000-8000-000000009711'),
  '00000000-0000-4000-8000-000000009723', 'The cellar link is saved');
select is((select producer || '|' || cuvee from public.wines where id = '00000000-0000-4000-8000-000000009711'),
  'Estate Cobalt|Glacial Star', 'Local wine labels are unchanged');
reset role;
insert into public.wine_reference_entities(id, entity_type) values
('00000000-0000-4000-8000-000000009725', 'product'),
('00000000-0000-4000-8000-000000009726', 'release');
insert into public.wine_reference_products(id, producer_id, canonical_name) values
('00000000-0000-4000-8000-000000009725', '00000000-0000-4000-8000-000000009721', 'Estate Glacial Star');
insert into public.wine_reference_releases(id, product_id, vintage_year) values
('00000000-0000-4000-8000-000000009726', '00000000-0000-4000-8000-000000009725', 2022);
set local role authenticated;
select is((public.preview_household_wine_identity_reconciliation(array['00000000-0000-4000-8000-000000009712']::uuid[])->0->>'candidate_count')::integer,
  2, 'Two same-vintage cuvées are treated as ambiguous');
select throws_ok(
  format($f$select public.confirm_household_wine_identity_reconciliation('[{"wine_id":"00000000-0000-4000-8000-000000009712","reference_id":"00000000-0000-4000-8000-000000009724","source_fingerprint":"%s"}]'::jsonb)$f$,
    public.get_household_wine_identity_status('00000000-0000-4000-8000-000000009712')->>'source_fingerprint'),
  '40001', 'Wine identity suggestions changed; refresh before saving', 'Ambiguous wine cannot be batch linked');
select is((select wine_reference_id::text from public.wines where id = '00000000-0000-4000-8000-000000009712'),
  null, 'Ambiguous wine remains unlinked');
reset role;
select is((select count(*)::integer from private.household_wine_identity_decisions where wine_id = '00000000-0000-4000-8000-000000009711'),
  1, 'The link is audited');
select is((select count(*)::integer from public.wine_reference_aliases where alias_value = 'Estate Cobalt'),
  0, 'Local abbreviation does not become a shared alias');
select * from finish();
rollback;
