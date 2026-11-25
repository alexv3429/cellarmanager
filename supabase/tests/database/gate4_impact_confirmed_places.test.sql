begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id,email) values
 ('fc910000-0000-4000-8000-000000000001','place-impact-curator@example.test');
insert into public.enrichment_curator_eligibilities
 (user_id,display_name,profile_scopes,rationale,granted_by)
values ('fc910000-0000-4000-8000-000000000001','Synthetic curator',
 array['drinking-window'],'Synthetic test.','database-test');
insert into public.households(id,name) values
 ('fc910000-0000-4000-8000-000000000002','Linked places'),
 ('fc910000-0000-4000-8000-000000000003','Unlinked places');
insert into public.enrichment_places(id,place_type,canonical_name) values
 ('fc910000-0000-4000-8000-000000000004','region','Synthetic Shared Region');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fc910000-0000-4000-8000-000000000005','fc910000-0000-4000-8000-000000000004',
  'appellation','Synthetic Shared Appellation');
insert into private.household_region_identity_links(household_id,source_area,region_id,decided_by)
values ('fc910000-0000-4000-8000-000000000002','local region',
 'fc910000-0000-4000-8000-000000000004','fc910000-0000-4000-8000-000000000001');
insert into private.household_appellation_identity_links
 (household_id,source_area,source_appellation,appellation_id,decided_by)
values ('fc910000-0000-4000-8000-000000000002','local region','local appellation',
 'fc910000-0000-4000-8000-000000000005','fc910000-0000-4000-8000-000000000001');
insert into public.wines(id,household_id,producer,cuvee,vintage,color,area,appellation) values
 ('fc910000-0000-4000-8000-000000000006','fc910000-0000-4000-8000-000000000002',
  'Unlinked Producer','Synthetic wine',2022,'white','Local Region','Local Appellation'),
 ('fc910000-0000-4000-8000-000000000007','fc910000-0000-4000-8000-000000000003',
  'Unlinked Producer','Synthetic wine',2022,'white','Local Region','Local Appellation');
insert into public.wine_reference_entities(id,entity_type) values
 ('fc910000-0000-4000-8000-000000000013','producer'),
 ('fc910000-0000-4000-8000-000000000014','product'),
 ('fc910000-0000-4000-8000-000000000015','release');
insert into public.wine_reference_producers(id,canonical_name)
values ('fc910000-0000-4000-8000-000000000013','Synthetic different producer');
insert into public.wine_reference_products(id,producer_id,canonical_name)
values ('fc910000-0000-4000-8000-000000000014','fc910000-0000-4000-8000-000000000013','Different wine');
insert into public.wine_reference_releases(id,product_id,vintage_year)
values ('fc910000-0000-4000-8000-000000000015','fc910000-0000-4000-8000-000000000014',2021);
insert into public.wines
 (id,household_id,producer,cuvee,vintage,color,area,appellation,wine_reference_type,wine_reference_id)
values ('fc910000-0000-4000-8000-000000000016','fc910000-0000-4000-8000-000000000002',
 'Unlinked Producer','Mismatched vintage',2022,'white','Local Region','Local Appellation',
 'release','fc910000-0000-4000-8000-000000000015');
insert into public.drinking_window_reference_versions(id,version_number) values
 ('fc910000-0000-4000-8000-000000000008',998776);
insert into public.drinking_window_reference_rows
 (id,version_id,scope,region_id,appellation_id,wine_color,vintage_year,
  all_at_scope,first_trial_year,best_start_year,best_end_year,rationale)
values ('fc910000-0000-4000-8000-000000000009','fc910000-0000-4000-8000-000000000008',
 'appellation','fc910000-0000-4000-8000-000000000004','fc910000-0000-4000-8000-000000000005',
 'white',2022,true,2024,2026,2032,'Synthetic shared appellation estimate.');
insert into public.enrichment_sources(id,source_key,source_name,source_kind)
values ('fc910000-0000-4000-8000-000000000010','synthetic-place-impact',
 'Synthetic place impact source','cellarmanager');
insert into public.enrichment_source_policies
 (id,source_id,policy_version,effective_from,status,terms_checked_on,evidence_url,
  display_right,normalized_storage_right,raw_payload_storage_right,offline_sync_right,
  retention_right,cross_household_reuse_right)
values ('fc910000-0000-4000-8000-000000000011','fc910000-0000-4000-8000-000000000010',
 1,current_date,'reviewed',current_date,'https://example.test/place-policy',
 'allowed','allowed','prohibited','prohibited','allowed','allowed');
insert into public.enrichment_evidence
 (id,source_id,source_policy_id,source_record_url,content_mode,claim_type,scope_level,
  place_id,vintage_year,wine_color,review_status,reviewed_at)
values ('fc910000-0000-4000-8000-000000000012','fc910000-0000-4000-8000-000000000010',
 'fc910000-0000-4000-8000-000000000011','https://example.test/place-window','pointer-only',
 'maturity-window','vintage','fc910000-0000-4000-8000-000000000005',2022,'white','reviewed',now());
insert into public.drinking_window_reference_evidence(version_id,reference_row_id,evidence_id,claim_part)
values
 ('fc910000-0000-4000-8000-000000000008','fc910000-0000-4000-8000-000000000009',
  'fc910000-0000-4000-8000-000000000012','first_trial'),
 ('fc910000-0000-4000-8000-000000000008','fc910000-0000-4000-8000-000000000009',
  'fc910000-0000-4000-8000-000000000012','optimal_period');
select set_config('request.jwt.claim.sub','fc910000-0000-4000-8000-000000000001',true);
select public.record_drinking_window_reference_review(
 'fc910000-0000-4000-8000-000000000008','row','fc910000-0000-4000-8000-000000000009',
 private.drinking_window_review_subject_hash('fc910000-0000-4000-8000-000000000008',
   'row','fc910000-0000-4000-8000-000000000009'),'approve','Synthetic reviewed place estimate.');
select is((select count(*) from public.drinking_window_publication_issues(
 'fc910000-0000-4000-8000-000000000008')),0::bigint,'The synthetic draft is ready for preview');
select is(private.drinking_window_wine_context('fc910000-0000-4000-8000-000000000006')->>'status',
 'wine_reference_unlinked','A confirmed local place can exist without a producer link');
select is(private.drinking_window_wine_context('fc910000-0000-4000-8000-000000000007')->>'status',
 'region_not_confirmed','The same spelling in another household is not automatically linked');
select is(private.drinking_window_wine_context('fc910000-0000-4000-8000-000000000016')->>'status',
 'wine_reference_unlinked','A release from a different vintage cannot resolve the wine');
select set_config('app.test_original',public.preview_drinking_window_publication_impact(
 'fc910000-0000-4000-8000-000000000008')::text,true);
select is((current_setting('app.test_original')::jsonb->>'matched_count')::integer,1,
 'The preview counts the locally mapped wine but excludes the conflicting vintage reference');
select set_config('app.test_job',public.start_drinking_window_impact_preview(
 'fc910000-0000-4000-8000-000000000008')::text,true);
do $$ declare j jsonb; begin
  loop
    j:=public.continue_drinking_window_impact_preview(current_setting('app.test_job')::uuid);
    exit when (j->>'completed')::boolean;
  end loop;
  perform set_config('app.test_batched',j::text,true);
end $$;
select is(current_setting('app.test_batched')::jsonb-'completed',
 current_setting('app.test_original')::jsonb,'Batched and single-call previews agree');
select * from finish();
rollback;
