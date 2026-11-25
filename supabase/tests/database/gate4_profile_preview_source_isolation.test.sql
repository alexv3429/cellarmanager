begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id,email) values
 ('fa720000-0000-4000-8000-000000000001','gate4-source-curator@example.test');
insert into public.enrichment_curator_eligibilities(user_id,display_name,profile_scopes,rationale,granted_by)
values ('fa720000-0000-4000-8000-000000000001','Synthetic curator',array['drinking-window'],
 'Checks profile preview source isolation.', 'database-test');
set local request.jwt.claim.sub = 'fa720000-0000-4000-8000-000000000001';
insert into public.drinking_window_reference_versions(id,version_number)
values ('fa720000-0000-4000-8000-000000000002',
 (select coalesce(max(version_number),0)+1 from public.drinking_window_reference_versions));

select set_config('app.source_producer',(select id::text from public.wine_reference_producers
 where canonical_name='Jean-Marc Burgaud' limit 1),true);
select set_config('app.source_product',(select id::text from public.wine_reference_products
 where producer_id=current_setting('app.source_producer')::uuid
 and private.normalize_wine_reference_text(canonical_name) like '%cote du py%' limit 1),true);
select set_config('app.source_profile', (public.import_drinking_window_profile_exchange($profile$
{
 "format":"cellarmanager.producer_research","schema_version":"1.1.0","dataset_version":"1.0.0",
 "scope":"producer_independent_of_any_household","status":"draft_for_curator_review",
 "producer":{"name":"Jean-Marc Burgaud"},
 "cuvees":[{"id":"known","name":"Côte du Py","region":"Beaujolais","appellation":"Morgon","color":"red"},
   {"id":"missing","name":"Synthetic Missing Cuvée","region":"Beaujolais","appellation":"Morgon","color":"red"}],
 "sources":[{"id":"first","url":"https://example.org/first-wine"},
   {"id":"second","url":"https://example.org/second-wine"}],
 "exact_release_calibrations":[
  {"cuvee_id":"known","vintage":2022,"format_ml":750,
   "proposal":{"first_trial_year":2025,"best_start_year":2028,"best_end_year":2040,
    "rationale":"Synthetic first window; this is not real drinking advice for this test.",
    "supporting_source_ids":["first"],"supporting_source_urls":["https://example.org/first-wine"]}},
  {"cuvee_id":"missing","vintage":2022,"format_ml":750,
   "proposal":{"first_trial_year":2025,"best_start_year":2028,"best_end_year":2040,
    "rationale":"Synthetic second window; this is not real drinking advice for this test.",
    "supporting_source_ids":["second"],"supporting_source_urls":["https://example.org/second-wine"]}},
  {"cuvee_id":"known","vintage":2023,"format_ml":750,
   "proposal":{"first_trial_year":2026,"best_start_year":2029,"best_end_year":2041,
    "rationale":"Synthetic invalid context; this is not real drinking advice for this test.",
    "supporting_source_ids":["second"],"supporting_source_urls":["https://example.org/first-wine"]}}
 ],
 "import_policy":{"review_required":true,"no_direct_production_publication":true}
}
$profile$::jsonb)->>'id'),true);
select set_config('app.source_preview',public.preview_drinking_window_profile_exchange(
 current_setting('app.source_profile')::uuid,'fa720000-0000-4000-8000-000000000002',
 jsonb_build_object('producer_id',current_setting('app.source_producer'),
   'cuvees',jsonb_build_object('known',current_setting('app.source_product'))))::text,true);
select is(current_setting('app.source_preview')::jsonb->'rows'->0->'source_urls'->>0,
 'https://example.org/first-wine','First wine shows its own source');
select is(current_setting('app.source_preview')::jsonb->'rows'->1->>'reason',
 'Cuvée has no unique canonical identity','Second wine remains quarantined');
select is(current_setting('app.source_preview')::jsonb->'rows'->1->'source_urls'->>0,
 'https://example.org/second-wine','Quarantined wine shows its own source, not its predecessor');
select is(current_setting('app.source_preview')::jsonb->'rows'->2->'source_urls',
 'null'::jsonb,'A source not declared for the row is never exposed');
select is(current_setting('app.source_preview')::jsonb->'rows'->2->>'reason',
 'Window, rationale or context links need correction','A resolved wine cannot stage an invalid source');
select * from finish();
rollback;
