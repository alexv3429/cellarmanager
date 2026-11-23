begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(14);

-- Synthetic geographic denomination nested under its AOC. Names and data do
-- not correspond to any household or any actual published reference.
insert into public.households(id,name) values
 ('fd100000-0000-4000-8000-000000000001','Synthetic geographic designation');
insert into auth.users(id,email) values
 ('fd100000-0000-4000-8000-000000000008','designation-curator@example.test');
insert into public.enrichment_curator_eligibilities(user_id,display_name,profile_scopes,rationale,granted_by)
values ('fd100000-0000-4000-8000-000000000008','Synthetic curator',array['drinking-window'],
 'Synthetic reviewed geographic designation','database-test');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fd100000-0000-4000-8000-000000000002',null,'region','Synthetic Designation Region'),
 ('fd100000-0000-4000-8000-000000000003','fd100000-0000-4000-8000-000000000002',
  'appellation','Synthetic Parent AOC'),
 ('fd100000-0000-4000-8000-000000000004','fd100000-0000-4000-8000-000000000003',
  'appellation','Synthetic Parent AOC Designation');
insert into private.drinking_window_geographic_designations(place_id,appellation_id,curator_id,identity_reason)
values ('fd100000-0000-4000-8000-000000000004','fd100000-0000-4000-8000-000000000003',
 'fd100000-0000-4000-8000-000000000008','Synthetic parent and geographic designation');
insert into public.wines(id,household_id,producer,cuvee,vintage,color,area,appellation,format_ml) values
 ('fd100000-0000-4000-8000-000000000005','fd100000-0000-4000-8000-000000000001',
  'Synthetic producer','Synthetic cuvee',2020,'red','Synthetic Designation Region',
  'Synthetic Parent AOC Designation',750);
insert into public.drinking_window_reference_versions(id,version_number) values
 ('fd100000-0000-4000-8000-000000000006',998774);
insert into public.drinking_window_reference_rows
 (id,version_id,scope,region_id,appellation_id,wine_color,vintage_year,
  all_at_scope,first_trial_year,best_start_year,best_end_year,rationale) values
 ('fd100000-0000-4000-8000-000000000007','fd100000-0000-4000-8000-000000000006',
  'appellation','fd100000-0000-4000-8000-000000000002','fd100000-0000-4000-8000-000000000003',
  'red',2020,true,2022,2024,2029,'Synthetic parent estimate');

select ok(private.drinking_window_place_contains(
 'fd100000-0000-4000-8000-000000000003','fd100000-0000-4000-8000-000000000004'),
 'The geographic model identifies the parent of the denomination');
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fd100000-0000-4000-8000-000000000005','fd100000-0000-4000-8000-000000000006',
 null,null,null,'fd100000-0000-4000-8000-000000000004','fd100000-0000-4000-8000-000000000002',
 'red',2020,null)), 'fd100000-0000-4000-8000-000000000007'::uuid,
 'An identified geographical denomination can fall back to its parent AOC');
select is((select reference_row_id from public.drinking_window_preview_draft_match(
 'fd100000-0000-4000-8000-000000000006',null,null,null,
 'fd100000-0000-4000-8000-000000000004','fd100000-0000-4000-8000-000000000002',
 'red',2020,null,750)), 'fd100000-0000-4000-8000-000000000007'::uuid,
 'The parameter-based preview uses the same parent fallback');

insert into public.drinking_window_reference_rows
 (id,version_id,scope,region_id,appellation_id,wine_color,vintage_year,
  all_at_scope,first_trial_year,best_start_year,best_end_year,rationale) values
 ('fd100000-0000-4000-8000-000000000009','fd100000-0000-4000-8000-000000000006',
  'appellation','fd100000-0000-4000-8000-000000000002','fd100000-0000-4000-8000-000000000004',
  'red',2020,true,2023,2026,2031,'Synthetic denomination estimate');
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fd100000-0000-4000-8000-000000000005','fd100000-0000-4000-8000-000000000006',
 null,null,null,'fd100000-0000-4000-8000-000000000004','fd100000-0000-4000-8000-000000000002',
 'red',2020,null)), 'fd100000-0000-4000-8000-000000000009'::uuid,
 'A denomination-specific estimate wins over the parent estimate');
select is((select reference_row_id from public.drinking_window_preview_draft_match(
 'fd100000-0000-4000-8000-000000000006',null,null,null,
 'fd100000-0000-4000-8000-000000000003','fd100000-0000-4000-8000-000000000002',
 'red',2020,null,750)), 'fd100000-0000-4000-8000-000000000007'::uuid,
 'A wine identified only as the parent cannot receive the more specific estimate');
select ok(not private.drinking_window_appellation_applies(
 'fd100000-0000-4000-8000-000000000004','fd100000-0000-4000-8000-000000000003'),
 'The parent-child relation is never applied backwards');

insert into public.wine_reference_entities(id,entity_type) values
 ('fd100000-0000-4000-8000-000000000010','producer'),
 ('fd100000-0000-4000-8000-000000000011','product'),
 ('fd100000-0000-4000-8000-000000000012','release');
insert into public.wine_reference_producers(id,canonical_name)
 values ('fd100000-0000-4000-8000-000000000010','Synthetic producer');
insert into public.wine_reference_products(id,producer_id,canonical_name)
 values ('fd100000-0000-4000-8000-000000000011','fd100000-0000-4000-8000-000000000010','Synthetic cuvee');
insert into public.wine_reference_releases(id,product_id,vintage_year)
 values ('fd100000-0000-4000-8000-000000000012','fd100000-0000-4000-8000-000000000011',2020);
insert into public.drinking_window_reference_rows
 (id,version_id,scope,region_id,appellation_id,producer_id,product_id,release_id,wine_color,
  vintage_year,all_at_scope,first_trial_year,best_start_year,best_end_year,rationale) values
 ('fd100000-0000-4000-8000-000000000013','fd100000-0000-4000-8000-000000000006',
  'release','fd100000-0000-4000-8000-000000000002','fd100000-0000-4000-8000-000000000003',
  'fd100000-0000-4000-8000-000000000010','fd100000-0000-4000-8000-000000000011',
  'fd100000-0000-4000-8000-000000000012','red',2020,true,2021,2023,2030,'Synthetic exact release');
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fd100000-0000-4000-8000-000000000005','fd100000-0000-4000-8000-000000000006',
 'fd100000-0000-4000-8000-000000000010','fd100000-0000-4000-8000-000000000011',
 'fd100000-0000-4000-8000-000000000012','fd100000-0000-4000-8000-000000000004',
 'fd100000-0000-4000-8000-000000000002','red',2020,null)),
 'fd100000-0000-4000-8000-000000000013'::uuid,
 'An exact producer and vintage estimate at the parent AOC wins over the denomination fallback');
select is((select reference_row_id from public.drinking_window_preview_draft_match(
 'fd100000-0000-4000-8000-000000000006',
 'fd100000-0000-4000-8000-000000000010','fd100000-0000-4000-8000-000000000011',
 'fd100000-0000-4000-8000-000000000012','fd100000-0000-4000-8000-000000000004',
 'fd100000-0000-4000-8000-000000000002','red',2020,null,750)),
 'fd100000-0000-4000-8000-000000000013'::uuid,
 'The parameter preview also gives the exact release precedence');
select ok(not has_function_privilege('anon',
 'public.create_drinking_window_geographic_denomination(uuid,text,text,boolean)','execute'),
 'Anonymous callers cannot create denominations');
grant usage on schema extensions to authenticated;
set local role authenticated;
set local request.jwt.claim.sub = 'fd100000-0000-4000-8000-000000000099';
select throws_ok($q$select public.create_drinking_window_geographic_denomination(
 'fd100000-0000-4000-8000-000000000003','Synthetic Other Designation',
 'Synthetic evidence of the parent designation.',true)$q$,
 '42501','An active curator grant for this profile type is required',
 'An ordinary account cannot create shared designations');
set local request.jwt.claim.sub = 'fd100000-0000-4000-8000-000000000008';
select set_config('test.designation_id',public.create_drinking_window_geographic_denomination(
 'fd100000-0000-4000-8000-000000000003','Synthetic Other Designation',
 'Synthetic evidence of the parent designation.',true)->>'id',true);
select throws_ok($q$select public.create_drinking_window_geographic_denomination(
 'fd100000-0000-4000-8000-000000000003','synthetic other designation',
 'Synthetic evidence of the parent designation.',true)$q$,
 '23505','This place name already exists; select it instead',
 'A duplicate designation name is rejected');
select throws_ok($q$select public.create_drinking_window_geographic_denomination(
 current_setting('test.designation_id')::uuid,'Synthetic Nested Designation',
 'Synthetic evidence of the parent designation.',true)$q$,
 '22023','Choose an existing parent appellation',
 'Another denomination cannot be mistaken for an AOC parent');
select ok(public.search_drinking_window_curation_targets('appellation','Synthetic Other Designation')::text
 like '%geographic denomination%Synthetic Parent AOC%',
 'Curator search distinguishes the denomination and its parent AOC');
reset role;
select ok(exists(select 1 from private.drinking_window_geographic_designations
 where place_id=current_setting('test.designation_id')::uuid
   and appellation_id='fd100000-0000-4000-8000-000000000003'),
 'The curated denomination retains an audited parent appellation');
select * from finish();
rollback;
