begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- Exercise the app's complete-profile RPC sequence on a disposable database.
-- This is not a publication of owner-supplied research to the live project.
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('00000000-0000-4000-8000-000000000001', 'Synthetic profile publisher',
    array['drinking-window'], 'Tests the complete profile exchange through publication.',
    'database-test');
select set_config('app.profile_flow_version', gen_random_uuid()::text, true);
insert into public.drinking_window_reference_versions (id, version_number)
values (current_setting('app.profile_flow_version')::uuid,
    (select max(version_number) + 1 from public.drinking_window_reference_versions));
select set_config('app.profile_flow_release',
    '0ea70dd0-a315-4fff-f438-c9b3ed5fe573', true);
select set_config('app.profile_flow_product', (select product_id::text
    from public.wine_reference_releases
    where id = current_setting('app.profile_flow_release')::uuid), true);
select set_config('app.profile_flow_producer', (select producer_id::text
    from public.wine_reference_products
    where id = current_setting('app.profile_flow_product')::uuid), true);
select set_config('app.profile_flow_map', jsonb_build_object(
    'producer_id', current_setting('app.profile_flow_producer'),
    'cuvees', jsonb_build_object('py', current_setting('app.profile_flow_product')))::text, true);
select set_config('app.profile_flow_document', $$
{
  "format":"cellarmanager.producer_research",
  "schema_version":"1.1.0",
  "dataset_version":"1.0.0",
  "scope":"producer_independent_of_any_household",
  "status":"draft_for_curator_review",
  "producer":{"name":"Domaine Jean-Marc Burgaud"},
  "cuvees":[{"id":"py","name":"Côte du Py","appellation":"Morgon","region":"Beaujolais","color":"red"}],
  "sources":[{"id":"context","url":"https://example.org/synthetic-py-context"}],
  "exact_release_calibrations":[
    {"cuvee_id":"py","vintage":2022,"format_ml":1500,
     "proposal":{"first_trial_year":2026,"best_start_year":2029,"best_end_year":2038,
       "rationale":"A synthetic editorial estimate for the 1500 ml Côte du Py release, not producer-published dates.",
       "supporting_source_ids":["context"],
       "supporting_source_urls":["https://example.org/synthetic-py-context"]}}
  ],
  "import_policy":{"review_required":true,"no_direct_production_publication":true}
}
$$, true);

update public.wines set producer = 'Jean-Marc Burgaud', cuvee = 'Côte du Py',
    vintage = 2022, color = 'red', area = 'Beaujolais', appellation = 'Morgon',
    format_ml = 1500, wine_reference_type = 'release',
    wine_reference_id = current_setting('app.profile_flow_release')::uuid
where id in ('00000000-0000-4000-8000-000000000110',
             '00000000-0000-4000-8000-000000000210');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select set_config('app.profile_flow_import',
    (public.import_drinking_window_profile_exchange(
        current_setting('app.profile_flow_document')::jsonb)->>'id'), true);
select is((public.import_drinking_window_profile_exchange(
    current_setting('app.profile_flow_document')::jsonb)->>'inserted')::boolean, false,
    'The complete profile is retained once across re-imports');
select is((public.preview_drinking_window_profile_exchange(
    current_setting('app.profile_flow_import')::uuid,
    current_setting('app.profile_flow_version')::uuid,
    current_setting('app.profile_flow_map')::jsonb)->'rows'->0->>'status'),
    'ready', 'Canonical identity mapping makes the exact release stageable');
select set_config('app.profile_flow_hash',
    public.preview_drinking_window_profile_exchange(
        current_setting('app.profile_flow_import')::uuid,
        current_setting('app.profile_flow_version')::uuid,
        current_setting('app.profile_flow_map')::jsonb)->>'preview_sha256', true);
select is((public.stage_drinking_window_profile_exchange(
    current_setting('app.profile_flow_import')::uuid,
    current_setting('app.profile_flow_version')::uuid,
    current_setting('app.profile_flow_hash'),
    'I checked the exact synthetic release, its three dates, and its context source before sharing.',
    true, current_setting('app.profile_flow_map')::jsonb)->>'staged')::integer, 1,
    'One curator stages and approves the mapped release in a single reviewed batch');
select is((public.check_drinking_window_working_draft(
    current_setting('app.profile_flow_version')::uuid)->>'issue_count')::integer, 0,
    'The complete-profile draft passes publication preflight');
select is((public.preview_drinking_window_publication_impact(
    current_setting('app.profile_flow_version')::uuid)->>'matched_count')::integer, 2,
    'Impact preview finds the exact release in two separate cellars');
select ok((public.publish_reviewed_drinking_window_draft(
    current_setting('app.profile_flow_version')::uuid)->>'content_sha256') is not null,
    'The same curator publishes the complete-profile draft without a developer or second approval');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source', 'reviewed_reference',
    'The first cellar receives the published profile window');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000210')
    ->> 'effective_source', 'reviewed_reference',
    'The second cellar receives the same published profile window');

select * from finish();
rollback;
