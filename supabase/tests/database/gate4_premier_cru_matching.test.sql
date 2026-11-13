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
insert into public.drinking_window_ageing_groups
 (id,version_id,scope,region_id,appellation_id,wine_color,group_key,definition)
values ('fa600000-0000-4000-8000-000000000013','fa600000-0000-4000-8000-000000000007',
 'appellation','fa600000-0000-4000-8000-000000000002','fa600000-0000-4000-8000-000000000004',
 'red','village','Synthetic broad village ageing group');
insert into public.drinking_window_ageing_group_memberships
 (id,version_id,group_id,member_kind,member_place_id,rationale)
values ('fa600000-0000-4000-8000-000000000014','fa600000-0000-4000-8000-000000000007',
 'fa600000-0000-4000-8000-000000000013','place','fa600000-0000-4000-8000-000000000004',
 'Synthetic parent-place membership for a village group');
insert into public.drinking_window_reference_rows
 (id,version_id,scope,appellation_id,region_id,wine_color,vintage_year,ageing_group_id,
  all_at_scope,first_trial_year,best_start_year,best_end_year,rationale)
values ('fa600000-0000-4000-8000-000000000015','fa600000-0000-4000-8000-000000000007',
 'appellation','fa600000-0000-4000-8000-000000000004','fa600000-0000-4000-8000-000000000002',
 'red',2022,'fa600000-0000-4000-8000-000000000013',false,2024,2026,2030,
 'Synthetic village-group estimate');
update public.wines set appellation='Premier Test Village 1C'
where id='fa600000-0000-4000-8000-000000000006';
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'no_match','A parent-place group does not silently classify a Premier Cru as village');
update public.wines set appellation='Premier Test Village GC'
where id='fa600000-0000-4000-8000-000000000006';
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'no_match','GC is not assigned an unclassified village window');
insert into public.drinking_window_reference_rows
 (id,version_id,scope,region_id,wine_color,vintage_year,all_at_scope,
  first_trial_year,best_start_year,best_end_year,rationale)
values ('fa600000-0000-4000-8000-000000000022',
 'fa600000-0000-4000-8000-000000000007','region',
 'fa600000-0000-4000-8000-000000000002','red',2022,true,2024,2026,2030,
 'Synthetic unclassified regional estimate');
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'no_match','GC is not assigned an unclassified regional window');
delete from public.drinking_window_reference_rows
where id='fa600000-0000-4000-8000-000000000022';
update public.wines set appellation='Premier Test Village',cuvee='Test Grand Cru'
where id='fa600000-0000-4000-8000-000000000006';
select ok(private.drinking_window_wine_requires_cru_classification(
 'fa600000-0000-4000-8000-000000000006'),
 'Grand Cru in the cuvée also requires explicit classification');
update public.wines set appellation='Premier Test Village',cuvee='Test Cuvée'
where id='fa600000-0000-4000-8000-000000000006';
select ok(not private.drinking_window_wine_requires_cru_classification(
 'fa600000-0000-4000-8000-000000000006'),
 'An unclassified village wine is not flagged as a cru');
update public.wines set classification='Premier Cru'
where id='fa600000-0000-4000-8000-000000000006';
select ok(private.drinking_window_wine_requires_cru_classification(
 'fa600000-0000-4000-8000-000000000006'),
 'Premier Cru in the separate classification field requires an explicit group');
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'no_match','A separate Premier Cru classification blocks an unclassified village fallback');
update public.wines set classification='Grand Cru'
where id='fa600000-0000-4000-8000-000000000006';
select ok(private.drinking_window_wine_requires_cru_classification(
 'fa600000-0000-4000-8000-000000000006'),
 'Grand Cru in the separate classification field requires an explicit group');
update public.wines set classification='AOC'
where id='fa600000-0000-4000-8000-000000000006';
select ok(not private.drinking_window_wine_requires_cru_classification(
 'fa600000-0000-4000-8000-000000000006'),
 'AOC alone does not invent a cru classification');
update public.wines set classification=null
where id='fa600000-0000-4000-8000-000000000006';
update public.wines set appellation='Premier Test Village 1C'
where id='fa600000-0000-4000-8000-000000000006';
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fa600000-0000-4000-8000-000000000017','fa600000-0000-4000-8000-000000000004',
  'climat','Premier Test Climat'),
 ('fa600000-0000-4000-8000-000000000018','fa600000-0000-4000-8000-000000000004',
  'climat','Another Premier Test Climat');
insert into public.drinking_window_ageing_groups
 (id,version_id,scope,region_id,appellation_id,wine_color,group_key,definition)
values ('fa600000-0000-4000-8000-000000000019','fa600000-0000-4000-8000-000000000007',
 'appellation','fa600000-0000-4000-8000-000000000002','fa600000-0000-4000-8000-000000000004',
 'red','climat','Synthetic explicitly reviewed Premier Cru climat group');
insert into public.drinking_window_ageing_group_memberships
 (id,version_id,group_id,member_kind,member_place_id,rationale)
values ('fa600000-0000-4000-8000-000000000020','fa600000-0000-4000-8000-000000000007',
 'fa600000-0000-4000-8000-000000000019','place','fa600000-0000-4000-8000-000000000017',
 'Synthetic reviewed exact climat membership');
insert into public.drinking_window_reference_rows
 (id,version_id,scope,appellation_id,region_id,wine_color,vintage_year,ageing_group_id,
  all_at_scope,first_trial_year,best_start_year,best_end_year,rationale)
values ('fa600000-0000-4000-8000-000000000021','fa600000-0000-4000-8000-000000000007',
 'appellation','fa600000-0000-4000-8000-000000000004','fa600000-0000-4000-8000-000000000002',
 'red',2022,'fa600000-0000-4000-8000-000000000019',false,2025,2028,2035,
 'Synthetic specific climat estimate');
update public.wines set cuvee='Premier Test Climat'
where id='fa600000-0000-4000-8000-000000000006';
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'fa600000-0000-4000-8000-000000000021'::uuid,
 'An exact unique climat is resolved from the cellar spelling within the appellation');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fa600000-0000-4000-8000-000000000026','fa600000-0000-4000-8000-000000000005',
  'climat','Premier Test Climat');
select is(private.drinking_window_exact_classified_climat(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000005'),
 null::uuid, 'A same-named climat in another appellation is not matched');
delete from public.enrichment_places where id='fa600000-0000-4000-8000-000000000026';
update public.wines set appellation='Premier Test Village'
where id='fa600000-0000-4000-8000-000000000006';
select is(private.drinking_window_exact_classified_climat(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000004'),
 null::uuid, 'A name alone cannot classify a village wine as Premier Cru');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fa600000-0000-4000-8000-000000000027','fa600000-0000-4000-8000-000000000004',
  'climat','Premier Test Village Village');
update public.wines set cuvee='Village'
where id='fa600000-0000-4000-8000-000000000006';
select is(private.drinking_window_exact_classified_climat(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000004'),
 null::uuid, 'An ordinary village wine is not matched to a Premier Cru climat named Village');
update public.wines set appellation='Premier Test Village 1C'
where id='fa600000-0000-4000-8000-000000000006';
select is(private.drinking_window_exact_classified_climat(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000004'),
 'fa600000-0000-4000-8000-000000000027'::uuid,
 'The explicitly classified Premier Cru climat named Village can still match');
delete from public.enrichment_places where id='fa600000-0000-4000-8000-000000000027';
update public.wines set appellation='Premier Test Village 1C',cuvee='Synthetic alias spelling'
where id='fa600000-0000-4000-8000-000000000006';
insert into public.enrichment_place_aliases(place_id,alias_value) values
 ('fa600000-0000-4000-8000-000000000017','Synthetic alias spelling');
select is(private.drinking_window_exact_classified_climat(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000004'),
 'fa600000-0000-4000-8000-000000000017'::uuid,
 'An explicitly curated exact alias resolves within the appellation');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fa600000-0000-4000-8000-000000000024','fa600000-0000-4000-8000-000000000004',
  'climat','Premier Test Village Les Caillerets');
update public.wines set cuvee='Caillerets'
where id='fa600000-0000-4000-8000-000000000006';
select is(private.drinking_window_exact_classified_climat(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000004'),
 'fa600000-0000-4000-8000-000000000024'::uuid,
 'An optional appellation prefix and article do not prevent a unique exact match');
delete from public.enrichment_places where id='fa600000-0000-4000-8000-000000000024';
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fa600000-0000-4000-8000-000000000025','fa600000-0000-4000-8000-000000000004',
  'climat','Premier Test Village Le Porusot');
update public.wines set cuvee='Porusot'
where id='fa600000-0000-4000-8000-000000000006';
select is(private.drinking_window_exact_classified_climat(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000004'),
 null::uuid, 'Distinct official names Le Porusot and Porusot are not silently conflated');
delete from public.enrichment_places where id='fa600000-0000-4000-8000-000000000025';
update public.wines set cuvee='Premier Test Climat'
where id='fa600000-0000-4000-8000-000000000006';
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fa600000-0000-4000-8000-000000000023','fa600000-0000-4000-8000-000000000004',
  'climat','Premier Test Village Premier Test Climat');
select is(private.drinking_window_exact_classified_climat(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000004'),
 null::uuid, 'Two exact candidates remain unresolved rather than choosing arbitrarily');
delete from public.enrichment_places where id='fa600000-0000-4000-8000-000000000023';
update public.wines set cuvee='Test Cuvée'
where id='fa600000-0000-4000-8000-000000000006';
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,'fa600000-0000-4000-8000-000000000017')),
 'fa600000-0000-4000-8000-000000000021'::uuid,
 'A reviewed exact climat is eligible for its Premier Cru');
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,'fa600000-0000-4000-8000-000000000018')),
 'no_match','A different climat does not inherit the group');
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'no_match','The climat group cannot match without a verified climat identity');
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
update public.wines set appellation='Premier Test Village GC'
where id='fa600000-0000-4000-8000-000000000006';
select is((select matched_scope from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 'fa600000-0000-4000-8000-000000000009','fa600000-0000-4000-8000-000000000010',
 'fa600000-0000-4000-8000-000000000011','fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'release','A reviewed exact-release window remains eligible for a Grand Cru');
insert into public.drinking_window_ageing_group_memberships
 (id,version_id,group_id,member_kind,member_place_id,member_product_id,rationale)
values ('fa600000-0000-4000-8000-000000000016','fa600000-0000-4000-8000-000000000007',
 'fa600000-0000-4000-8000-000000000013','product','fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000010','Explicitly reviewed synthetic cuvée membership');
delete from public.drinking_window_reference_rows where id='fa600000-0000-4000-8000-000000000012';
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 'fa600000-0000-4000-8000-000000000009','fa600000-0000-4000-8000-000000000010',
 'fa600000-0000-4000-8000-000000000011','fa600000-0000-4000-8000-000000000004',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'draft_match','An explicitly reviewed cuvée group remains eligible for a Premier Cru');

-- Some historical canonical databases represent a Premier Cru as an
-- appellation sibling of its village. A reviewed group anchored to the
-- village must still recognise its exact classified climat, not all crus.
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fa600000-0000-4000-8000-000000000028','fa600000-0000-4000-8000-000000000002',
  'appellation','Premier Test Village Premier Cru');
update public.enrichment_places set parent_id='fa600000-0000-4000-8000-000000000028',
 canonical_name='Premier Test Village Les Caillerets'
where id='fa600000-0000-4000-8000-000000000017';
update public.wines set appellation='Premier Test Village Premier Cru',cuvee='Caillerets'
where id='fa600000-0000-4000-8000-000000000006';
select ok(private.drinking_window_place_contains(
 'fa600000-0000-4000-8000-000000000004','fa600000-0000-4000-8000-000000000017'),
 'A classified sibling and its climate belong to the corresponding base appellation');
select ok(not private.drinking_window_place_contains(
 'fa600000-0000-4000-8000-000000000005','fa600000-0000-4000-8000-000000000017'),
 'A classified climate does not belong to a different appellation');
select is(private.drinking_window_exact_classified_climat(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000028'),
 'fa600000-0000-4000-8000-000000000017'::uuid,
 'A climate under a classified child resolves using the parent appellation prefix');
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000028',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'fa600000-0000-4000-8000-000000000021'::uuid,
 'A reviewed parent-appellation group applies to its explicitly listed child climat');
update public.wines set cuvee='Unknown climat' where id='fa600000-0000-4000-8000-000000000006';
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000028',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'no_match','An unknown classified climat receives neither a village nor another climat window');
update public.wines set cuvee='Caillerets' where id='fa600000-0000-4000-8000-000000000006';
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000028',
 'fa600000-0000-4000-8000-000000000002','white',2022,null)),
 'no_match','A classified group does not cross wine colors');
update public.wines set classification='Grand Cru' where id='fa600000-0000-4000-8000-000000000006';
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 null,null,null,'fa600000-0000-4000-8000-000000000028',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'no_match','Contradictory Grand Cru classification cannot inherit a Premier Cru group');
update public.wines set classification=null where id='fa600000-0000-4000-8000-000000000006';
insert into public.drinking_window_reference_rows
 (id,version_id,scope,producer_id,product_id,release_id,appellation_id,region_id,
  wine_color,vintage_year,all_at_scope,first_trial_year,best_start_year,best_end_year,rationale)
values ('fa600000-0000-4000-8000-000000000012','fa600000-0000-4000-8000-000000000007',
 'release','fa600000-0000-4000-8000-000000000009','fa600000-0000-4000-8000-000000000010',
 'fa600000-0000-4000-8000-000000000011','fa600000-0000-4000-8000-000000000028',
 'fa600000-0000-4000-8000-000000000002','red',2022,true,2025,2028,2040,
 'Synthetic exact release under the classified child');
select is((select matched_scope from private.drinking_window_preview_draft_match_for_wine(
 'fa600000-0000-4000-8000-000000000006','fa600000-0000-4000-8000-000000000007',
 'fa600000-0000-4000-8000-000000000009','fa600000-0000-4000-8000-000000000010',
 'fa600000-0000-4000-8000-000000000011','fa600000-0000-4000-8000-000000000028',
 'fa600000-0000-4000-8000-000000000002','red',2022,null)),
 'release','An exact release still takes precedence over the parent climate group');
select * from finish();
rollback;
