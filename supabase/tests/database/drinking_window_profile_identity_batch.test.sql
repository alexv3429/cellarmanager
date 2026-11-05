begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

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
      "cuvees":[{"id":"synthetic_reserve","name":"Synthetic Reserve",
        "aliases":["Morgon Reserve"],
        "region":"Beaujolais","appellation":"Morgon","color":"red"}],
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
    where p.canonical_name='Synthetic Reserve'
      and p.producer_id=current_setting('app.identity_batch_producer')::uuid),2::bigint,
    'Both confirmed vintage releases now exist');
select is((select count(*) from public.drinking_window_reference_rows r
    join public.wine_reference_releases release on release.id=r.release_id
    join public.wine_reference_products product on product.id=release.product_id
    where product.canonical_name='Synthetic Reserve'),0::bigint,
    'Identity preparation does not stage or approve any drinking date');
select is((select count(*) from public.wines w
    join public.wine_reference_releases r on r.id=w.wine_reference_id
    join public.wine_reference_products p on p.id=r.product_id
    where p.canonical_name='Synthetic Reserve'),0::bigint,
    'Identity preparation does not link a household wine');
select is((select count(*) from private.drinking_window_profile_identity_batches
    where exchange_id=current_setting('app.identity_batch_profile')::uuid),1::bigint,
    'The curator decision is retained in an immutable audit record');
select is((select count(*) from private.drinking_window_reviewed_release_anchors a
    join private.drinking_window_profile_identity_batches b on b.id=a.batch_id
    where b.exchange_id=current_setting('app.identity_batch_profile')::uuid),3::bigint,
    'Confirmed releases produce separate 750 and 1500 ml identity anchors, not dates');
select ok('reserve' = any(private.drinking_window_profile_cuvee_name_keys(
    'Morgon Reserve','[]'::jsonb,'Morgon')),
    'A confirmed appellation prefix can be omitted from the cellar cuvée name');
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
    'Local Synthetic','Reserve',2022,'red','Morgon','Beaujolais',750);
select is((private.drinking_window_wine_context(
    'fd000000-0000-4000-8000-000000000003')->>'release_id')::uuid,
    (select r.id from public.wine_reference_releases r
     join public.wine_reference_products p on p.id=r.product_id
     where p.canonical_name='Synthetic Reserve' and r.vintage_year=2022),
    'An exact reviewed release resolves a local cuvée after the owner links its producer');
select is((select wine_reference_id from public.wines
    where id='fd000000-0000-4000-8000-000000000003'),null::uuid,
    'The read-time inference never rewrites the household wine');
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
