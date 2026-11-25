begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select no_plan();

select ok(not has_function_privilege('anon', 'public.get_household_cuvee_identity_groups(uuid)', 'execute'),
    'Anonymous users cannot list household cuvée groups');
select ok(not has_table_privilege('authenticated', 'private.household_cuvee_identity_links', 'select'),
    'Clients cannot read the private mapping table directly');

insert into auth.users(id, email) values
    ('00000000-0000-4000-8000-000000009701', 'cuvee-owner@example.test'),
    ('00000000-0000-4000-8000-000000009702', 'cuvee-member@example.test');
insert into public.households(id, name) values
    ('00000000-0000-4000-8000-000000009710', 'Cuvée mapping test'),
    ('00000000-0000-4000-8000-000000009711', 'Other household');
insert into public.household_members(household_id, user_id, role) values
    ('00000000-0000-4000-8000-000000009710', '00000000-0000-4000-8000-000000009701', 'owner'),
    ('00000000-0000-4000-8000-000000009710', '00000000-0000-4000-8000-000000009702', 'member'),
    ('00000000-0000-4000-8000-000000009711', '00000000-0000-4000-8000-000000009702', 'owner');
insert into public.wines(id, household_id, producer, cuvee, vintage, color, appellation, area) values
    ('00000000-0000-4000-8000-000000009721', '00000000-0000-4000-8000-000000009710', 'Boillot', 'Caillerets', 2022, 'rouge', 'Volnay', 'Bourgogne'),
    ('00000000-0000-4000-8000-000000009722', '00000000-0000-4000-8000-000000009710', 'Boillot', 'Caillerets', 2024, 'rouge', 'Volnay', 'Bourgogne'),
    ('00000000-0000-4000-8000-000000009723', '00000000-0000-4000-8000-000000009711', 'Boillot', 'Caillerets', 2022, 'rouge', 'Volnay', 'Bourgogne');
insert into public.wine_reference_entities(id, entity_type) values
    ('00000000-0000-4000-8000-000000009731', 'producer'),
    ('00000000-0000-4000-8000-000000009732', 'product'),
    ('00000000-0000-4000-8000-000000009733', 'product'),
    ('00000000-0000-4000-8000-000000009734', 'release');
insert into public.wine_reference_producers(id, canonical_name) values
    ('00000000-0000-4000-8000-000000009731', 'Domaine Louis Boillot et Fils');
insert into public.wine_reference_products(id, producer_id, canonical_name) values
    ('00000000-0000-4000-8000-000000009732', '00000000-0000-4000-8000-000000009731', 'Volnay 1er cru Les Caillerets'),
    ('00000000-0000-4000-8000-000000009733', '00000000-0000-4000-8000-000000009731', 'Renamed cuvée');
insert into public.wine_reference_releases(id, product_id, vintage_year) values
    ('00000000-0000-4000-8000-000000009734', '00000000-0000-4000-8000-000000009732', 2022);
insert into public.wine_reference_household_producer_preferences(
    household_id, source_producer_normalized, source_producer_text, producer_id, decided_by
) values ('00000000-0000-4000-8000-000000009710', 'boillot', 'Boillot',
    '00000000-0000-4000-8000-000000009731', '00000000-0000-4000-8000-000000009701');
select is((select lineage.producer_id::text from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id = '00000000-0000-4000-8000-000000009721'),
    '00000000-0000-4000-8000-000000009731',
    'Producer preference alone resolves only the producer-level fallback');
select is((select lineage.product_id::text from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id = '00000000-0000-4000-8000-000000009721'), null,
    'Producer preference does not guess a cuvée');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009702';
select throws_ok(
    $$select public.get_household_cuvee_identity_groups('00000000-0000-4000-8000-000000009710')$$,
    '42501', 'Only household owners can review cuvée identities', 'Member cannot list mappings');
select throws_ok(
    $$select public.manage_household_cuvee_identity_link('00000000-0000-4000-8000-000000009710', 'Boillot', 'Caillerets', 'Volnay', 'rouge', 1800, 2023, 'set', '00000000-0000-4000-8000-000000009732', null)$$,
    '42501', 'Only household owners can manage cuvée identities', 'Member cannot map another owner’s cuvée');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009701';
select is((select item->>'producer_name' from jsonb_array_elements(public.get_household_cuvee_identity_groups('00000000-0000-4000-8000-000000009710')) item
    where item->>'source_cuvee' = 'Caillerets'), 'Domaine Louis Boillot et Fils',
    'Owner sees the durable producer link before mapping a cuvée');
select is((select count(*)::integer from jsonb_array_elements(public.search_household_cuvee_products(
    '00000000-0000-4000-8000-000000009710', 'Boillot', 'Caillerets'))), 1,
    'Search finds the longer canonical cuvée name under the linked producer');
select lives_ok(
    $$select public.manage_household_cuvee_identity_link('00000000-0000-4000-8000-000000009710', 'Boillot', 'Caillerets', 'Volnay', 'rouge', 1800, 2023, 'set', '00000000-0000-4000-8000-000000009732', null)$$,
    'One link covers the older cuvée-name era');
select throws_ok(
    $$select public.manage_household_cuvee_identity_link('00000000-0000-4000-8000-000000009710', 'Boillot', 'Caillerets', 'Volnay', 'rouge', 2023, 2200, 'set', '00000000-0000-4000-8000-000000009733', null)$$,
    '22023', 'Cuvée vintage ranges overlap', 'Overlapping rename eras are rejected');
select lives_ok(
    $$select public.manage_household_cuvee_identity_link('00000000-0000-4000-8000-000000009710', 'Boillot', 'Caillerets', 'Volnay', 'rouge', 2024, 2200, 'set', '00000000-0000-4000-8000-000000009733', null)$$,
    'A separate newer era can map to another canonical product');
select throws_ok(
    $$select public.manage_household_cuvee_identity_link('00000000-0000-4000-8000-000000009710', 'Boillot', 'Caillerets', 'Volnay', 'rouge', 1800, 2023, 'remove', null, null)$$,
    '40001', 'Cuvée mapping changed; refresh before saving', 'Stale editor cannot remove a confirmed link');
reset role;
select is((select lineage.release_id::text from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id = '00000000-0000-4000-8000-000000009721'),
    '00000000-0000-4000-8000-000000009734', 'Older wine resolves its exact canonical release');
select is((select lineage.product_id::text from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id = '00000000-0000-4000-8000-000000009722'),
    '00000000-0000-4000-8000-000000009733', 'Newer wine resolves a bounded renamed product');
insert into public.wine_reference_entities(id, entity_type) values
    ('00000000-0000-4000-8000-000000009735', 'release');
insert into public.wine_reference_releases(id, product_id, vintage_year, release_designator) values
    ('00000000-0000-4000-8000-000000009735', '00000000-0000-4000-8000-000000009732', 2022, 'Special lot');
select is((select lineage.release_id::text from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id = '00000000-0000-4000-8000-000000009721'), null,
    'Two canonical releases in one vintage do not produce an arbitrary release match');
select is((select count(*)::integer from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id = '00000000-0000-4000-8000-000000009723'), 0,
    'A matching label in another household is not linked');
select is((select count(*)::integer from public.wines wine where wine.id = '00000000-0000-4000-8000-000000009721'
    and wine.producer = 'Boillot' and wine.cuvee = 'Caillerets'), 1,
    'Local wine-card text remains unchanged');

select * from finish();
rollback;
