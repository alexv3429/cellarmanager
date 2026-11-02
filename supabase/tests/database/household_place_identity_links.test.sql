begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.get_household_place_identity_groups(uuid)','execute'),
    'Anonymous users cannot list place mappings');
select ok(not has_table_privilege('authenticated',
    'private.household_region_identity_links','select'),
    'Clients cannot read private region links');
select ok(not has_table_privilege('authenticated',
    'private.household_appellation_identity_links','insert'),
    'Clients cannot write private appellation links');

insert into auth.users(id,email) values
    ('00000000-0000-4000-8000-000000009801','place-owner@example.test'),
    ('00000000-0000-4000-8000-000000009802','place-member@example.test');
insert into public.households(id,name) values
    ('00000000-0000-4000-8000-000000009810','Place link test'),
    ('00000000-0000-4000-8000-000000009811','Other place household');
insert into public.household_members(household_id,user_id,role) values
    ('00000000-0000-4000-8000-000000009810','00000000-0000-4000-8000-000000009801','owner'),
    ('00000000-0000-4000-8000-000000009810','00000000-0000-4000-8000-000000009802','member'),
    ('00000000-0000-4000-8000-000000009811','00000000-0000-4000-8000-000000009802','owner');
insert into public.wines(id,household_id,producer,cuvee,vintage,color,area,appellation) values
    ('00000000-0000-4000-8000-000000009821','00000000-0000-4000-8000-000000009810',
     'Example producer','Example cuvée',2022,'rouge','Local Cote Dor','Local Premier Cru'),
    ('00000000-0000-4000-8000-000000009822','00000000-0000-4000-8000-000000009810',
     'Example producer','Example cuvée',2023,'rouge','Local Cote Dor','Local Premier Cru'),
    ('00000000-0000-4000-8000-000000009823','00000000-0000-4000-8000-000000009811',
     'Example producer','Example cuvée',2022,'rouge','Local Cote Dor','Local Premier Cru');
insert into public.enrichment_places(id,place_type,canonical_name) values
    ('00000000-0000-4000-8000-000000009831','region','Test Burgundy'),
    ('00000000-0000-4000-8000-000000009833','region','Test Beaujolais');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
    ('00000000-0000-4000-8000-000000009832','00000000-0000-4000-8000-000000009831',
     'appellation','Test Volnay Premier Cru'),
    ('00000000-0000-4000-8000-000000009834','00000000-0000-4000-8000-000000009833',
     'appellation','Test Morgon');

select is(private.drinking_window_wine_context('00000000-0000-4000-8000-000000009821')->>'status',
    'region_not_confirmed','An unrecognised local area blocks shared matching before mapping');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009802';
select throws_ok(
    $$select public.get_household_place_identity_groups('00000000-0000-4000-8000-000000009810')$$,
    '42501','Only household owners can review place identities','Member cannot list owner mappings');
select throws_ok(
    $$select public.manage_household_place_identity_link('00000000-0000-4000-8000-000000009810','region','Local Cote Dor',null,'set','00000000-0000-4000-8000-000000009831',null)$$,
    '42501','Only household owners can manage place identities','Member cannot set region mapping');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009801';
select is((select count(*)::integer from jsonb_array_elements(public.search_household_places(
    '00000000-0000-4000-8000-000000009810','region','Local Cote Dor','Test Burgundy'))),1,
    'Owner can search canonical regions');
select lives_ok(
    $$select public.manage_household_place_identity_link('00000000-0000-4000-8000-000000009810','region','Local Cote Dor',null,'set','00000000-0000-4000-8000-000000009831',null)$$,
    'Local area maps once to canonical region');
reset role;
select is(private.drinking_window_wine_context('00000000-0000-4000-8000-000000009821')->>'status',
    'appellation_not_confirmed','Unrecognised appellation remains visible after region mapping');
set local role authenticated;
select throws_ok(
    $$select public.manage_household_place_identity_link('00000000-0000-4000-8000-000000009810','appellation','Local Cote Dor','Local Premier Cru','set','00000000-0000-4000-8000-000000009834',null)$$,
    '22023','Choose an appellation in the linked region','Cannot map appellation outside chosen region');
select is((select count(*)::integer from jsonb_array_elements(public.search_household_places(
    '00000000-0000-4000-8000-000000009810','appellation','Local Cote Dor','Test Volnay'))),1,
    'Appellation search is scoped to selected region');
select lives_ok(
    $$select public.manage_household_place_identity_link('00000000-0000-4000-8000-000000009810','appellation','Local Cote Dor','Local Premier Cru','set','00000000-0000-4000-8000-000000009832',null)$$,
    'Local appellation maps once within its source area');
select is((select item->>'resolved_name' from jsonb_array_elements(
    public.get_household_place_identity_groups('00000000-0000-4000-8000-000000009810')->'appellations') item
    where item->>'source_appellation' = 'Local Premier Cru'),
    'Test Volnay Premier Cru','Owner sees the chosen canonical appellation');
select throws_ok(
    $$select public.manage_household_place_identity_link('00000000-0000-4000-8000-000000009810','region','Local Cote Dor',null,'set','00000000-0000-4000-8000-000000009833','00000000-0000-4000-8000-000000009831')$$,
    '22023','Region conflicts with a linked appellation','Cannot move region away from linked appellation');
select throws_ok(
    $$select public.manage_household_place_identity_link('00000000-0000-4000-8000-000000009810','appellation','Local Cote Dor','Local Premier Cru','remove',null,null)$$,
    '40001','Place mapping changed; refresh before saving','Stale form cannot remove a later decision');
reset role;
select is(private.drinking_window_wine_context('00000000-0000-4000-8000-000000009821')->>'status',
    'wine_reference_unlinked','Place is resolved; only producer/cuvée identity remains');
select is((private.drinking_window_wine_context('00000000-0000-4000-8000-000000009822')->>'appellation_id'),
    '00000000-0000-4000-8000-000000009832','The same local appellation link covers another vintage');
select is(private.drinking_window_wine_context('00000000-0000-4000-8000-000000009823')->>'status',
    'region_not_confirmed','Other households do not inherit a local region link');
select is((select count(*)::integer from public.enrichment_place_aliases
    where normalized_value in ('local cote dor','local premier cru')),0,
    'No global place alias was created');
select is((select area from public.wines where id='00000000-0000-4000-8000-000000009821'),
    'Local Cote Dor','Local wine descriptions remain unchanged');
set local role authenticated;
select throws_ok(
    $$select public.manage_household_place_identity_link('00000000-0000-4000-8000-000000009810','region','Local Cote Dor',null,'remove',null,'00000000-0000-4000-8000-000000009831')$$,
    '22023','Remove linked appellations before removing their region',
    'Region cannot be removed while a household appellation link depends on it');
select lives_ok(
    $$select public.manage_household_place_identity_link('00000000-0000-4000-8000-000000009810','appellation','Local Cote Dor','Local Premier Cru','remove',null,'00000000-0000-4000-8000-000000009832')$$,
    'Owner can remove a local appellation link');
select lives_ok(
    $$select public.manage_household_place_identity_link('00000000-0000-4000-8000-000000009810','region','Local Cote Dor',null,'remove',null,'00000000-0000-4000-8000-000000009831')$$,
    'Owner can remove the region link afterwards');
reset role;
select is(private.drinking_window_wine_context('00000000-0000-4000-8000-000000009821')->>'status',
    'region_not_confirmed','Removing household links restores the unresolved status');
select is((select count(*)::integer from private.household_place_identity_decisions
    where household_id='00000000-0000-4000-8000-000000009810'),4,
    'All four owner decisions remain in the private audit log');
select * from finish();
rollback;
