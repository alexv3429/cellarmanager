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
insert into public.enrichment_places (id, place_type, canonical_name, country_code) values
    ('fd100000-0000-4000-8000-000000000101', 'region', 'Synthetic Region', 'FR');
insert into public.enrichment_places (id, parent_id, place_type, canonical_name, country_code) values
    ('fd100000-0000-4000-8000-000000000102',
     'fd100000-0000-4000-8000-000000000101', 'appellation',
     'Synthetic Premier Cru', 'FR'),
    ('fd100000-0000-4000-8000-000000000103',
     'fd100000-0000-4000-8000-000000000101', 'appellation',
     'Synthetic Parent', 'FR'),
    ('fd100000-0000-4000-8000-000000000104',
     'fd100000-0000-4000-8000-000000000103', 'classification',
     'Synthetic Parent Premier Cru', 'FR'),
    ('fd100000-0000-4000-8000-000000000105',
     'fd100000-0000-4000-8000-000000000101', 'classification',
     'Synthetic Orphan Premier Cru', 'FR');
insert into public.enrichment_place_aliases (place_id, alias_value) values
    ('fd100000-0000-4000-8000-000000000101', 'Pays de Test'),
    ('fd100000-0000-4000-8000-000000000102', 'Synthetic 1C');
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
        {"id":"first","name":"First wine","region":"Synthetic Region — East",
         "appellation":"Synthetic 1er Cru","color":"white"},
        {"id":"second","name":"Second wine","region":"Synthetic Region",
         "appellation":"Synthetic Premier Cru","color":"red"},
        {"id":"third","name":"Third wine","region":"Roussillon",
         "appellation":"à vérifier","color":"red"},
        {"id":"fourth","name":"Fourth wine","region":"Pays de Test",
         "appellation":"Synthetic Premier Cru","color":"red"},
        {"id":"fifth","name":"Fifth wine","region":"Synthetic Region",
         "appellation":"Synthetic 1C","color":"white"},
        {"id":"sixth","name":"Sixth wine","region":"Synthetic Region",
         "appellation":"Synthetic Parent 1er Cru","color":"white"},
        {"id":"seventh","name":"Seventh wine","region":"Synthetic Region",
         "appellation":"Synthetic Orphan 1er Cru","color":"white"}
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
    'Synthetic Region','A composite local description suggests the canonical parent region');
select is((select count(*) from jsonb_array_elements(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'regions') x
    where x->>'source_name'='Pays de Test' and x->>'target_name'='Synthetic Region'),1::bigint,
    'A preexisting place alias suggests the unique canonical region');
select is(jsonb_array_length(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'appellations'),3,
    'An appellation spelling, a unique alias and a classified parent are suggested');
select is((select count(*) from jsonb_array_elements(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'appellations') x
    where x->>'target_name'='Synthetic Premier Cru'),2::bigint,
    'Both appellation suggestions keep the Premier Cru classification');
select is((select count(*) from jsonb_array_elements(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'appellations') x
    where x->>'source_name'='Synthetic Parent 1er Cru'
      and x->>'target_name'='Synthetic Parent'
      and x->>'reason'='classification_parent_appellation'),1::bigint,
    'An exact classification suggests its existing appellation parent, with its reason exposed');
select is((select count(*) from jsonb_array_elements(public.suggest_drinking_window_profile_places(
    current_setting('app.place_suggestion_profile')::uuid)->'appellations') x
    where x->>'source_name'='Synthetic Orphan 1er Cru'),0::bigint,
    'A classification without an appellation parent is not collapsed to a region');
select is((select count(*) from public.wine_reference_aliases
    where alias_value in ('Synthetic Region — East','Synthetic 1er Cru')),0::bigint,
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
