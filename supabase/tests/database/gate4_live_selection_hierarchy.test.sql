begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- Entirely synthetic, rollback-only reader integration test. The publication
-- workflow itself is tested separately in drinking_window_full_profile_publication_flow.
insert into auth.users(id,email) values
 ('fd200000-0000-4000-8000-000000000001','hierarchy-owner@example.test'),
 ('fd200000-0000-4000-8000-000000000002','hierarchy-member@example.test');
insert into public.households(id,name) values
 ('fd200000-0000-4000-8000-000000000003','Synthetic hierarchy');
insert into public.household_members(household_id,user_id,role) values
 ('fd200000-0000-4000-8000-000000000003','fd200000-0000-4000-8000-000000000001','owner'),
 ('fd200000-0000-4000-8000-000000000003','fd200000-0000-4000-8000-000000000002','member');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fd200000-0000-4000-8000-000000000004',null,'region','Hierarchy Test Region'),
 ('fd200000-0000-4000-8000-000000000005','fd200000-0000-4000-8000-000000000004',
  'appellation','Hierarchy Test Appellation'),
 ('fd200000-0000-4000-8000-000000000006','fd200000-0000-4000-8000-000000000004',
  'appellation','Hierarchy Other Appellation');
insert into public.wine_reference_entities(id,entity_type) values
 ('fd200000-0000-4000-8000-000000000007','producer'),
 ('fd200000-0000-4000-8000-000000000008','product'),
 ('fd200000-0000-4000-8000-000000000009','release');
insert into public.wine_reference_producers(id,canonical_name)
 values ('fd200000-0000-4000-8000-000000000007','Hierarchy Producer');
insert into public.wine_reference_products(id,producer_id,canonical_name)
 values ('fd200000-0000-4000-8000-000000000008','fd200000-0000-4000-8000-000000000007','Hierarchy Cuvée');
insert into public.wine_reference_releases(id,product_id,vintage_year)
 values ('fd200000-0000-4000-8000-000000000009','fd200000-0000-4000-8000-000000000008',2022);
insert into public.wines(id,household_id,producer,cuvee,vintage,color,area,appellation,format_ml,
 wine_reference_id,wine_reference_type) values
 ('fd200000-0000-4000-8000-000000000010','fd200000-0000-4000-8000-000000000003',
  'Hierarchy Producer','Hierarchy Cuvée',2022,'red','Hierarchy Test Region','Hierarchy Test Appellation',750,
  'fd200000-0000-4000-8000-000000000009','release'),
 ('fd200000-0000-4000-8000-000000000011','fd200000-0000-4000-8000-000000000003',
  'Another Producer','Another Cuvée',2022,'red','Hierarchy Test Region','Hierarchy Test Appellation',750,null,null),
 ('fd200000-0000-4000-8000-000000000012','fd200000-0000-4000-8000-000000000003',
  'Other Producer','Other Cuvée',2022,'red','Hierarchy Test Region','Hierarchy Other Appellation',750,null,null),
 ('fd200000-0000-4000-8000-000000000013','fd200000-0000-4000-8000-000000000003',
  'Other Producer','Other Cuvée',2021,'red','Hierarchy Test Region','Hierarchy Other Appellation',750,null,null);
insert into public.drinking_window_reference_versions(id,version_number) values
 ('fd200000-0000-4000-8000-000000000014',998773);
insert into public.drinking_window_reference_rows
 (id,version_id,scope,region_id,appellation_id,producer_id,product_id,release_id,
  wine_color,vintage_year,all_at_scope,first_trial_year,best_start_year,best_end_year,rationale) values
 ('fd200000-0000-4000-8000-000000000015','fd200000-0000-4000-8000-000000000014',
  'release','fd200000-0000-4000-8000-000000000004','fd200000-0000-4000-8000-000000000005',
  'fd200000-0000-4000-8000-000000000007','fd200000-0000-4000-8000-000000000008',
  'fd200000-0000-4000-8000-000000000009','red',2022,true,2025,2028,2040,'Synthetic producer estimate'),
 ('fd200000-0000-4000-8000-000000000016','fd200000-0000-4000-8000-000000000014',
  'appellation','fd200000-0000-4000-8000-000000000004','fd200000-0000-4000-8000-000000000005',
  null,null,null,'red',2022,true,2024,2027,2035,'Synthetic appellation estimate'),
 ('fd200000-0000-4000-8000-000000000017','fd200000-0000-4000-8000-000000000014',
  'region','fd200000-0000-4000-8000-000000000004',null,null,null,null,
  'red',2022,true,2023,2026,2032,'Synthetic regional estimate');

select set_config('app.drinking_window_publication','on',true);
update public.drinking_window_reference_versions set status='active',published_at=now(),
 content_sha256=public.drinking_window_draft_fingerprint(id)
where id='fd200000-0000-4000-8000-000000000014';
insert into private.drinking_window_publications(version_id,content_sha256,reviewed_household_count)
select id,content_sha256,0 from public.drinking_window_reference_versions
where id='fd200000-0000-4000-8000-000000000014';
update private.drinking_window_runtime_switch set enabled=true,
 version_id='fd200000-0000-4000-8000-000000000014' where singleton;

set local role authenticated;
set local request.jwt.claim.sub = 'fd200000-0000-4000-8000-000000000001';
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000010')
 #>> '{reference,matched_scope}','release','The exact producer and vintage window is selected');
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000011')
 #>> '{reference,matched_scope}','appellation','The matching appellation is used without an exact producer window');
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000012')
 #>> '{reference,matched_scope}','region','The matching region is used when no appellation window exists');
select is((select concat_ws('/',r->>'first_trial_year',r->>'best_start_year',r->>'best_end_year')
 from (select public.get_wine_maturity('fd200000-0000-4000-8000-000000000010')->'reference' r) q),
 '2025/2028/2040','All three exact dates come from the producer reference');
select is((select concat_ws('/',r->>'first_trial_year',r->>'best_start_year',r->>'best_end_year')
 from (select public.get_wine_maturity('fd200000-0000-4000-8000-000000000011')->'reference' r) q),
 '2024/2027/2035','All three appellation dates come from one reference');
select is((select concat_ws('/',r->>'first_trial_year',r->>'best_start_year',r->>'best_end_year')
 from (select public.get_wine_maturity('fd200000-0000-4000-8000-000000000012')->'reference' r) q),
 '2023/2026/2032','All three regional dates come from one reference');
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000013')
 ->> 'effective_source','unavailable','Another vintage does not inherit a reference window');
select is((select row->>'first_trial_year' from jsonb_array_elements(
 public.get_household_maturity_overview('fd200000-0000-4000-8000-000000000003')) row
 where row->>'wine_id'='fd200000-0000-4000-8000-000000000012'),
 '2023','The catalogue shows the same regional dates as the wine card');
select is(public.set_member_maturity_calibration(2)->>'year_shift','2','A member can choose a personal offset');
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000010')
 #>> '{reference,effective_first_trial_year}','2027','The offset shifts the exact window');
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000011')
 #>> '{reference,effective_best_end_year}','2037','The same offset shifts the appellation window');
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000012')
 #>> '{reference,effective_best_start_year}','2028','The same offset shifts the regional window');
select is(public.set_wine_maturity_override('fd200000-0000-4000-8000-000000000011',
 2029,2031,2039,null,null,'Synthetic manual dates')->>'effective_source',
 'manual','A local wine override wins over the shared appellation');
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000011')
 #>> '{calibration,active}','false','A manual window is not shifted a second time');
set local request.jwt.claim.sub = 'fd200000-0000-4000-8000-000000000002';
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000010')
 #>> '{reference,effective_first_trial_year}','2025','Another member does not inherit the owner’s personal offset');
select is(public.get_wine_maturity('fd200000-0000-4000-8000-000000000011')
 ->> 'effective_source','manual','A manual window is shared within the household');
select * from finish();
rollback;
