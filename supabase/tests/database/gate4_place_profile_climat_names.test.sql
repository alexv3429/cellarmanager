begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id,email) values
 ('fa710000-0000-4000-8000-000000000001','gate4-climat-curator@example.test'),
 ('fa710000-0000-4000-8000-000000000002','gate4-climat-member@example.test');
insert into public.enrichment_curator_eligibilities(user_id,display_name,profile_scopes,rationale,granted_by)
values ('fa710000-0000-4000-8000-000000000001','Synthetic curator',array['drinking-window'],
    'Synthetic profile-climat identity test.', 'database-test');
set local request.jwt.claim.sub = 'fa710000-0000-4000-8000-000000000001';
insert into public.drinking_window_reference_versions(id,version_number)
values ('fa710000-0000-4000-8000-000000000003',
    (select coalesce(max(version_number),0)+1 from public.drinking_window_reference_versions));
insert into public.enrichment_places(id,parent_id,place_type,canonical_name,country_code) values
 ('fa710000-0000-4000-8000-000000000010',null,'region','Synthetic Region Ormes','FR'),
 ('fa710000-0000-4000-8000-000000000011','fa710000-0000-4000-8000-000000000010',
    'appellation','Synthetic Appellation Ormes','FR'),
 ('fa710000-0000-4000-8000-000000000012','fa710000-0000-4000-8000-000000000010',
    'appellation','Synthetic Other Appellation','FR'),
 ('fa710000-0000-4000-8000-000000000013','fa710000-0000-4000-8000-000000000011',
    'climat','Les Synthetic Ormes','FR');
select set_config('app.climat_profile', $$
{
  "format":"cellarmanager.place_profile","schema_version":"1.0.0",
  "dataset_version":"1.0.0","status":"draft_for_curator_review",
  "profile_kind":"appellation",
  "place":{"name":"Synthetic Appellation Ormes","region":"Synthetic Region Ormes"},
  "sources":[{"id":"context","url":"https://example.org/synthetic-appellation"}],
  "ageing_groups":[{
    "id":"test_climat","name":"Synthetic red climat","color":"red",
    "definition":"A synthetic category for testing the exact climat identity resolver.",
    "source_ids":["context"],
    "members":[{"kind":"place","name":"Synthetic Appellation Ormes Les Synthetic Ormes",
      "rationale":"A deliberately named climat under the synthetic appellation for testing.",
      "source_ids":["context"]}],
    "windows":[{"vintage":2022,"first_trial_year":2024,"best_start_year":2026,
      "best_end_year":2030,"rationale":"A synthetic editorial window used solely for this test.",
      "source_ids":["context"]}]
  }]
}
$$,true);
select set_config('app.climat_profile_id',
    (public.import_drinking_window_profile_exchange(current_setting('app.climat_profile')::jsonb)->>'id'),true);
select is((public.preview_drinking_window_place_profile_exchange(
    current_setting('app.climat_profile_id')::uuid,'fa710000-0000-4000-8000-000000000003')
    ->'groups'->0->>'status'),'ready',
    'An appellation-prefixed member matches its official short climat name');
select is((public.preview_drinking_window_place_profile_exchange(
    current_setting('app.climat_profile_id')::uuid,'fa710000-0000-4000-8000-000000000003')
    ->'groups'->0->'members'->0->>'target_id'),
    'fa710000-0000-4000-8000-000000000013',
    'The identified climat is the correct shared identity');

insert into public.enrichment_places(id,parent_id,place_type,canonical_name,country_code)
values ('fa710000-0000-4000-8000-000000000014','fa710000-0000-4000-8000-000000000012',
    'climat','Les Synthetic Ormes','FR');
select is((public.preview_drinking_window_place_profile_exchange(
    current_setting('app.climat_profile_id')::uuid,'fa710000-0000-4000-8000-000000000003')
    ->'groups'->0->>'status'),'ready',
    'A homonymous climat in another appellation cannot alter the match');

insert into public.enrichment_places(id,parent_id,place_type,canonical_name,country_code)
values ('fa710000-0000-4000-8000-000000000015','fa710000-0000-4000-8000-000000000011',
    'climat','Synthetic Ormes','FR');
select is((public.preview_drinking_window_place_profile_exchange(
    current_setting('app.climat_profile_id')::uuid,'fa710000-0000-4000-8000-000000000003')
    ->'groups'->0->>'status'),'quarantined',
    'Multiple matching names within the appellation remain quarantined');

set local request.jwt.claim.sub = 'fa710000-0000-4000-8000-000000000002';
select throws_ok($test$ select public.preview_drinking_window_place_profile_exchange(
    current_setting('app.climat_profile_id')::uuid,'fa710000-0000-4000-8000-000000000003') $test$,
    '42501','An active curator grant for this profile type is required',
    'A non-curator cannot inspect private profile previews');
select * from finish();
rollback;
