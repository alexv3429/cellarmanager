begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id,email) values
 ('fa730000-0000-4000-8000-000000000001','scope-curator@example.test'),
 ('fa730000-0000-4000-8000-000000000002','scope-member@example.test');
insert into public.enrichment_curator_eligibilities(user_id,display_name,profile_scopes,rationale,granted_by)
values ('fa730000-0000-4000-8000-000000000001','Synthetic curator',array['drinking-window'],
 'Checks safe changes to a geographic scope.', 'database-test');
set local request.jwt.claim.sub = 'fa730000-0000-4000-8000-000000000001';
insert into public.drinking_window_reference_versions(id,version_number)
values ('fa730000-0000-4000-8000-000000000003',
 (select coalesce(max(version_number),0)+1 from public.drinking_window_reference_versions));
insert into public.enrichment_places(id,parent_id,place_type,canonical_name,country_code) values
 ('fa730000-0000-4000-8000-000000000010',null,'region','Synthetic Scope Region','FR'),
 ('fa730000-0000-4000-8000-000000000011','fa730000-0000-4000-8000-000000000010',
  'appellation','Synthetic Scope Appellation','FR'),
 ('fa730000-0000-4000-8000-000000000012','fa730000-0000-4000-8000-000000000010',
  'appellation','Synthetic Other Appellation','FR');
select set_config('test.scope_group', public.create_drinking_window_ageing_group(
 'fa730000-0000-4000-8000-000000000003','region','fa730000-0000-4000-8000-000000000010',
 null,null,'white','synthetic narrow group','A synthetic group that only includes one appellation.')::text,true);
select set_config('test.scope_member', public.add_drinking_window_group_membership(
 current_setting('test.scope_group')::uuid,'place','fa730000-0000-4000-8000-000000000011',
 'fa730000-0000-4000-8000-000000000011',null,null,
 'This synthetic group belongs to the one selected appellation.')::text,true);
select set_config('test.scope_row',public.add_drinking_window_group_year(
 current_setting('test.scope_group')::uuid,2022,2024,2026,2031,
 'Synthetic ordered dates for the geographic scope correction test.')::text,true);
select set_config('test.scope_hash',private.drinking_window_review_subject_hash(
 'fa730000-0000-4000-8000-000000000003','group',current_setting('test.scope_group')::uuid),true);
select set_config('test.row_hash',private.drinking_window_review_subject_hash(
 'fa730000-0000-4000-8000-000000000003','row',current_setting('test.scope_row')::uuid),true);
select set_config('test.regional_group', public.create_drinking_window_ageing_group(
 'fa730000-0000-4000-8000-000000000003','region','fa730000-0000-4000-8000-000000000010',
 null,null,'white','synthetic regional fallback','A synthetic regional fallback for both appellations.')::text,true);
select public.add_drinking_window_group_membership(current_setting('test.regional_group')::uuid,
 'place','fa730000-0000-4000-8000-000000000010','fa730000-0000-4000-8000-000000000010',
 null,null,'The synthetic region is a member of this regional fallback.');
select public.add_drinking_window_group_year(current_setting('test.regional_group')::uuid,
 2022,2023,2025,2029,'A synthetic regional estimate distinct from the appellation estimate.');
select ok(exists(select 1 from public.drinking_window_eligibility_issues(
 'fa730000-0000-4000-8000-000000000003') where issue_code='membership_place_overlap'),
 'Before correction two overlapping region groups are blocked');

select throws_ok($q$select public.narrow_drinking_window_region_group(
 'fa730000-0000-4000-8000-000000000003',current_setting('test.scope_group')::uuid,
 'fa730000-0000-4000-8000-000000000012',current_setting('test.scope_hash'),
 'This synthetic correction has a sufficiently clear explanation.',true)$q$,
 '22023','All group members must already belong to the chosen appellation',
 'Cannot reclassify an existing member into the wrong appellation');
select throws_ok($q$select public.narrow_drinking_window_region_group(
 'fa730000-0000-4000-8000-000000000003',current_setting('test.scope_group')::uuid,
 'fa730000-0000-4000-8000-000000000011',repeat('0',64),
 'This synthetic correction has a sufficiently clear explanation.',true)$q$,
 '40001','This group changed; refresh before correcting it','A stale form cannot alter the group');
set local request.jwt.claim.sub = 'fa730000-0000-4000-8000-000000000002';
select throws_ok($q$select public.narrow_drinking_window_region_group(
 'fa730000-0000-4000-8000-000000000003',current_setting('test.scope_group')::uuid,
 'fa730000-0000-4000-8000-000000000011',current_setting('test.scope_hash'),
 'This synthetic correction has a sufficiently clear explanation.',true)$q$,
 '42501','An active curator grant for this profile type is required',
 'An ordinary user cannot correct shared scope');
set local request.jwt.claim.sub = 'fa730000-0000-4000-8000-000000000001';
select throws_ok($q$select public.narrow_drinking_window_region_group(
 'fa730000-0000-4000-8000-000000000003',current_setting('test.scope_group')::uuid,
 'fa730000-0000-4000-8000-000000000011',current_setting('test.scope_hash'),
 'This synthetic correction has a sufficiently clear explanation.',false)$q$,
 '22023','Explain the corrected appellation scope','The curator must explicitly confirm the change');
select is((public.narrow_drinking_window_region_group(
 'fa730000-0000-4000-8000-000000000003',current_setting('test.scope_group')::uuid,
 'fa730000-0000-4000-8000-000000000011',current_setting('test.scope_hash'),
 'This synthetic correction has a sufficiently clear explanation.',true)->>'rows_changed')::integer,
 1,'A curator can correct the group and all its rows atomically');
select is((select scope from public.drinking_window_ageing_groups where id=current_setting('test.scope_group')::uuid),
 'appellation','The group now uses appellation scope');
select ok(not exists(select 1 from public.drinking_window_eligibility_issues(
 'fa730000-0000-4000-8000-000000000003') where issue_code='membership_place_overlap'),
 'Correcting the scope removes only the false region overlap');
select is((select matched_scope from public.drinking_window_preview_draft_match(
 'fa730000-0000-4000-8000-000000000003',null,null,null,
 'fa730000-0000-4000-8000-000000000011','fa730000-0000-4000-8000-000000000010',
 'white',2022,null,750)), 'appellation',
 'An applicable appellation window takes priority over the regional fallback');
select is((select matched_scope from public.drinking_window_preview_draft_match(
 'fa730000-0000-4000-8000-000000000003',null,null,null,
 'fa730000-0000-4000-8000-000000000012','fa730000-0000-4000-8000-000000000010',
 'white',2022,null,750)), 'region',
 'A different appellation still receives the regional fallback');
select is((select appellation_id::text from public.drinking_window_reference_rows where id=current_setting('test.scope_row')::uuid),
 'fa730000-0000-4000-8000-000000000011','The existing row is attached to the appellation');
select is((select array[first_trial_year,best_start_year,best_end_year] from public.drinking_window_reference_rows
 where id=current_setting('test.scope_row')::uuid),array[2024,2026,2031],
 'The three dates and their row identity are preserved');
select isnt(private.drinking_window_review_subject_hash('fa730000-0000-4000-8000-000000000003',
 'row',current_setting('test.scope_row')::uuid),current_setting('test.row_hash'),
 'Changing row scope invalidates the earlier approval hash');
select isnt(private.drinking_window_review_subject_hash('fa730000-0000-4000-8000-000000000003',
 'group',current_setting('test.scope_group')::uuid),current_setting('test.scope_hash'),
 'Changing group scope invalidates the earlier group approval hash');
select is((select count(*) from private.drinking_window_fallback_corrections
 where subject_id in (current_setting('test.scope_group')::uuid,current_setting('test.scope_row')::uuid)),
 2::bigint,'Both changes have immutable before/after audit records');
select is((select status from public.drinking_window_reference_versions
 where id='fa730000-0000-4000-8000-000000000003'),'draft',
 'Correction neither publishes the draft nor modifies a cellar');
select * from finish();
rollback;
