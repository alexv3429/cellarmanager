begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users (id,email,raw_user_meta_data) values
    ('fd120000-0000-4000-8000-000000000001','profile-identity-reviewer@example.test','{}'::jsonb),
    ('fd120000-0000-4000-8000-000000000002','profile-identity-reader@example.test','{}'::jsonb);
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('fd120000-0000-4000-8000-000000000001', 'Synthetic identity reviewer',
    array['drinking-window'], 'Tests safe profile name suggestions.', 'database-test');

insert into public.wine_reference_entities(id,entity_type) values
    ('fd120000-0000-4000-8000-000000000101','producer'),
    ('fd120000-0000-4000-8000-000000000201','product'),
    ('fd120000-0000-4000-8000-000000000202','product'),
    ('fd120000-0000-4000-8000-000000000203','product');
insert into public.wine_reference_producers(id,canonical_name) values
    ('fd120000-0000-4000-8000-000000000101','Synthetic Frantz Chagnoleau');
insert into public.wine_reference_products(id,producer_id,canonical_name) values
    ('fd120000-0000-4000-8000-000000000201',
     'fd120000-0000-4000-8000-000000000101',
     'Domaine Synthetic Frantz Chagnoleau, Saint-Veran, A la Cote'),
    ('fd120000-0000-4000-8000-000000000202',
     'fd120000-0000-4000-8000-000000000101',
     'Domaine Synthetic Frantz Chagnoleau, Saint-Veran, Rose'),
    ('fd120000-0000-4000-8000-000000000203',
     'fd120000-0000-4000-8000-000000000101',
     'Synthetic Frantz Chagnoleau, Saint-Veran, Rose');

set local request.jwt.claim.sub = 'fd120000-0000-4000-8000-000000000001';
select set_config('app.identity_suggestion_profile',
    (public.import_drinking_window_profile_exchange($profile$
    {
      "format":"cellarmanager.producer_research",
      "schema_version":"1.1.0","dataset_version":"1.0.0",
      "scope":"producer_independent_of_any_household",
      "status":"draft_for_curator_review",
      "producer":{"name":"Domaine Synthetic Frantz Chagnoleau",
        "aliases":["Synthetic Frantz Chagnoleau"]},
      "cuvees":[
        {"id":"cote","name":"À la Côte","aliases":["A la Cote"],
         "region":"Bourgogne","appellation":"Saint-Véran","color":"white"},
        {"id":"rose","name":"Rosé","region":"Bourgogne",
         "appellation":"Saint-Véran","color":"rose"},
        {"id":"missing","name":"Unknown cuvée","region":"Bourgogne",
         "appellation":"Saint-Véran","color":"white"}
      ],
      "sources":[{"id":"pointer","url":"https://example.org/identity"}],
      "exact_release_calibrations":[],
      "import_policy":{"review_required":true,"no_direct_production_publication":true}
    }
    $profile$::jsonb)->>'id'),true);

select is((public.suggest_drinking_window_profile_identities(
    current_setting('app.identity_suggestion_profile')::uuid)->>'producer_id')::uuid,
    'fd120000-0000-4000-8000-000000000101'::uuid,
    'An exact profile alias resolves one existing shared producer');
select is((public.suggest_drinking_window_profile_identities(
    current_setting('app.identity_suggestion_profile')::uuid)#>>'{cuvees,cote}')::uuid,
    'fd120000-0000-4000-8000-000000000201'::uuid,
    'An exact producer/appellation/cuvée composite resolves the existing product');
select is((public.suggest_drinking_window_profile_identities(
    current_setting('app.identity_suggestion_profile')::uuid)#>>'{cuvees,rose}'),
    null, 'Two composite identities keep a generic cuvée ambiguous');
select is((public.suggest_drinking_window_profile_identities(
    current_setting('app.identity_suggestion_profile')::uuid)#>>'{cuvees,missing}'),
    null, 'A missing shared cuvée is not invented');
select is((public.suggest_drinking_window_profile_identities(
    current_setting('app.identity_suggestion_profile')::uuid)->'ambiguous_cuvees') ? 'rose',
    true, 'Ambiguous names are exposed separately for review');
select is((select count(*) from public.wine_reference_aliases alias
    where alias.entity_id in ('fd120000-0000-4000-8000-000000000101'::uuid,
        'fd120000-0000-4000-8000-000000000201'::uuid)),0::bigint,
    'Lookup hints do not create global aliases');
select is((public.suggest_drinking_window_profile_identities(
    current_setting('app.identity_suggestion_profile')::uuid)->>'published')::boolean,
    false, 'Name suggestions do not publish drinking dates');

insert into public.wine_reference_entities(id,entity_type) values
    ('fd120000-0000-4000-8000-000000000102','producer');
insert into public.wine_reference_producers(id,canonical_name) values
    ('fd120000-0000-4000-8000-000000000102','Domaine Synthetic Frantz Chagnoleau');
select is((public.suggest_drinking_window_profile_identities(
    current_setting('app.identity_suggestion_profile')::uuid)->>'producer_matches')::integer,
    2, 'Conflicting exact producer names are counted');
select is((public.suggest_drinking_window_profile_identities(
    current_setting('app.identity_suggestion_profile')::uuid)->>'producer_id'),
    null, 'An ambiguous producer cannot preselect any cuvée');

set local request.jwt.claim.sub = 'fd120000-0000-4000-8000-000000000002';
select throws_ok($test$select public.suggest_drinking_window_profile_identities(
    current_setting('app.identity_suggestion_profile')::uuid)$test$,
    '42501','An active curator grant for this profile type is required',
    'Ordinary users cannot inspect curator-private profile identities');
select * from finish();
rollback;
