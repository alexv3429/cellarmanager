begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into public.households(id,name) values
 ('fa600000-0000-4000-8000-000000000001','Premier Cru test');
insert into public.enrichment_places(id,place_type,canonical_name) values
 ('fa600000-0000-4000-8000-000000000002','region','Premier Test Region'),
 ('fa600000-0000-4000-8000-000000000003','region','Premier Other Region');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fa600000-0000-4000-8000-000000000004','fa600000-0000-4000-8000-000000000002',
  'appellation','Premier Test Village'),
 ('fa600000-0000-4000-8000-000000000005','fa600000-0000-4000-8000-000000000003',
  'appellation','Premier Other Village');
insert into public.wines(id,household_id,producer,cuvee,vintage,color,area,appellation,format_ml) values
 ('fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000001',
  'Test Producer','Test Cuvée',2022,'red','Premier Test Region','Premier Test Village 1C',750);
insert into public.drinking_window_reference_versions(id,version_number) values
 ('fa600000-0000-4000-8000-000000000007',998761);
insert into public.drinking_window_reference_rows
 (id,version_id,scope,appellation_id,region_id,wine_color,vintage_year,all_at_scope,
  first_trial_year,best_start_year,best_end_year,rationale)
values ('fa600000-0000-4000-8000-000000000008',
 'fa600000-0000-4000-8000-000000000007','appellation',
 'fa600000-0000-4000-8000-000000000004','fa600000-0000-4000-8000-000000000002',
 'red',2022,true,2024,2026,2030,'Synthetic unclassified village estimate');

select is(private.household_resolved_appellation(
 'fa600000-0000-4000-8000-000000000001','Premier Test Region','Premier Test Village 1C'),
 'fa600000-0000-4000-8000-000000000004'::uuid,'1C resolves to its unique parent');
select is(private.household_resolved_appellation(
 'fa600000-0000-4000-8000-000000000001','Premier Test Region','Premier Test Village 1er cru'),
 'fa600000-0000-4000-8000-000000000004'::uuid,'1er cru resolves to the same parent');
select is(private.household_resolved_appellation(
 'fa600000-0000-4000-8000-000000000001','Premier Other Region','Premier Test Village 1C'),
 null::uuid,'A parent outside the resolved region does not match');
select is(private.household_resolved_appellation(
 'fa600000-0000-4000-8000-000000000001','Premier Test Region','Premier Test Village GC'),
 null::uuid,'Grand Cru is never silently reduced to its village');
select is((private.drinking_window_wine_context('fa600000-0000-4000-8000-000000000006')->>'appellation_id')::uuid,
 'fa600000-0000-4000-8000-000000000004'::uuid,'The wine context can now resolve the appellation');
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'no_match','An unclassified village window is not assigned to a Premier Cru');
update public.wines set appellation='Premier Test Village'
where id='fa600000-0000-4000-8000-000000000006';
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'draft_match','The same village window remains available for an unclassified wine');
insert into public.wine_reference_entities(id,entity_type) values
 ('fa600000-0000-4000-8000-000000000009','producer'),
 ('fa600000-0000-4000-8000-000000000010','product'),
 ('fa600000-0000-4000-8000-000000000011','release');
insert into public.wine_reference_producers(id,canonical_name) values
 ('fa600000-0000-4000-8000-000000000009','Premier Test Producer');
insert into public.wine_reference_products(id,producer_id,canonical_name) values
 ('fa600000-0000-4000-8000-000000000010',
  'fa600000-0000-4000-8000-000000000009','Premier Test Cuvée');
insert into public.wine_reference_releases(id,product_id,vintage_year) values
 ('fa600000-0000-4000-8000-000000000011',
  'fa600000-0000-4000-8000-000000000010',2022);
insert into public.drinking_window_reference_rows
 (id,version_id,scope,producer_id,product_id,release_id,appellation_id,region_id,
  wine_color,vintage_year,all_at_scope,first_trial_year,best_start_year,best_end_year,rationale)
values ('fa600000-0000-4000-8000-000000000012','fa600000-0000-4000-8000-000000000007',
 'release','fa600000-0000-4000-8000-000000000009','fa600000-0000-4000-8000-000000000010',
 'fa600000-0000-4000-8000-000000000011','fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,true,2025,2028,2040,
 'Synthetic specific Premier Cru estimate');
update public.wines set appellation='Premier Test Village 1C'
where id='fa600000-0000-4000-8000-000000000006';
select is((select matched_scope from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 'fa600000-0000-4000-8000-000000000009','fa600000-0000-4000-8000-000000000010',
 'fa600000-0000-4000-8000-000000000011','fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'release','A reviewed exact-release window remains eligible for a Premier Cru');
select * from finish();
rollback;
