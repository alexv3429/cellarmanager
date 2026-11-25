begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select no_plan();

insert into auth.users(id, email) values
    ('00000000-0000-4000-8000-000000009801', 'exact-owner@example.test'),
    ('00000000-0000-4000-8000-000000009802', 'exact-member@example.test');
insert into public.households(id, name) values
    ('00000000-0000-4000-8000-000000009810', 'Exact identity household'),
    ('00000000-0000-4000-8000-000000009811', 'Unrelated household');
insert into public.household_members(household_id, user_id, role) values
    ('00000000-0000-4000-8000-000000009810', '00000000-0000-4000-8000-000000009801', 'owner'),
    ('00000000-0000-4000-8000-000000009810', '00000000-0000-4000-8000-000000009802', 'member'),
    ('00000000-0000-4000-8000-000000009811', '00000000-0000-4000-8000-000000009802', 'owner');
insert into public.wine_reference_entities(id, entity_type) values
    ('00000000-0000-4000-8000-000000009831', 'producer'),
    ('00000000-0000-4000-8000-000000009832', 'product'),
    ('00000000-0000-4000-8000-000000009833', 'product'),
    ('00000000-0000-4000-8000-000000009834', 'product'),
    ('00000000-0000-4000-8000-000000009835', 'product'),
    ('00000000-0000-4000-8000-000000009836', 'release');
insert into public.wine_reference_producers(id, canonical_name) values
    ('00000000-0000-4000-8000-000000009831', 'Domaine Exact');
insert into public.wine_reference_products(id, producer_id, canonical_name) values
    ('00000000-0000-4000-8000-000000009832', '00000000-0000-4000-8000-000000009831', 'Les Caillerets'),
    ('00000000-0000-4000-8000-000000009833', '00000000-0000-4000-8000-000000009831', 'Les Charmes'),
    ('00000000-0000-4000-8000-000000009834', '00000000-0000-4000-8000-000000009831', 'LES CHARMES'),
    ('00000000-0000-4000-8000-000000009835', '00000000-0000-4000-8000-000000009831', 'Le Chardon');
insert into public.wine_reference_releases(id, product_id, vintage_year) values
    ('00000000-0000-4000-8000-000000009836', '00000000-0000-4000-8000-000000009832', 2022);
insert into public.wine_reference_aliases(entity_id, entity_type, alias_value, normalized_value)
values ('00000000-0000-4000-8000-000000009835', 'product', 'Chardon', 'chardon');
insert into public.wine_reference_household_producer_preferences(
    household_id, source_producer_normalized, source_producer_text, producer_id, decided_by
) values ('00000000-0000-4000-8000-000000009810', 'exact', 'Exact',
    '00000000-0000-4000-8000-000000009831', '00000000-0000-4000-8000-000000009801');
insert into public.wines(id, household_id, producer, cuvee, vintage, color, appellation, area) values
    ('00000000-0000-4000-8000-000000009821', '00000000-0000-4000-8000-000000009810', 'Exact', 'Les Caillerets', 2022, 'rouge', 'Volnay', 'Bourgogne'),
    ('00000000-0000-4000-8000-000000009822', '00000000-0000-4000-8000-000000009810', 'Exact', 'Les Caillerets', 2023, 'rouge', 'Volnay', 'Bourgogne'),
    ('00000000-0000-4000-8000-000000009823', '00000000-0000-4000-8000-000000009810', 'Exact', 'Les Charmes', 2022, 'rouge', 'Volnay', 'Bourgogne'),
    ('00000000-0000-4000-8000-000000009824', '00000000-0000-4000-8000-000000009810', 'Exact', 'Chardon', 2022, 'rouge', 'Volnay', 'Bourgogne'),
    ('00000000-0000-4000-8000-000000009825', '00000000-0000-4000-8000-000000009811', 'Exact', 'Les Caillerets', 2022, 'rouge', 'Volnay', 'Bourgogne'),
    ('00000000-0000-4000-8000-000000009826', '00000000-0000-4000-8000-000000009810', 'Exact', 'Le Chardon', 2022, 'rouge', 'Volnay', 'Bourgogne');
update public.wines set wine_reference_type = 'product',
    wine_reference_id = '00000000-0000-4000-8000-000000009835'
where id = '00000000-0000-4000-8000-000000009826';

select ok(not has_function_privilege('anon', 'public.preview_household_exact_cuvee_links(uuid)', 'execute'),
    'Anonymous callers cannot preview cellar mappings');
select ok(not has_function_privilege('anon', 'public.apply_household_exact_cuvee_links(uuid,text,boolean)', 'execute'),
    'Anonymous callers cannot apply cellar mappings');
select ok(not has_table_privilege('authenticated', 'private.household_cuvee_identity_decisions', 'select'),
    'Clients cannot read private decision audit directly');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009802';
select throws_ok(
    $$select public.preview_household_exact_cuvee_links('00000000-0000-4000-8000-000000009810')$$,
    '42501', 'Only household owners can review cuvée identities',
    'A household member cannot preview the owner batch');
select throws_ok(
    $$select public.apply_household_exact_cuvee_links('00000000-0000-4000-8000-000000009810', 'bad', true)$$,
    '42501', 'Only household owners can link cuvée identities',
    'A household member cannot apply the owner batch');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009801';
select is((public.preview_household_exact_cuvee_links('00000000-0000-4000-8000-000000009810') ->> 'candidate_groups')::integer,
    1, 'Only one unique canonical-name group qualifies');
select is((public.preview_household_exact_cuvee_links('00000000-0000-4000-8000-000000009810') ->> 'wine_count')::integer,
    2, 'One mapping will cover both existing vintages');
select throws_ok(
    $$select public.apply_household_exact_cuvee_links('00000000-0000-4000-8000-000000009810', 'stale', true)$$,
    '40001', 'Exact cuvée plan changed; preview again',
    'A stale plan cannot apply any links');
select throws_ok(
    $$select public.apply_household_exact_cuvee_links('00000000-0000-4000-8000-000000009810', 'stale', false)$$,
    '22023', 'Confirm the exact cuvée links',
    'Explicit confirmation is required');
select is((public.apply_household_exact_cuvee_links(
    '00000000-0000-4000-8000-000000009810',
    public.preview_household_exact_cuvee_links('00000000-0000-4000-8000-000000009810') ->> 'plan_sha256',
    true) ->> 'linked_groups')::integer, 1,
    'The owner can apply the exact batch once');
reset role;

select is((select count(*)::integer from private.household_cuvee_identity_decisions
    where household_id = '00000000-0000-4000-8000-000000009810'
      and decision_method = 'exact_canonical_name'), 1,
    'The exact-name decision is auditable and distinct from manual decisions');
select is((select lineage.product_id::text from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id = '00000000-0000-4000-8000-000000009821'),
    '00000000-0000-4000-8000-000000009832',
    'The first wine resolves the canonical product');
select is((select lineage.product_id::text from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id = '00000000-0000-4000-8000-000000009822'),
    '00000000-0000-4000-8000-000000009832',
    'The second vintage reuses the cellar-only mapping');
select is((select count(*)::integer from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id = '00000000-0000-4000-8000-000000009825'), 0,
    'The same spelling in another household remains unlinked');
select is((select count(*)::integer from private.household_cuvee_identity_links
    where household_id = '00000000-0000-4000-8000-000000009810'
      and source_cuvee in ('les charmes', 'chardon')), 0,
    'Ambiguous names and even curated aliases are not bulk linked');
select is((select count(*)::integer from private.household_cuvee_identity_links
    where household_id = '00000000-0000-4000-8000-000000009810'
      and source_cuvee = 'le chardon'), 0,
    'A wine with an explicit identity is not given a redundant group link');
select is((select count(*)::integer from public.drinking_window_reference_rows
    where producer_id = '00000000-0000-4000-8000-000000009831'), 0,
    'Identity linking did not approve or publish any dates');
select is((select count(*)::integer from public.wines
    where id in ('00000000-0000-4000-8000-000000009821',
                 '00000000-0000-4000-8000-000000009822')
      and producer = 'Exact' and cuvee = 'Les Caillerets'), 2,
    'The owner descriptions remain unchanged');

select * from finish();
rollback;
