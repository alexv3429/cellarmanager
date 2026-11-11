begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('00000000-0000-4000-8000-000000000001', 'Synthetic profile reviewer',
    array['drinking-window'], 'Tests the complete profile exchange on a disposable database.',
    'database-test');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select set_config('app.gate3_version', (select id::text from
    public.drinking_window_reference_versions where status='draft' order by version_number desc limit 1), true);
select set_config('app.gate3_producer', (select id::text from
    public.wine_reference_producers where canonical_name='Jean-Marc Burgaud'), true);
select set_config('app.gate3_product', (select p.id::text from public.wine_reference_products p
    join public.wine_reference_releases r on r.product_id=p.id
    where r.id='0ea70dd0-a315-4fff-f438-c9b3ed5fe573'), true);
select set_config('app.gate3_map', jsonb_build_object(
    'producer_id',current_setting('app.gate3_producer'),
    'cuvees',jsonb_build_object('james',current_setting('app.gate3_product')))::text, true);

select set_config('app.gate3_document', $$
{
  "format":"cellarmanager.producer_research",
  "schema_version":"1.1.0",
  "dataset_version":"1.0.0",
  "scope":"producer_independent_of_any_household",
  "status":"draft_for_curator_review",
  "producer":{"name":"Domaine Jean-Marc Burgaud"},
  "cuvees":[{"id":"james","name":"James","appellation":"Morgon","region":"Beaujolais","color":"red"}],
  "sources":[{"id":"context","url":"https://example.org/james-context"}],
  "exact_release_calibrations":[
    {"cuvee_id":"james","vintage":2022,"format_ml":750,
     "proposal":{"first_trial_year":2025,"best_start_year":2028,"best_end_year":2035,
       "rationale":"A reviewed editorial estimate for the synthetic 750 ml James release, not producer dates.",
       "supporting_source_ids":["context"],
       "supporting_source_urls":["https://example.org/james-context"]}},
    {"cuvee_id":"james","vintage":2022,"format_ml":1500,
     "proposal":{"first_trial_year":2026,"best_start_year":2029,"best_end_year":2038,
       "rationale":"A reviewed editorial estimate for the synthetic 1500 ml James release, not producer dates.",
       "supporting_source_ids":["context"],
       "supporting_source_urls":["https://example.org/james-context"]}},
    {"cuvee_id":"james","vintage":2023,"format_ml":750,
     "proposal":{"first_trial_year":2026,"best_start_year":2029,"best_end_year":2036,
       "rationale":"A deliberately unresolved vintage is quarantined for explicit canonical review.",
       "supporting_source_ids":["context"],
       "supporting_source_urls":["https://example.org/james-context"]}}
  ],
  "import_policy":{"review_required":true,"no_direct_production_publication":true}
}
$$, true);

select set_config('app.gate3_import',
    (public.import_drinking_window_profile_exchange(current_setting('app.gate3_document')::jsonb)->>'id'),true);
select is((public.import_drinking_window_profile_exchange(
    current_setting('app.gate3_document')::jsonb)->>'inserted')::boolean,false,
    'Identical full document re-import is idempotent');
select throws_ok($test$
    select public.import_drinking_window_profile_exchange(
      '{"format":"cellarmanager.producer_research","schema_version":"1.1.0"}'::jsonb)
$test$, '22023', 'Unsafe or incomplete producer exchange',
    'A direct RPC call cannot store an incomplete producer profile');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select throws_ok($test$
    select public.import_drinking_window_profile_exchange(
      current_setting('app.gate3_document')::jsonb)
$test$, '42501', 'An active curator grant for this profile type is required',
    'A non-curator cannot import a full profile');
select throws_ok($test$
    select public.export_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid)
$test$, '42501', 'An active curator grant for this profile type is required',
    'A non-curator cannot export a saved profile');
select throws_ok($test$
    select public.stage_selected_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
      repeat('0',64), 'A sufficiently long synthetic reason for this access-control test.',
      true,current_setting('app.gate3_map')::jsonb,array['james · 2022 · 750 ml'])
$test$, '42501', 'An active curator grant for this profile type is required',
    'A non-curator cannot stage selected windows');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select is((select count(*) from private.drinking_window_profile_exchanges
    where id=current_setting('app.gate3_import')::uuid),1::bigint,
    'Complete profile is retained once');
select is((select count(*) from jsonb_array_elements(
    public.preview_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
      current_setting('app.gate3_map')::jsonb)->'rows') row_item
    where row_item.value->>'status'='ready'),2::bigint,
    'Two format-specific releases map to the explicitly selected canonical cuvée');
select is((select count(*) from jsonb_array_elements(
    public.preview_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
      current_setting('app.gate3_map')::jsonb)->'rows') row_item
    where row_item.value->>'status'='quarantined'),1::bigint,
    'The missing vintage is reported as quarantined');
select set_config('app.gate4_place_wording',
    (public.import_drinking_window_profile_exchange(jsonb_set(jsonb_set(
      current_setting('app.gate3_document')::jsonb,
      '{cuvees,0,region}',to_jsonb('Beaujolais — northern sector'::text)),
      '{cuvees,0,appellation}',to_jsonb('Morgon AOC'::text)))->>'id'),true);
select is((public.preview_drinking_window_profile_exchange(
    current_setting('app.gate4_place_wording')::uuid,
    current_setting('app.gate3_version')::uuid,
    current_setting('app.gate3_map')::jsonb)->'rows'->0->>'reason'),
    'Region has no unique canonical identity',
    'A profile region phrase is not silently collapsed to a canonical region');
select set_config('app.gate4_region_map',
    (current_setting('app.gate3_map')::jsonb || jsonb_build_object('regions',
      jsonb_build_object('Beaujolais — northern sector',
        (select id from public.enrichment_places where canonical_name='Beaujolais'))))::text,true);
select is((public.preview_drinking_window_profile_exchange(
    current_setting('app.gate4_place_wording')::uuid,
    current_setting('app.gate3_version')::uuid,
    current_setting('app.gate4_region_map')::jsonb)->'rows'->0->>'reason'),
    'Appellation has no unique canonical identity in this region',
    'A reviewed region selection does not bypass the appellation check');
select set_config('app.gate4_place_map',
    (current_setting('app.gate4_region_map')::jsonb || jsonb_build_object('appellations',
      jsonb_build_object('Morgon AOC',
        (select id from public.enrichment_places where canonical_name='Morgon'))))::text,true);
select is((select count(*) from jsonb_array_elements(
    public.preview_drinking_window_profile_exchange(
      current_setting('app.gate4_place_wording')::uuid,
      current_setting('app.gate3_version')::uuid,
      current_setting('app.gate4_place_map')::jsonb)->'rows') row_item
    where row_item.value->>'status'='ready'),2::bigint,
    'Explicit curator place mappings make only the two existing exact releases ready');
select is((public.preview_drinking_window_profile_exchange(
    current_setting('app.gate4_place_wording')::uuid,
    current_setting('app.gate3_version')::uuid,
    current_setting('app.gate4_place_map')::jsonb)->'rows'->2->>'reason'),
    'Release has no unique canonical identity',
    'Place mapping does not invent a missing canonical vintage');
select is((public.preview_drinking_window_profile_exchange(
    current_setting('app.gate4_place_wording')::uuid,
    current_setting('app.gate3_version')::uuid,
    (current_setting('app.gate4_place_map')::jsonb || jsonb_build_object('regions',
      jsonb_build_object('Beaujolais — northern sector',
        '00000000-0000-4000-8000-000000000999')))::jsonb)->'rows'->0->>'reason'),
    'Region has no unique canonical identity',
    'An unknown place ID cannot authorize a profile row');
select set_config('app.gate3_wrong_source',
    (public.import_drinking_window_profile_exchange(jsonb_set(
      current_setting('app.gate3_document')::jsonb,
      '{exact_release_calibrations,0,proposal,supporting_source_urls,0}',
      to_jsonb('https://example.org/unlisted-page'::text)
    ))->>'id'),true);
select is((public.preview_drinking_window_profile_exchange(
    current_setting('app.gate3_wrong_source')::uuid,
    current_setting('app.gate3_version')::uuid,
    current_setting('app.gate3_map')::jsonb)->'rows'->0->>'status'),
    'quarantined', 'A direct RPC cannot stage a context URL absent from the cited sources');
select set_config('app.gate3_preview_hash',
    public.preview_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
      current_setting('app.gate3_map')::jsonb)->>'preview_sha256',true);
select throws_ok($test$
    select public.stage_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid,
      current_setting('app.gate3_version')::uuid,
      repeat('0',64),
      'I checked this synthetic profile and approve the reviewed dates for sharing.',
      true,current_setting('app.gate3_map')::jsonb)
$test$, '40001', 'Profile mapping or draft changed; refresh the preview',
    'A stale or substituted preview cannot be staged');
select throws_ok($test$
    select public.stage_selected_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
      current_setting('app.gate3_preview_hash'),
      'I reviewed the selected synthetic window and approve sharing it as an editorial estimate.',
      true,current_setting('app.gate3_map')::jsonb,array['james · 2023 · 750 ml'])
$test$, '22023', 'Selected rows must each be uniquely ready',
    'An unresolved window cannot be selected for staging');
select throws_ok($test$
    select public.stage_selected_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
      current_setting('app.gate3_preview_hash'),
      'I reviewed the selected synthetic window and approve sharing it as an editorial estimate.',
      true,current_setting('app.gate3_map')::jsonb,array['james · 2022 · 750 ml','james · 2022 · 750 ml'])
$test$, '22023', 'Choose distinct rows to review', 'Duplicate selections are rejected');
select throws_ok($test$
    select public.stage_selected_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
      repeat('0',64),
      'I reviewed the selected synthetic window and approve sharing it as an editorial estimate.',
      true,current_setting('app.gate3_map')::jsonb,array['james · 2022 · 750 ml'])
$test$, '40001', 'Profile mapping or draft changed; refresh the preview',
    'Selected staging also rejects a stale preview');
select is((public.stage_selected_drinking_window_profile_exchange(
    current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.gate3_preview_hash'),
    'I reviewed the selected synthetic window and approve sharing it as an editorial estimate.',
    true,current_setting('app.gate3_map')::jsonb,array['james · 2022 · 750 ml'])->>'staged')::integer,1,
    'Only the selected ready window is staged');
select is((select count(*) from public.drinking_window_reference_rows
    where version_id=current_setting('app.gate3_version')::uuid
      and release_id='0ea70dd0-a315-4fff-f438-c9b3ed5fe573'),1::bigint,
    'Another ready window remains untouched');
select set_config('app.gate3_preview_hash',
    public.preview_drinking_window_profile_exchange(
      current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
      current_setting('app.gate3_map')::jsonb)->>'preview_sha256',true);
select is((public.stage_drinking_window_profile_exchange(
    current_setting('app.gate3_import')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.gate3_preview_hash'),
    'I checked the two size-specific synthetic windows and approve sharing them as editorial estimates.',
    true,current_setting('app.gate3_map')::jsonb)->>'staged')::integer,1,
    'The remaining valid row can be staged independently');
select is((select count(*) from public.drinking_window_reference_rows
    where version_id=current_setting('app.gate3_version')::uuid
      and release_id='0ea70dd0-a315-4fff-f438-c9b3ed5fe573'),2::bigint,
    'Both bottle sizes coexist in one reference version');
select is((select first_trial_year from public.drinking_window_preview_draft_match(
    current_setting('app.gate3_version')::uuid,current_setting('app.gate3_producer')::uuid,
    current_setting('app.gate3_product')::uuid,
    '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
    (select id from public.enrichment_places where canonical_name='Morgon'),
    (select id from public.enrichment_places where canonical_name='Beaujolais'),
    'red',2022,null,1500)),2026,
    'The 1500 ml match chooses its own estimate rather than the 750 ml row');
select is((select first_trial_year from public.drinking_window_preview_draft_match(
    current_setting('app.gate3_version')::uuid,current_setting('app.gate3_producer')::uuid,
    current_setting('app.gate3_product')::uuid,
    '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
    (select id from public.enrichment_places where canonical_name='Morgon'),
    (select id from public.enrichment_places where canonical_name='Beaujolais'),
    'red',2022,null,750)),2025,
    'The 750 ml match remains separate');
insert into public.drinking_window_reference_rows (
    version_id,scope,producer_id,product_id,release_id,appellation_id,region_id,
    wine_color,vintage_year,format_ml,all_at_scope,
    first_trial_year,best_start_year,best_end_year,rationale
) values (
    current_setting('app.gate3_version')::uuid,'release',
    current_setting('app.gate3_producer')::uuid,current_setting('app.gate3_product')::uuid,
    '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
    (select id from public.enrichment_places where canonical_name='Morgon'),
    (select id from public.enrichment_places where canonical_name='Beaujolais'),
    'red',2022,null,true,2027,2031,2040,
    'Synthetic size-neutral comparison row for matcher precedence tests.'
);
select is((select first_trial_year from public.drinking_window_preview_draft_match(
    current_setting('app.gate3_version')::uuid,current_setting('app.gate3_producer')::uuid,
    current_setting('app.gate3_product')::uuid,
    '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
    (select id from public.enrichment_places where canonical_name='Morgon'),
    (select id from public.enrichment_places where canonical_name='Beaujolais'),
    'red',2022,null,750)),2025,
    'Exact size wins over a size-neutral row at the same scope');
select is((select first_trial_year from public.drinking_window_preview_draft_match(
    current_setting('app.gate3_version')::uuid,current_setting('app.gate3_producer')::uuid,
    current_setting('app.gate3_product')::uuid,
    '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
    (select id from public.enrichment_places where canonical_name='Morgon'),
    (select id from public.enrichment_places where canonical_name='Beaujolais'),
    'red',2022,null,500)),2027,
    'A different size can use the explicitly size-neutral row');

select set_config('app.gate3_place', $$
{
  "format":"cellarmanager.place_profile","schema_version":"1.0.0",
  "dataset_version":"1.0.0","status":"draft_for_curator_review",
  "profile_kind":"region",
  "place":{"name":"Beaujolais","country_code":"FR","source_ids":["context"]},
  "sources":[{"id":"context","url":"https://example.org/beaujolais-context"}],
  "facts":[{"kind":"grapes","text":"Synthetic sourced regional fact.","source_ids":["context"]}],
  "ageing_groups":[{
    "id":"synthetic_young_red","name":"Synthetic younger reds","color":"red",
    "definition":"A synthetic regional category with explicitly reviewed Morgon membership only.",
    "source_ids":["context"],
    "members":[{"kind":"place","name":"Morgon",
      "rationale":"Morgon is explicitly included in this synthetic test category for testing.",
      "source_ids":["context"]}],
    "windows":[{"vintage":2022,"first_trial_year":2024,
      "best_start_year":2026,"best_end_year":2030,
      "rationale":"A synthetic regional editorial window, deliberately distinct from the exact James release.",
      "source_ids":["context"]}]
  }]
}
$$,true);
select set_config('app.gate3_place_import',
    (public.import_drinking_window_profile_exchange(current_setting('app.gate3_place')::jsonb)->>'id'),true);
select is((public.preview_drinking_window_place_profile_exchange(
    current_setting('app.gate3_place_import')::uuid,current_setting('app.gate3_version')::uuid)
    ->'groups'->0->>'status'),'ready',
    'An exact region and explicit membership are previewed as a ready group');
select set_config('app.gate3_place_hash',
    public.preview_drinking_window_place_profile_exchange(
      current_setting('app.gate3_place_import')::uuid,current_setting('app.gate3_version')::uuid)
      ->>'preview_sha256',true);
select is((public.stage_drinking_window_place_profile_exchange(
    current_setting('app.gate3_place_import')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.gate3_place_hash'),
    'I verified the synthetic regional group, its explicit membership and one three-date editorial window.',true)
    ->>'staged_windows')::integer,1,
    'One curator stages a complete region group and its window');
select is((select count(*) from private.drinking_window_profile_group_links
    where exchange_id=current_setting('app.gate3_place_import')::uuid),1::bigint,
    'The full place profile stays linked to its reviewed reference group');
select is((public.preview_drinking_window_place_profile_exchange(
    current_setting('app.gate3_place_import')::uuid,
    current_setting('app.gate3_version')::uuid)->'groups'->0->>'status'),
    'unchanged', 'Re-previewing a staged group is idempotent');
select set_config('app.gate3_place_conflict',
    (public.import_drinking_window_profile_exchange(jsonb_set(
      current_setting('app.gate3_place')::jsonb,
      '{ageing_groups,0,definition}',
      to_jsonb('A different synthetic definition that must not overwrite the existing group.'::text)
    ))->>'id'),true);
select is((public.preview_drinking_window_place_profile_exchange(
    current_setting('app.gate3_place_conflict')::uuid,
    current_setting('app.gate3_version')::uuid)->'groups'->0->>'status'),
    'quarantined', 'A second profile cannot silently overwrite an existing group');
select ok((select count(*) from public.drinking_window_reference_reviews
    where version_id=current_setting('app.gate3_version')::uuid and verdict='approve') >= 5,
    'Both release rows, group, membership and group window have curator reviews');

select set_config('app.selectable_place', (public.import_drinking_window_profile_exchange(
    jsonb_set(jsonb_set(current_setting('app.gate3_place')::jsonb,
      '{ageing_groups,0,name}',to_jsonb('Synthetic independently selected reds'::text)),
      '{ageing_groups,0,windows}',
      current_setting('app.gate3_place')::jsonb #> '{ageing_groups,0,windows}' ||
      jsonb_build_array(jsonb_build_object('vintage',2023,'first_trial_year',2025,
        'best_start_year',2027,'best_end_year',2031,
        'rationale','A second synthetic regional editorial window for independent review.',
        'source_ids',jsonb_build_array('context')))))->>'id'),true);
select set_config('app.selectable_hash',public.preview_selectable_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid)->>'preview_sha256',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select throws_ok($test$
  select public.preview_selectable_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid)
$test$, '42501', 'An active curator grant for this profile type is required',
  'A non-curator cannot preview geographic review details');
select throws_ok($test$
  select public.stage_selected_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.selectable_hash'),'A synthetic reason that is sufficiently long for review.',true,
    array['synthetic_young_red:2022'])
$test$, '42501', 'An active curator grant for this profile type is required',
  'A non-curator cannot approve a geographic window');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select throws_ok($test$
  select public.stage_selected_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid,
    repeat('0',64),'A synthetic reason that is sufficiently long for review.',true,
    array['synthetic_young_red:2022'])
$test$, '40001', 'Profile mapping or draft changed; refresh the preview',
  'A stale geographic preview cannot be staged');
select throws_ok($test$
  select public.stage_selected_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.selectable_hash'),'A synthetic reason that is sufficiently long for review.',true,
    array['synthetic_young_red:2022','synthetic_young_red:2022'])
$test$, '22023', 'Choose distinct rows to review',
  'Duplicate geographic selections are rejected');
select throws_ok($test$
  select public.stage_selected_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.selectable_hash'),'A synthetic reason that is sufficiently long for review.',true,
    array['synthetic_young_red:2024'])
$test$, '22023', 'Selected rows must each be uniquely ready',
  'A nonexistent vintage cannot be selected');
select is((public.stage_selected_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.selectable_hash'),'I checked this one regional year and its synthetic evidence for sharing.',true,
    array['synthetic_young_red:2022'])->>'staged')::integer,1,
    'One selected regional year is staged independently');
select is((select count(*) from private.drinking_window_profile_exchange_links
    where exchange_id=current_setting('app.selectable_place')::uuid),1::bigint,
    'The second year was not staged');
select is((public.preview_selectable_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid)
    ->'groups'->0->'windows'->0->>'selection_status'),'unchanged',
    'The staged vintage is identifiable on re-preview');
select is((public.preview_selectable_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid)
    ->'groups'->0->'windows'->1->>'selection_status'),'ready',
    'The remaining vintage remains available for later review');
select set_config('app.selectable_hash',public.preview_selectable_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid)->>'preview_sha256',true);
select set_config('app.selectable_group',(select group_id::text from private.drinking_window_profile_group_links
    where exchange_id=current_setting('app.selectable_place')::uuid),true);
update public.drinking_window_ageing_groups set definition='Changed synthetic definition requiring a new review.'
    where id=current_setting('app.selectable_group')::uuid;
select throws_ok($test$
  select public.stage_selected_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.selectable_hash'),'A synthetic reason that is sufficiently long for review.',true,
    array['synthetic_young_red:2023'])
$test$, '40001', 'Reviewed group changed; review its definition and members again',
  'A changed group cannot silently receive dates from the old profile');
update public.drinking_window_ageing_groups
    set definition='A synthetic regional category with explicitly reviewed Morgon membership only.'
    where id=current_setting('app.selectable_group')::uuid;
insert into public.drinking_window_ageing_group_memberships
    (id,version_id,group_id,member_kind,member_place_id,rationale)
values ('fa700000-0000-4000-8000-000000000001',current_setting('app.gate3_version')::uuid,
    current_setting('app.selectable_group')::uuid,'place',
    (select id from public.enrichment_places where canonical_name='Beaujolais'),
    'A different synthetic membership that requires a new review.');
select throws_ok($test$
  select public.stage_selected_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.selectable_hash'),'A synthetic reason that is sufficiently long for review.',true,
    array['synthetic_young_red:2023'])
$test$, '40001', 'Reviewed group changed; review its definition and members again',
  'Changed membership cannot silently receive dates from the old profile');
delete from public.drinking_window_ageing_group_memberships
    where id='fa700000-0000-4000-8000-000000000001';
select is((public.stage_selected_drinking_window_place_profile(
    current_setting('app.selectable_place')::uuid,current_setting('app.gate3_version')::uuid,
    current_setting('app.selectable_hash'),'I checked the second regional year and its synthetic evidence for sharing.',true,
    array['synthetic_young_red:2023'])->>'staged')::integer,1,
    'A later vintage can be added to the same reviewed group');
select is((select count(*) from private.drinking_window_profile_exchange_links
    where exchange_id=current_setting('app.selectable_place')::uuid),2::bigint,
    'Both independently reviewed years are linked exactly once');

select * from finish();
rollback;
