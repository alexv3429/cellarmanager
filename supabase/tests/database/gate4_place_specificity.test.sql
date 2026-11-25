begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id,email) values
 ('fc900000-0000-4000-8000-000000000001','specificity-owner@example.test');
insert into public.households(id,name) values
 ('fc900000-0000-4000-8000-000000000002','Synthetic specificity');
insert into public.enrichment_places(id,place_type,canonical_name) values
 ('fc900000-0000-4000-8000-000000000003','region','Specificity Test Region');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
  'appellation','Specificity Test Village');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fc900000-0000-4000-8000-000000000005','fc900000-0000-4000-8000-000000000004',
  'climat','Specificity Test Village Les Clos');
insert into public.wines(id,household_id,producer,cuvee,vintage,color,area,appellation,format_ml) values
 ('fc900000-0000-4000-8000-000000000006','fc900000-0000-4000-8000-000000000002',
  'Test Producer','Les Clos',2018,'white','Specificity Test Region','Specificity Test Village',750);
insert into public.drinking_window_reference_versions(id,version_number) values
 ('fc900000-0000-4000-8000-000000000007',998775);
insert into public.drinking_window_ageing_groups
 (id,version_id,scope,region_id,appellation_id,wine_color,group_key,definition) values
 ('fc900000-0000-4000-8000-000000000008','fc900000-0000-4000-8000-000000000007',
  'appellation','fc900000-0000-4000-8000-000000000003','fc900000-0000-4000-8000-000000000004',
  'white','village','Synthetic broad village group'),
 ('fc900000-0000-4000-8000-000000000009','fc900000-0000-4000-8000-000000000007',
  'appellation','fc900000-0000-4000-8000-000000000003','fc900000-0000-4000-8000-000000000004',
  'white','climat','Synthetic specific climate group');
insert into public.drinking_window_ageing_group_memberships
 (id,version_id,group_id,member_kind,member_place_id,rationale) values
 ('fc900000-0000-4000-8000-000000000010','fc900000-0000-4000-8000-000000000007',
  'fc900000-0000-4000-8000-000000000008','place','fc900000-0000-4000-8000-000000000004',
  'Synthetic village membership'),
 ('fc900000-0000-4000-8000-000000000011','fc900000-0000-4000-8000-000000000007',
  'fc900000-0000-4000-8000-000000000009','place','fc900000-0000-4000-8000-000000000005',
  'Synthetic climate membership');
insert into public.drinking_window_reference_rows
 (id,version_id,scope,region_id,appellation_id,wine_color,vintage_year,ageing_group_id,
  all_at_scope,first_trial_year,best_start_year,best_end_year,rationale) values
 ('fc900000-0000-4000-8000-000000000012','fc900000-0000-4000-8000-000000000007',
  'appellation','fc900000-0000-4000-8000-000000000003','fc900000-0000-4000-8000-000000000004',
  'white',2018,'fc900000-0000-4000-8000-000000000008',false,2019,2021,2028,'Village estimate'),
 ('fc900000-0000-4000-8000-000000000013','fc900000-0000-4000-8000-000000000007',
  'appellation','fc900000-0000-4000-8000-000000000003','fc900000-0000-4000-8000-000000000004',
  'white',2018,'fc900000-0000-4000-8000-000000000009',false,2020,2023,2034,'Climate estimate');

select is((select count(*) from public.drinking_window_eligibility_issues(
 'fc900000-0000-4000-8000-000000000007') where issue_code='membership_place_overlap'),0::bigint,
 'A strict parent-appellation versus child-climat pair can coexist');
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fc900000-0000-4000-8000-000000000006','fc900000-0000-4000-8000-000000000007',
 null,null,null,'fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
 'white',2018,null)), 'fc900000-0000-4000-8000-000000000012'::uuid,
 'A village wine with no confirmed climat uses only the village group');
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fc900000-0000-4000-8000-000000000006','fc900000-0000-4000-8000-000000000007',
 null,null,null,'fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
 'white',2018,'fc900000-0000-4000-8000-000000000005')),
 'fc900000-0000-4000-8000-000000000013'::uuid,
 'A confirmed exact climat takes precedence over the parent appellation');
select is((select reference_row_id from public.drinking_window_preview_draft_match(
 'fc900000-0000-4000-8000-000000000007',null,null,null,
 'fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
 'white',2018,'fc900000-0000-4000-8000-000000000005',750)),
 'fc900000-0000-4000-8000-000000000013'::uuid,
 'The parameter-based selector uses the same confirmed-climat precedence');
update public.wines set appellation='Specificity Test Village 1C'
where id='fc900000-0000-4000-8000-000000000006';
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fc900000-0000-4000-8000-000000000006','fc900000-0000-4000-8000-000000000007',
 null,null,null,'fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
 'white',2018,null)), 'fc900000-0000-4000-8000-000000000013'::uuid,
 'A verified Premier Cru resolves to the more specific group');
update public.wines set cuvee='Unresolved'
where id='fc900000-0000-4000-8000-000000000006';
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fc900000-0000-4000-8000-000000000006','fc900000-0000-4000-8000-000000000007',
 null,null,null,'fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
 'white',2018,null)), 'no_match',
 'An unknown Premier Cru never silently receives the village estimate');

-- Two groups with the same climat are not ordered by place depth.
insert into public.drinking_window_ageing_groups
 (id,version_id,scope,region_id,appellation_id,wine_color,group_key,definition)
select 'fc900000-0000-4000-8000-000000000014',version_id,scope,region_id,appellation_id,
 wine_color,'duplicate-climat','Synthetic competing group'
from public.drinking_window_ageing_groups where id='fc900000-0000-4000-8000-000000000009';
insert into public.drinking_window_ageing_group_memberships
 (id,version_id,group_id,member_kind,member_place_id,rationale)
select 'fc900000-0000-4000-8000-000000000015',version_id,
 'fc900000-0000-4000-8000-000000000014',member_kind,member_place_id,'Competing membership'
from public.drinking_window_ageing_group_memberships where id='fc900000-0000-4000-8000-000000000011';
insert into public.drinking_window_reference_rows
 (id,version_id,scope,region_id,appellation_id,wine_color,vintage_year,ageing_group_id,
  all_at_scope,first_trial_year,best_start_year,best_end_year,rationale)
select 'fc900000-0000-4000-8000-000000000016',version_id,scope,region_id,appellation_id,
 wine_color,vintage_year,'fc900000-0000-4000-8000-000000000014',false,2021,2025,2035,'Competing estimate'
from public.drinking_window_reference_rows where id='fc900000-0000-4000-8000-000000000013';
select ok(exists(select 1 from public.drinking_window_eligibility_issues(
 'fc900000-0000-4000-8000-000000000007') where issue_code='membership_place_overlap'),
 'Two groups for the same climat still block publication');
select is((select status from private.drinking_window_preview_draft_match_for_wine(
 'fc900000-0000-4000-8000-000000000006','fc900000-0000-4000-8000-000000000007',
 null,null,null,'fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
 'white',2018,'fc900000-0000-4000-8000-000000000005')), 'ambiguous',
 'The selector does not arbitrarily choose between equal-specificity groups');
select is((select status from public.drinking_window_preview_draft_match(
 'fc900000-0000-4000-8000-000000000007',null,null,null,
 'fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
 'white',2018,'fc900000-0000-4000-8000-000000000005',750)), 'ambiguous',
 'The parameter-based selector also preserves same-climat ambiguity');
update public.drinking_window_ageing_group_memberships
set member_place_id='fc900000-0000-4000-8000-000000000004'
where id='fc900000-0000-4000-8000-000000000015';
select ok(exists(select 1 from public.drinking_window_eligibility_issues(
 'fc900000-0000-4000-8000-000000000007') where issue_code='membership_place_overlap'),
 'Two groups for the same parent appellation still block publication');
update public.drinking_window_ageing_group_memberships
set member_place_id='fc900000-0000-4000-8000-000000000005'
where id='fc900000-0000-4000-8000-000000000015';

insert into private.household_wine_ageing_choices
 (wine_id,household_id,version_id,scope,group_id,source_fingerprint,decided_by)
select id,household_id,'fc900000-0000-4000-8000-000000000007','appellation',
 'fc900000-0000-4000-8000-000000000009',private.drinking_window_wine_identity_fingerprint(w),
 'fc900000-0000-4000-8000-000000000001'
from public.wines w where id='fc900000-0000-4000-8000-000000000006';
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fc900000-0000-4000-8000-000000000006','fc900000-0000-4000-8000-000000000007',
 null,null,null,'fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
 'white',2018,'fc900000-0000-4000-8000-000000000005')),
 'fc900000-0000-4000-8000-000000000013'::uuid,
 'An explicit current household choice still wins among groups at its scope');
update private.household_wine_ageing_choices set group_id='fc900000-0000-4000-8000-000000000008'
where wine_id='fc900000-0000-4000-8000-000000000006';
select is((select reference_row_id from private.drinking_window_preview_draft_match_for_wine(
 'fc900000-0000-4000-8000-000000000006','fc900000-0000-4000-8000-000000000007',
 null,null,null,'fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000003',
 'white',2018,'fc900000-0000-4000-8000-000000000005')),
 'fc900000-0000-4000-8000-000000000012'::uuid,
 'An explicit household choice can select the broader group over the climat');
select * from finish();
rollback;
