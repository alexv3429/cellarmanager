begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(has_function_privilege('postgres',
    'private.drinking_window_unique_reviewed_release(public.wines,uuid,uuid,uuid,text)',
    'EXECUTE')
    and has_table_privilege('postgres',
        'private.drinking_window_reviewed_release_anchors','SELECT')
    and not has_table_privilege('authenticated',
        'private.drinking_window_reviewed_release_anchors','SELECT'),
    'The internal wine reader can use anchors without exposing them to clients');

insert into auth.users (id,email,raw_user_meta_data) values
    ('fd000000-0000-4000-8000-000000000001','identity-reviewer@example.test','{}'::jsonb),
    ('fd000000-0000-4000-8000-000000000002','ordinary-user@example.test','{}'::jsonb);
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('fd000000-0000-4000-8000-000000000001', 'Synthetic identity reviewer',
    array['drinking-window'], 'Tests isolated profile identity preparation.', 'database-test');
set local request.jwt.claim.sub = 'fd000000-0000-4000-8000-000000000001';

select set_config('app.identity_batch_producer',
    (select id::text from public.wine_reference_producers
     where canonical_name='Jean-Marc Burgaud' limit 1),true);
select set_config('app.identity_batch_map',
    jsonb_build_object('producer_id',current_setting('app.identity_batch_producer'))::text,true);
select set_config('app.identity_batch_profile',
    (public.import_drinking_window_profile_exchange($profile$
    {
      "format":"cellarmanager.producer_research",
      "schema_version":"1.1.0","dataset_version":"1.0.0",
      "scope":"producer_independent_of_any_household",
      "status":"draft_for_curator_review",
      "producer":{"name":"Jean-Marc Burgaud"},
      "cuvees":[{"id":"synthetic_reserve","name":"Morgon Synthetic Reserve",
        "aliases":["Morgon Reserve"],
        "region":"Beaujolais","appellation":"Morgon","color":"red"},
        {"id":"lwin_cuvee","name":"Morgon Synthetic LWIN",
        "aliases":[],"region":"Beaujolais","appellation":"Morgon","color":"red"}],
      "sources":[{"id":"existence","url":"https://example.org/synthetic-release"},
        {"id":"large-format","url":"https://example.org/synthetic-magnum"}],
      "exact_release_calibrations":[
        {"cuvee_id":"synthetic_reserve","vintage":2022,"format_ml":750,
         "release_existence":{"source_ids":["existence"]},
         "proposal":{"first_trial_year":2025,"best_start_year":2028,"best_end_year":2036,
           "rationale":"An unapproved synthetic editorial estimate for batch identity testing only.",
           "supporting_source_ids":["existence"],
           "supporting_source_urls":["https://example.org/synthetic-release"]}},
        {"cuvee_id":"synthetic_reserve","vintage":2022,"format_ml":1500,
         "release_existence":{"source_ids":["large-format"]},
         "proposal":{"first_trial_year":2025,"best_start_year":2028,"best_end_year":2036,
           "rationale":"An unapproved synthetic larger-format estimate for identity review only.",
           "supporting_source_ids":["large-format"],
           "supporting_source_urls":["https://example.org/synthetic-magnum"]}},
        {"cuvee_id":"synthetic_reserve","vintage":2023,"format_ml":750,
         "release_existence":{"source_ids":["existence"]},
         "proposal":{"first_trial_year":2026,"best_start_year":2029,"best_end_year":2037,
           "rationale":"A second unapproved synthetic estimate, never published by identity creation.",
           "supporting_source_ids":["existence"],
           "supporting_source_urls":["https://example.org/synthetic-release"]}}
      ],
      "import_policy":{"review_required":true,"no_direct_production_publication":true}
    }
    $profile$::jsonb)->>'id'),true);

-- Reuse an unmaterialised LWIN product directly from the curator profile,
-- without creating a cellar match or granting ordinary users write access.
update public.wine_reference_lwin_snapshots set import_status='superseded'
where source_key='liv-ex-lwin' and import_status='active';
insert into public.wine_reference_lwin_snapshots
 (id,source_key,content_sha256,source_file_name,source_retrieved_at,source_updated_through,
  expected_record_count,record_count,live_record_count,combined_record_count,deleted_record_count,
  import_status,rows_retained,completed_at)
values ('fd000000-0000-4000-8000-000000000070','liv-ex-lwin',repeat('8',64),
 'synthetic-profile-lwin.xlsx','2026-11-01T00:00:00Z','2026-11-01T00:00:00',
 5,5,5,0,0,'active',true,'2026-11-01T00:01:00Z');
insert into public.wine_reference_lwin_entries
 (snapshot_id,lwin7,source_row_number,source_status,display_name,producer_name,wine_name,
  country,region,sub_region,colour,product_type,designation,vintage_configuration)
values
 ('fd000000-0000-4000-8000-000000000070','1999801',2,'live',
  'Jean-Marc Burgaud, Morgon Synthetic LWIN','Jean-Marc Burgaud','Morgon Synthetic LWIN',
  'France','Beaujolais','Morgon','Red','Wine','AOP','sequential'),
 ('fd000000-0000-4000-8000-000000000070','1999802',3,'live',
  'Another Producer, Morgon Synthetic LWIN','Another Producer','Morgon Synthetic LWIN',
  'France','Beaujolais','Morgon','Red','Wine','AOP','sequential'),
 ('fd000000-0000-4000-8000-000000000070','1999803',4,'live',
  'Jean-Marc Burgaud, Morgon Synthetic White','Jean-Marc Burgaud','Morgon Synthetic White',
  'France','Beaujolais','Morgon','White','Wine','AOP','sequential'),
 ('fd000000-0000-4000-8000-000000000070','1999804',5,'live',
  'Jean-Marc Burgaud, Morgon Another Cuvée','Jean-Marc Burgaud','Morgon Another Cuvée',
  'France','Beaujolais','Morgon','Red','Wine','AOP','sequential'),
 ('fd000000-0000-4000-8000-000000000070','1999805',6,'live',
  'Jean-Marc Burgaud, Other Place Synthetic LWIN','Jean-Marc Burgaud','Morgon Synthetic LWIN',
  'France','Beaujolais','Fleurie','Red','Wine','AOP','sequential');
select is(jsonb_array_length(public.search_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'Synthetic LWIN')),2,
 'LWIN search finds the reviewed producer and excludes a similarly named producer');
select ok(not private.drinking_window_lwin_profile_cuvee_matches(
 '{"name":"Different current cuvée","appellation":"Morgon","aliases":["Morgon Synthetic LWIN"],"name_history":[{"name":"Morgon Synthetic LWIN"}]}'::jsonb,
 (select e from public.wine_reference_lwin_entries e where e.lwin7='1999801' limit 1)),
 'Historical aliases are not silently applied across vintages');
select throws_ok($test$ select public.reuse_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'1999801',
 'Verified the synthetic identity against the test source.',false) $test$,
 '22023','Confirm the LWIN wine and explain the identity decision',
 'An LWIN identity requires an explicit curator confirmation');
select throws_ok($test$ select public.reuse_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'1999802',
 'Verified the synthetic identity against the test source.',true) $test$,
 '22023','LWIN producer does not match the reviewed shared producer',
 'Another producer cannot be attached to the profile');
select throws_ok($test$ select public.reuse_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'1999803',
 'Verified the synthetic identity against the test source.',true) $test$,
 '22023','LWIN color conflicts with the profile cuvée',
 'A conflicting LWIN color cannot be attached');
select throws_ok($test$ select public.reuse_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'1999804',
 'Verified the synthetic identity against the test source.',true) $test$,
 '22023','LWIN cuvée does not match the exact profile name or its reviewed aliases',
 'A different cuvée from the same producer cannot be attached');
select throws_ok($test$ select public.reuse_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'1999805',
 'Verified the synthetic identity against the test source.',true) $test$,
 '22023','LWIN appellation conflicts with the profile cuvée',
 'The same cuvée name in a different appellation cannot be attached');
insert into public.wine_reference_entities(id,entity_type)
values ('fd000000-0000-4000-8000-000000000071','product');
insert into public.wine_reference_products(id,producer_id,canonical_name)
values ('fd000000-0000-4000-8000-000000000071',current_setting('app.identity_batch_producer')::uuid,
 'Synthetic LWIN');
select throws_ok($test$ select public.reuse_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'1999801',
 'Verified the synthetic identity against the test source.',true) $test$,
 '23505','A matching shared cuvée already exists; reconcile it before importing LWIN',
 'An existing unlabelled shared product is not duplicated');
delete from public.wine_reference_products where id='fd000000-0000-4000-8000-000000000071';
delete from public.wine_reference_entities where id='fd000000-0000-4000-8000-000000000071';
select set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000002',true);
select throws_ok($test$ select public.search_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'Synthetic LWIN') $test$,
 '42501','An active curator grant for this profile type is required',
 'An ordinary user cannot search the curator-only profile LWIN path');
select throws_ok($test$ select public.reuse_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'1999801',
 'Verified the synthetic identity against the test source.',true) $test$,
 '42501','An active curator grant for this profile type is required',
 'An ordinary user cannot import a shared LWIN product');
select set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000001',true);
select is((public.reuse_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'1999801',
 'Verified the synthetic producer and cuvée against the test source.',true)->>'wines_linked')::integer,0,
 'A curator may reuse an LWIN product without changing a cellar wine');
select is((select count(*)::integer from public.wine_reference_external_identifiers
 where authority='liv-ex' and identifier_scheme='LWIN7' and identifier_value='1999801'),1,
 'The product retains its unique LWIN7 identity');
select is((select count(*)::integer from private.drinking_window_profile_lwin_reviews
 where lwin7='1999801'),1,'The LWIN reuse decision is auditable');
select is((public.reuse_drinking_window_profile_lwin(
 current_setting('app.identity_batch_profile')::uuid,'lwin_cuvee',
 current_setting('app.identity_batch_producer')::uuid,'1999801',
 'Verified the synthetic producer and cuvée against the test source.',true)->>'dates_staged')::integer,0,
 'Repeating the reuse neither stages dates nor duplicates the product');
select is((select count(*)::integer from public.wine_reference_external_identifiers
 where authority='liv-ex' and identifier_scheme='LWIN7' and identifier_value='1999801'),1,
 'Repeated reuse leaves exactly one LWIN product');

select is((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,
    current_setting('app.identity_batch_map')::jsonb,
    array['synthetic_reserve|2022','synthetic_reserve|2023'])->>'status'),
    'ready','The curator can preview two missing releases together');
select is((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,
    current_setting('app.identity_batch_map')::jsonb,
    array['synthetic_reserve|2022','synthetic_reserve|2023'])->'entries'->0->>'product_status'),
    'create','The missing cuvée is proposed for creation, not silently added');
select is((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,
    current_setting('app.identity_batch_map')::jsonb,
    array['synthetic_reserve|2022','synthetic_reserve|2023'])->'entries'->0->>'release_status'),
    'create','The missing exact vintage is separately proposed');
select is((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,
    current_setting('app.identity_batch_map')::jsonb,
    array['synthetic_reserve|2022','synthetic_reserve|2023'])->'entries'->0->'source_urls') ? 'https://example.org/synthetic-release',
    true,'The identity preview shows its cited existence pointer');
select is((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,
    current_setting('app.identity_batch_map')::jsonb,
    array['synthetic_reserve|2022','synthetic_reserve|2023'])->'entries'->0->'source_urls') ? 'https://example.org/synthetic-magnum',
    true,'The preview includes the second format’s distinct existence pointer');
select is((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,
    current_setting('app.identity_batch_map')::jsonb,
    array['synthetic_reserve|2024'])->'entries'->0->>'reason'),
    'Release key is absent from this profile','A missing vintage cannot be invented by a batch');
select set_config('app.identity_batch_hash',
    public.preview_drinking_window_profile_identity_batch(
      current_setting('app.identity_batch_profile')::uuid,
      current_setting('app.identity_batch_map')::jsonb,
      array['synthetic_reserve|2022','synthetic_reserve|2023'])->>'plan_sha256',true);

select set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000002',true);
select throws_ok($test$
    select public.preview_drinking_window_profile_identity_batch(
      current_setting('app.identity_batch_profile')::uuid,
      current_setting('app.identity_batch_map')::jsonb,
      array['synthetic_reserve|2022'])
$test$,'42501','An active curator grant for this profile type is required',
    'An ordinary user cannot preview a shared identity batch');
select throws_ok($test$
    select public.create_drinking_window_profile_identity_batch(
      current_setting('app.identity_batch_profile')::uuid,
      current_setting('app.identity_batch_map')::jsonb,
      array['synthetic_reserve|2022'],repeat('0',64),
      'I checked the synthetic wine identities and source pointer.',true)
$test$,'42501','An active curator grant for this profile type is required',
    'An ordinary user cannot create shared identities');
select set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000001',true);
select throws_ok($test$
    select public.create_drinking_window_profile_identity_batch(
      current_setting('app.identity_batch_profile')::uuid,
      current_setting('app.identity_batch_map')::jsonb,
      array['synthetic_reserve|2022','synthetic_reserve|2023'],repeat('0',64),
      'I checked these two synthetic releases and their exact identities.',true)
$test$,'40001','Identity plan changed; preview again',
    'A stale or substituted preview cannot create identities');
select throws_ok($test$
    select public.create_drinking_window_profile_identity_batch(
      current_setting('app.identity_batch_profile')::uuid,
      current_setting('app.identity_batch_map')::jsonb,
      array['synthetic_reserve|2022','synthetic_reserve|2023'],
      current_setting('app.identity_batch_hash'),
      'I checked these two synthetic releases and their exact identities.',false)
$test$,'22023','Confirm the reviewed wine identities and explain the decision',
    'Identity creation requires an explicit curator confirmation');
select is((public.create_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,
    current_setting('app.identity_batch_map')::jsonb,
    array['synthetic_reserve|2022','synthetic_reserve|2023'],
    current_setting('app.identity_batch_hash'),
    'I checked these two synthetic releases and their exact identities; no dates are approved.',true)
    ->>'created_products')::integer,1,
    'One shared cuvée identity is created for both selected vintages');
select is((select count(*) from public.wine_reference_releases r
    join public.wine_reference_products p on p.id=r.product_id
    where p.canonical_name='Morgon Synthetic Reserve'
      and p.producer_id=current_setting('app.identity_batch_producer')::uuid),2::bigint,
    'Both confirmed vintage releases now exist');
select is((select count(*) from public.drinking_window_reference_rows r
    join public.wine_reference_releases release on release.id=r.release_id
    join public.wine_reference_products product on product.id=release.product_id
    where product.canonical_name='Morgon Synthetic Reserve'),0::bigint,
    'Identity preparation does not stage or approve any drinking date');
select is((select count(*) from public.wines w
    join public.wine_reference_releases r on r.id=w.wine_reference_id
    join public.wine_reference_products p on p.id=r.product_id
    where p.canonical_name='Morgon Synthetic Reserve'),0::bigint,
    'Identity preparation does not link a household wine');
select is((select count(*) from private.drinking_window_profile_identity_batches
    where exchange_id=current_setting('app.identity_batch_profile')::uuid),1::bigint,
    'The curator decision is retained in an immutable audit record');
select is((select count(*) from private.drinking_window_reviewed_release_anchors a
    join private.drinking_window_profile_identity_batches b on b.id=a.batch_id
    where b.exchange_id=current_setting('app.identity_batch_profile')::uuid),3::bigint,
    'Confirmed releases produce separate 750 and 1500 ml identity anchors, not dates');
select ok('synthetic reserve' = any(private.drinking_window_profile_cuvee_name_keys(
    'Morgon Synthetic Reserve','Morgon')),
    'A confirmed appellation prefix can be omitted from the cellar cuvée name');
select ok(exists (select 1 from private.drinking_window_reviewed_release_anchors a
    join private.drinking_window_profile_identity_batches b on b.id=a.batch_id
    where b.exchange_id=current_setting('app.identity_batch_profile')::uuid
      and 'morgon reserve' = any(a.name_keys)),
    'An exact alias from the reviewed profile is available for its reviewed release');
select ok(not ('former name' = any(private.drinking_window_reviewed_cuvee_name_keys(
    '{"name":"Current name","appellation":"Morgon","aliases":["Former name"],"name_history":[{"name":"Former name"}]}'::jsonb))),
    'Aliases on a cuvée with name history remain excluded pending vintage-specific review');
select ok(not ('ab' = any(private.drinking_window_reviewed_cuvee_name_keys(
    '{"name":"Current name","aliases":["ab"]}'::jsonb))),
    'Very short aliases cannot identify a wine');
insert into public.households(id,name)
values ('00000000-0000-4000-8000-000000000100','Synthetic identity test')
on conflict (id) do nothing;
insert into public.wine_reference_household_producer_preferences (
    household_id,source_producer_normalized,source_producer_text,producer_id,decided_by)
values ('00000000-0000-4000-8000-000000000100',
    'local synthetic','Local Synthetic',
    current_setting('app.identity_batch_producer')::uuid,
    'fd000000-0000-4000-8000-000000000001');
insert into public.wines (
    id,household_id,producer,cuvee,vintage,color,appellation,area,format_ml)
values ('fd000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100',
    'Local Synthetic','Synthetic Reserve',2022,'red','Morgon','Beaujolais',750);
select is((private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id')::uuid,
    (select r.id from public.wine_reference_releases r
     join public.wine_reference_products p on p.id=r.product_id
     where p.canonical_name='Morgon Synthetic Reserve' and r.vintage_year=2022),
    'An exact reviewed release resolves a local cuvée after the owner links its producer');
select is((select wine_reference_id from public.wines
    where id='fd000000-0000-4000-8000-000000000003'),null::uuid,
    'The read-time inference never rewrites the household wine');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name)
select 'fd000000-0000-4000-8000-000000000012',id,'climat','Morgon Reserve'
from public.enrichment_places where place_type='appellation' and normalized_name='morgon';
update public.wines set appellation='Morgon 1C',vintage=2024
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_exact_classified_climat(
    'fd000000-0000-4000-8000-000000000003',
    (select id from public.enrichment_places where place_type='appellation' and normalized_name='morgon')),
    'fd000000-0000-4000-8000-000000000012'::uuid,
    'A reviewed producer profile relates two explicit cuvée names to the same climat across vintages');
select is(private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id',null::text,
    'Recognizing a climat never fabricates an unreviewed release for this vintage');
-- Synthetic test only: emulate a saved profile whose history requires review.
set local session_replication_role=replica;
update private.drinking_window_profile_exchanges
set document=jsonb_set(document,'{cuvees,0,name_history}','[{"name":"Earlier name"}]'::jsonb,true)
where id=current_setting('app.identity_batch_profile')::uuid;
set local session_replication_role=origin;
select is(private.drinking_window_exact_classified_climat(
    'fd000000-0000-4000-8000-000000000003',
    (select id from public.enrichment_places where place_type='appellation' and normalized_name='morgon')),
    null::uuid, 'A cuvée with name history cannot infer its climat across vintages');
set local session_replication_role=replica;
update private.drinking_window_profile_exchanges
set document=jsonb_set(document,'{cuvees,0,name_history}','[]'::jsonb,true)
where id=current_setting('app.identity_batch_profile')::uuid;
set local session_replication_role=origin;
insert into public.wine_reference_entities(id,entity_type) values
 ('fd000000-0000-4000-8000-000000000013','product'),
 ('fd000000-0000-4000-8000-000000000014','release');
insert into public.wine_reference_products(id,producer_id,canonical_name) values
 ('fd000000-0000-4000-8000-000000000013',current_setting('app.identity_batch_producer')::uuid,'Ambiguous synthetic cuvée');
insert into public.wine_reference_releases(id,product_id,vintage_year) values
 ('fd000000-0000-4000-8000-000000000014','fd000000-0000-4000-8000-000000000013',2022);
insert into private.drinking_window_reviewed_release_anchors
 (batch_id,release_id,producer_id,product_id,region_id,appellation_id,wine_color,vintage_year,format_ml,name_keys)
select batch_id,'fd000000-0000-4000-8000-000000000014',producer_id,
 'fd000000-0000-4000-8000-000000000013',region_id,appellation_id,wine_color,vintage_year,format_ml,name_keys
from private.drinking_window_reviewed_release_anchors a
where a.vintage_year=2022 and a.format_ml=750 and a.batch_id in
 (select id from private.drinking_window_profile_identity_batches where exchange_id=current_setting('app.identity_batch_profile')::uuid);
select is(private.drinking_window_exact_classified_climat(
    'fd000000-0000-4000-8000-000000000003',
    (select id from public.enrichment_places where place_type='appellation' and normalized_name='morgon')),
    null::uuid, 'Two products sharing the alias cannot silently select a climat');
delete from private.drinking_window_reviewed_release_anchors
where release_id='fd000000-0000-4000-8000-000000000014';
update public.wines set appellation='Morgon'
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_exact_classified_climat(
    'fd000000-0000-4000-8000-000000000003',
    (select id from public.enrichment_places where place_type='appellation' and normalized_name='morgon')),
    null::uuid, 'A profile alias cannot classify an unclassified village wine');
update public.wines set appellation='Morgon 1C',color='white'
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_exact_classified_climat(
    'fd000000-0000-4000-8000-000000000003',
    (select id from public.enrichment_places where place_type='appellation' and normalized_name='morgon')),
    null::uuid, 'A profile alias cannot cross wine colours');
update public.wines set color='red',producer='Other producer'
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_exact_classified_climat(
    'fd000000-0000-4000-8000-000000000003',
    (select id from public.enrichment_places where place_type='appellation' and normalized_name='morgon')),
    null::uuid, 'A profile alias cannot cross producers');
delete from public.enrichment_places where id='fd000000-0000-4000-8000-000000000012';
update public.wines set producer='Local Synthetic',appellation='Morgon',vintage=2022
where id='fd000000-0000-4000-8000-000000000003';
update public.wines set cuvee='Morgon Reserve'
where id='fd000000-0000-4000-8000-000000000003';
select is((private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id')::uuid,
    (select r.id from public.wine_reference_releases r
     join public.wine_reference_products p on p.id=r.product_id
     where p.canonical_name='Morgon Synthetic Reserve' and r.vintage_year=2022),
    'A reviewed profile alias identifies the same release without changing the local name');
update public.wines set cuvee='Synthetic Reserve'
where id='fd000000-0000-4000-8000-000000000003';
update private.drinking_window_reviewed_release_anchors a
set name_keys=array['morgon premier cru les synthetic reserve']
from public.wine_reference_releases r
where a.release_id=r.id and r.vintage_year=2022
  and a.batch_id in (select id from private.drinking_window_profile_identity_batches
    where exchange_id=current_setting('app.identity_batch_profile')::uuid);
update public.wines set appellation='Morgon 1C'
where id='fd000000-0000-4000-8000-000000000003';
select is((private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id')::uuid,
    (select r.id from public.wine_reference_releases r
     join public.wine_reference_products p on p.id=r.product_id
     where p.canonical_name='Morgon Synthetic Reserve' and r.vintage_year=2022),
    'A reviewed Premier Cru full name matches the short local name and 1C');
insert into public.wine_reference_entities(id,entity_type) values
 ('fd000000-0000-4000-8000-000000000010','product'),
 ('fd000000-0000-4000-8000-000000000011','release');
insert into public.wine_reference_products(id,producer_id,canonical_name) values
 ('fd000000-0000-4000-8000-000000000010',current_setting('app.identity_batch_producer')::uuid,
  'Second synthetic Premier Cru');
insert into public.wine_reference_releases(id,product_id,vintage_year) values
 ('fd000000-0000-4000-8000-000000000011','fd000000-0000-4000-8000-000000000010',2022);
insert into private.drinking_window_reviewed_release_anchors
 (batch_id,release_id,producer_id,product_id,region_id,appellation_id,wine_color,vintage_year,format_ml,name_keys)
select batch_id,'fd000000-0000-4000-8000-000000000011',producer_id,
 'fd000000-0000-4000-8000-000000000010',region_id,appellation_id,wine_color,vintage_year,format_ml,name_keys
from private.drinking_window_reviewed_release_anchors a
where a.vintage_year=2022 and a.format_ml=750
  and a.batch_id in (select id from private.drinking_window_profile_identity_batches
    where exchange_id=current_setting('app.identity_batch_profile')::uuid);
select is(private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id',null::text,
    'Two reviewed releases with the same shortened name remain ambiguous');
delete from private.drinking_window_reviewed_release_anchors
where release_id='fd000000-0000-4000-8000-000000000011';
update public.wines set format_ml=500
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id',null::text,
    'A classified short-name match still requires the reviewed bottle format');
update public.wines set format_ml=750
where id='fd000000-0000-4000-8000-000000000003';
update public.wines set appellation='Morgon'
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id',null::text,
    'A short name alone cannot turn a village wine into a Premier Cru');
update private.drinking_window_reviewed_release_anchors a
set name_keys=array['morgon synthetic reserve','synthetic reserve']
from public.wine_reference_releases r
where a.release_id=r.id and r.vintage_year=2022
  and a.batch_id in (select id from private.drinking_window_profile_identity_batches
    where exchange_id=current_setting('app.identity_batch_profile')::uuid);
update public.wines set vintage=2024
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id',null::text,
    'An unreviewed vintage is never inferred from a neighbouring year');
update public.wines set vintage=2022, appellation='Beaujolais-Villages'
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id',null::text,
    'A matching name under the wrong appellation does not gain the reviewed release');
update public.wines set appellation='Morgon', color='white'
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id',null::text,
    'A different colour does not gain the reviewed release');
update public.wines set color='red', format_ml=500
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id',null::text,
    'A different bottle size does not gain a 750 ml identity');
select is((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,
    current_setting('app.identity_batch_map')::jsonb,
    array['synthetic_reserve|2022','synthetic_reserve|2023'])->'entries'->0->>'release_status'),
    'existing','A fresh preview recognizes the newly created release');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name)
select 'fd000000-0000-4000-8000-000000000004',id,'appellation','Synthetic Alternative Appellation'
from public.enrichment_places where place_type='region' and normalized_name='beaujolais';
insert into public.enrichment_places(id,place_type,canonical_name) values
 ('fd000000-0000-4000-8000-000000000005','region','Synthetic Other Region');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name) values
 ('fd000000-0000-4000-8000-000000000006','fd000000-0000-4000-8000-000000000005',
  'appellation','Synthetic Other Appellation');
select set_config('app.vintage_identity_map',
 (current_setting('app.identity_batch_map')::jsonb || jsonb_build_object('release_appellations',
   jsonb_build_object('synthetic_reserve|2022','fd000000-0000-4000-8000-000000000004')))::text,true);
select is((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,current_setting('app.vintage_identity_map')::jsonb,
    array['synthetic_reserve|2022'])->'entries'->0->>'appellation_id'),
    'fd000000-0000-4000-8000-000000000004','Identity preview uses the selected appellation for this vintage');
select isnt((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,current_setting('app.vintage_identity_map')::jsonb,
    array['synthetic_reserve|2023'])->'entries'->0->>'appellation_id'),
    'fd000000-0000-4000-8000-000000000004','The vintage choice does not affect another year');
insert into public.drinking_window_reference_versions(id,version_number) values
 ('fd000000-0000-4000-8000-000000000007',998762);
select is((select row->>'appellation_id' from jsonb_array_elements(
    public.preview_drinking_window_profile_exchange(current_setting('app.identity_batch_profile')::uuid,
    'fd000000-0000-4000-8000-000000000007',current_setting('app.vintage_identity_map')::jsonb)->'rows') row
    where row->>'vintage'='2022' limit 1),
    'fd000000-0000-4000-8000-000000000004','Window staging preview preserves the same vintage-specific choice');
select is((public.preview_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,
    current_setting('app.identity_batch_map')::jsonb || jsonb_build_object('release_appellations',
      jsonb_build_object('synthetic_reserve|2022','fd000000-0000-4000-8000-000000000006')),
    array['synthetic_reserve|2022'])->'entries'->0->>'reason'),
    'Appellation has no unique canonical identity in this region','A vintage choice outside the region is rejected');
select public.create_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,current_setting('app.vintage_identity_map')::jsonb,
    array['synthetic_reserve|2022'],public.preview_drinking_window_profile_identity_batch(
      current_setting('app.identity_batch_profile')::uuid,current_setting('app.vintage_identity_map')::jsonb,
      array['synthetic_reserve|2022'])->>'plan_sha256',
    'Synthetic test of a conflicting vintage appellation; no date is approved.',true);
select is(public.get_reviewed_profile_release_appellations(
    current_setting('app.identity_batch_profile')::uuid)->>'synthetic_reserve|2022',
    'fd000000-0000-4000-8000-000000000004',
    'A confirmed vintage-specific appellation is available when the profile is reopened');
select set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000002',true);
select throws_ok($test$
    select public.get_reviewed_profile_release_appellations(
      current_setting('app.identity_batch_profile')::uuid)
$test$,'42501','An active curator grant for this profile type is required',
    'An ordinary user cannot read curator identity decisions');
select set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000001',true);
update public.wines set color='red',format_ml=750,appellation='Morgon'
where id='fd000000-0000-4000-8000-000000000003';
select is(private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id',null::text,
    'Conflicting reviewed appellations cannot silently identify the same release');
select public.create_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,current_setting('app.identity_batch_map')::jsonb,
    array['synthetic_reserve|2022'],public.preview_drinking_window_profile_identity_batch(
      current_setting('app.identity_batch_profile')::uuid,current_setting('app.identity_batch_map')::jsonb,
      array['synthetic_reserve|2022'])->>'plan_sha256',
    'Synthetic test returning this vintage to the profile-wide appellation.',true);
select is(public.get_reviewed_profile_release_appellations(
    current_setting('app.identity_batch_profile')::uuid)->>'synthetic_reserve|2022',null::text,
    'A later confirmed batch can clear a vintage-specific choice, even in one transaction');
select set_config('app.reviewed_profile_map',jsonb_build_object(
    'producer_id',current_setting('app.identity_batch_producer'),
    'cuvees',jsonb_build_object('synthetic_reserve',(select id from public.wine_reference_products
        where canonical_name='Morgon Synthetic Reserve'
          and producer_id=current_setting('app.identity_batch_producer')::uuid)),
    'regions',jsonb_build_object('Beaujolais',(select id from public.enrichment_places
        where normalized_name='beaujolais' and place_type='region')),
    'release_appellations',jsonb_build_object('synthetic_reserve|2022',
        'fd000000-0000-4000-8000-000000000004'))::text,true);
select public.create_drinking_window_profile_identity_batch(
    current_setting('app.identity_batch_profile')::uuid,current_setting('app.reviewed_profile_map')::jsonb,
    array['synthetic_reserve|2023'],public.preview_drinking_window_profile_identity_batch(
      current_setting('app.identity_batch_profile')::uuid,current_setting('app.reviewed_profile_map')::jsonb,
      array['synthetic_reserve|2023'])->>'plan_sha256',
    'Synthetic test of profile mappings used by a confirmed vintage.',true);
select is(public.get_reviewed_profile_identity_mappings(
    current_setting('app.identity_batch_profile')::uuid)#>>'{regions,Beaujolais}',
    (select id::text from public.enrichment_places where normalized_name='beaujolais' and place_type='region'),
    'A confirmed profile region mapping is restored when reopening the profile');
select is(public.get_reviewed_profile_identity_mappings(
    current_setting('app.identity_batch_profile')::uuid)#>>'{cuvees,synthetic_reserve}',
    (select id::text from public.wine_reference_products where canonical_name='Morgon Synthetic Reserve'
        and producer_id=current_setting('app.identity_batch_producer')::uuid),
    'A confirmed cuvée mapping is restored when reopening the profile');
select is(public.get_reviewed_profile_identity_mappings(
    current_setting('app.identity_batch_profile')::uuid)#>>'{release_appellations,synthetic_reserve|2022}',
    null::text,'A mapping for an unselected vintage is not treated as a confirmed decision');
select set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000002',true);
select throws_ok($test$
    select public.get_reviewed_profile_identity_mappings(
      current_setting('app.identity_batch_profile')::uuid)
$test$,'42501','An active curator grant for this profile type is required',
    'An ordinary user cannot read reviewed producer-profile mappings');
select set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000001',true);
select throws_ok($test$
    select public.create_drinking_window_profile_identity_batch(
      current_setting('app.identity_batch_profile')::uuid,
      current_setting('app.identity_batch_map')::jsonb,
      array['synthetic_reserve|2022','synthetic_reserve|2023'],
      current_setting('app.identity_batch_hash'),
      'I checked these two synthetic releases and their exact identities.',true)
$test$,'40001','Identity plan changed; preview again',
    'Repeating the old identity plan is rejected rather than duplicating releases');

select * from finish();
rollback;
