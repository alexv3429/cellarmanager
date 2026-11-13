begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id,email)
values ('f9700000-0000-4000-8000-000000000001','homonymous-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id,display_name,profile_scopes,rationale,granted_by)
values ('f9700000-0000-4000-8000-000000000001','Synthetic curator',
    array['drinking-window'],'Tests homonymous geographic identities.','database-test');
set local request.jwt.claim.sub = 'f9700000-0000-4000-8000-000000000001';

select set_config('app.test_region',public.create_drinking_window_curation_place(
    'region',null,'Synthetic Homonym','FR',
    'The synthetic region identity is verified for this regression test.',true)->>'id',true);
select set_config('app.test_appellation',public.create_drinking_window_curation_place(
    'appellation',current_setting('app.test_region')::uuid,'Synthetic Homonym','FR',
    'The synthetic appellation identity is verified under its region.',true)->>'id',true);
select set_config('app.test_version',(select id::text from public.drinking_window_reference_versions
    where status='draft' order by version_number desc limit 1),true);
select set_config('app.test_profile', $$
{
  "format":"cellarmanager.place_profile","schema_version":"1.0.0",
  "dataset_version":"1.0.0","status":"draft_for_curator_review",
  "profile_kind":"region",
  "place":{"name":"Synthetic Homonym","country_code":"FR","source_ids":["context"]},
  "sources":[{"id":"context","url":"https://example.org/synthetic-region"}],
  "facts":[],
  "ageing_groups":[{
    "id":"regional_red","name":"Synthetic regional reds","color":"red",
    "definition":"A synthetic regional group testing explicit membership in the anchor region.",
    "source_ids":["context"],
    "members":[{"kind":"place","name":"Synthetic Homonym",
      "rationale":"This test member explicitly refers to the synthetic regional profile anchor.",
      "source_ids":["context"]}],
    "windows":[{"vintage":2022,"first_trial_year":2024,"best_start_year":2026,
      "best_end_year":2030,"rationale":"Synthetic editorial dates used only to test the identity preview.",
      "source_ids":["context"]}]
  }]
}
$$,true);
select set_config('app.test_exchange',public.import_drinking_window_profile_exchange(
    current_setting('app.test_profile')::jsonb)->>'id',true);
select set_config('app.test_preview',public.preview_drinking_window_place_profile_exchange(
    current_setting('app.test_exchange')::uuid,current_setting('app.test_version')::uuid)::text,true);
select is(current_setting('app.test_preview')::jsonb->'groups'->0->>'status','ready',
    'A region profile with a homonymous appellation resolves its own explicit member');
select is(current_setting('app.test_preview')::jsonb->'groups'->0->'members'->0->>'target_id',
    current_setting('app.test_region'),'The member is the region, not the homonymous appellation');

select set_config('app.test_app_profile',jsonb_set(
    current_setting('app.test_profile')::jsonb,'{profile_kind}',to_jsonb('appellation'::text))::text,true);
select set_config('app.test_app_profile',jsonb_set(
    current_setting('app.test_app_profile')::jsonb,'{place,region}',to_jsonb('Synthetic Homonym'::text))::text,true);
select set_config('app.test_app_exchange',public.import_drinking_window_profile_exchange(
    current_setting('app.test_app_profile')::jsonb)->>'id',true);
select set_config('app.test_app_preview',public.preview_drinking_window_place_profile_exchange(
    current_setting('app.test_app_exchange')::uuid,current_setting('app.test_version')::uuid)::text,true);
select is(current_setting('app.test_app_preview')::jsonb->'groups'->0->>'status','ready',
    'An appellation profile with a homonymous region resolves its own explicit member');
select is(current_setting('app.test_app_preview')::jsonb->'groups'->0->'members'->0->>'target_id',
    current_setting('app.test_appellation'),'The member is the appellation, not the region');

insert into public.enrichment_places(parent_id,place_type,canonical_name,country_code)
values (current_setting('app.test_region')::uuid,'appellation','Synthetic ambiguous descendant','FR'),
       (current_setting('app.test_region')::uuid,'site','Synthetic ambiguous descendant','FR');
select set_config('app.test_ambiguous_profile',jsonb_set(
    current_setting('app.test_profile')::jsonb,'{ageing_groups,0,members,0,name}',
    to_jsonb('Synthetic ambiguous descendant'::text))::text,true);
select set_config('app.test_ambiguous_exchange',public.import_drinking_window_profile_exchange(
    current_setting('app.test_ambiguous_profile')::jsonb)->>'id',true);
select is(public.preview_drinking_window_place_profile_exchange(
    current_setting('app.test_ambiguous_exchange')::uuid,current_setting('app.test_version')::uuid)
    ->'groups'->0->>'status','quarantined',
    'An ambiguous descendant that is not the profile anchor remains quarantined');
select is((public.stage_selected_drinking_window_place_profile(
    current_setting('app.test_exchange')::uuid,current_setting('app.test_version')::uuid,
    current_setting('app.test_preview')::jsonb->>'preview_sha256',
    'I reviewed the synthetic region, explicit membership and editorial window.',true,
    array['regional_red:2022'])->>'staged')::integer,1,
    'The correctly anchored regional profile can be staged without publishing it');

select * from finish();
rollback;
