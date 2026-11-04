begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users (id,email,raw_user_meta_data) values
    ('fd100000-0000-4000-8000-000000000001','place-reviewer@example.test','{}'::jsonb),
    ('fd100000-0000-4000-8000-000000000002','place-reader@example.test','{}'::jsonb);
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('fd100000-0000-4000-8000-000000000001', 'Synthetic place reviewer',
    array['drinking-window'], 'Tests read-only profile place suggestions.', 'database-test');
set local request.jwt.claim.sub = 'fd100000-0000-4000-8000-000000000001';
select set_config('app.place_suggestion_profile',
    (public.import_drinking_window_profile_exchange($profile$
    {
      "format":"cellarmanager.producer_research",
      "schema_version":"1.1.0","dataset_version":"1.0.0",
      "scope":"producer_independent_of_any_household",
      "status":"draft_for_curator_review",
      "producer":{"name":"Synthetic place producer"},
      "cuvees":[
        {"id":"first","name":"First wine","region":"Bourgogne — Mâconnais",
         "appellation":"Puligny-Montrachet 1er Cru","color":"white"},
        {"id":"second","name":"Second wine","region":"Beaujolais",
         "appellation":"Morgon","color":"red"},
        {"id":"third","name":"Third wine","region":"Roussillon",
         "appellation":"à vérifier","color":"red"},
        {"id":"fourth","name":"Fourth wine","region":"Piémont",
         "appellation":"Barolo","color":"red"},
        {"id":"fifth","name":"Fifth wine","region":"Bourgogne",
         "appellation":"Puligny-Montrachet 1C","color":"white"}
      ],
      "sources":[{"id":"pointer","url":"https://example.org/synthetic-place"}],
      "exact_release_calibrations":[],
      "import_policy":{"review_required":true,"no_direct_production_publication":true}
    }
    $profile$::jsonb)->>'id'),true);

select is(jsonb_array_length(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'regions'),2,
    'A composite name and a preexisting unique alias have suggestions');
select is(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'regions'->0->>'target_name',
    'Bourgogne','A composite local description suggests the canonical parent region');
select is((select count(*) from jsonb_array_elements(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'regions') x
    where x->>'source_name'='Piémont' and x->>'target_name'='Piemonte'),1::bigint,
    'A preexisting place alias suggests the unique canonical region');
select is(jsonb_array_length(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'appellations'),2,
    'A unique Premier Cru spelling and a unique alias are both suggested');
select is((select count(*) from jsonb_array_elements(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'appellations') x
    where x->>'target_name'='Puligny-Montrachet Premier Cru'),2::bigint,
    'Both appellation suggestions keep the Premier Cru classification');
select is((select count(*) from public.wine_reference_aliases
    where alias_value in ('Bourgogne — Mâconnais','Puligny-Montrachet 1er Cru')),0::bigint,
    'A suggestion does not create a global alias');
select is((select count(*) from private.drinking_window_profile_identity_batches
    where exchange_id=current_setting('app.place_suggestion_profile')::uuid),0::bigint,
    'A suggestion does not confirm a shared wine identity');

set local request.jwt.claim.sub = 'fd100000-0000-4000-8000-000000000002';
select throws_ok($test$select public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)$test$,
    '42501','An active curator grant for this profile type is required',
    'An ordinary user cannot inspect curator-only profile mappings');
select * from finish();
rollback;
