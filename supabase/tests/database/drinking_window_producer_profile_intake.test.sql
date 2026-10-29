begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.submit_drinking_window_producer_profile(text,text,text,jsonb)', 'execute'),
    'Anonymous callers cannot import shared research');
select ok(not has_table_privilege('authenticated',
    'private.drinking_window_producer_candidate_stagings', 'insert'),
    'Browser callers cannot forge a canonical staging decision');

insert into auth.users(id, email) values
    ('f9200000-0000-4000-8000-000000000001', 'producer-intake-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9200000-0000-4000-8000-000000000001', 'Producer Intake Curator',
    array['drinking-window'], 'Synthetic producer-profile intake curator for this test.', 'database-test');
select set_config('app.test_version', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);

set local role authenticated;
set local request.jwt.claim.sub = 'f9200000-0000-4000-8000-000000000099';
select throws_ok($test$
    select public.submit_drinking_window_producer_profile(repeat('a', 64),
        'Jean-Marc Burgaud', '1.1.0', '[]'::jsonb)
$test$, '42501', 'An active curator grant for this profile type is required',
    'A regular signed-in user cannot import shared research');

set local request.jwt.claim.sub = 'f9200000-0000-4000-8000-000000000001';
select is((public.submit_drinking_window_producer_profile(repeat('a', 64),
    'Jean-Marc Burgaud', '1.1.0', jsonb_build_array(jsonb_build_object(
        'cuvee_id', 'james', 'cuvee', 'James', 'appellation', 'Morgon',
        'region', 'Beaujolais', 'color', 'red', 'vintage', 2022,
        'format_ml', 750, 'first_trial_year', 2026,
        'best_start_year', 2030, 'best_end_year', 2038,
        'rationale', 'Research estimate awaiting source review.',
        'evidence_urls', jsonb_build_array('https://example.test/james'),
        'review_status', 'candidate_not_approved'
    )))->>'inserted')::integer, 1,
    'A curated import creates one research-only candidate');
select is((public.submit_drinking_window_producer_profile(repeat('a', 64),
    'Jean-Marc Burgaud', '1.1.0', jsonb_build_array(jsonb_build_object(
        'cuvee_id', 'james', 'cuvee', 'James', 'appellation', 'Morgon',
        'region', 'Beaujolais', 'color', 'red', 'vintage', 2022,
        'format_ml', 750, 'first_trial_year', 2026,
        'best_start_year', 2030, 'best_end_year', 2038,
        'rationale', 'Research estimate awaiting source review.',
        'evidence_urls', jsonb_build_array('https://example.test/james'),
        'review_status', 'candidate_not_approved'
    )))->>'already_present')::integer, 1,
    'Reimporting the same package is idempotent');
select is(jsonb_array_length(public.get_drinking_window_producer_profile_imports()), 1,
    'The curator can find imported producer profiles');
select is(jsonb_array_length(public.get_drinking_window_producer_profile_candidates(repeat('a', 64)) -> 'candidates'), 1,
    'The curator can load every proposal for a selected profile');
select is(jsonb_array_length(public.search_drinking_window_producer_candidate_releases(
    (public.get_drinking_window_producer_profile_candidates(repeat('a', 64)) -> 'candidates' -> 0 ->> 'id')::uuid,
    'James')), 1, 'Canonical release search finds James 2022');
select throws_ok($test$
    select public.stage_drinking_window_producer_candidate(
      (public.get_drinking_window_producer_profile_candidates(repeat('a', 64)) -> 'candidates' -> 0 ->> 'id')::uuid,
      'f9200000-0000-4000-8000-000000000003',
      current_setting('app.test_version')::uuid,
      '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
      'Exact producer, cuvée and vintage independently verified.')
$test$, '40001', 'A current, complete review is required',
    'Unreviewed producer research cannot enter a reference draft');

reset role;
insert into private.drinking_window_candidate_review_drafts (
    id, candidate_id, proposed_scope, first_trial_year, best_start_year,
    best_end_year, rationale, evidence_urls, rights_status, disposition, curator_id
) values (
    'f9200000-0000-4000-8000-000000000003',
    (select id from public.drinking_window_candidates where source_sha256 = repeat('a', 64)),
    'release', 2026, 2030, 2038,
    'A synthetic exact-release three-date review backed by research.',
    array['https://example.test/james'], 'reuse-allowed', 'propose',
    'f9200000-0000-4000-8000-000000000001'
);
set local role authenticated;
select is((public.stage_drinking_window_producer_candidate(
      (public.get_drinking_window_producer_profile_candidates(repeat('a', 64)) -> 'candidates' -> 0 ->> 'id')::uuid,
      'f9200000-0000-4000-8000-000000000003',
      current_setting('app.test_version')::uuid,
      '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
      'Exact producer, cuvée and vintage independently verified.')
    ->> 'already_staged')::boolean, false,
    'Reviewed producer research stages an exact release in an unpublished draft');
select is((public.stage_drinking_window_producer_candidate(
      (public.get_drinking_window_producer_profile_candidates(repeat('a', 64)) -> 'candidates' -> 0 ->> 'id')::uuid,
      'f9200000-0000-4000-8000-000000000003',
      current_setting('app.test_version')::uuid,
      '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
      'Exact producer, cuvée and vintage independently verified.')
    ->> 'already_staged')::boolean, true,
    'Staging retry is idempotent');
reset role;
select is((select count(*) from public.drinking_window_reference_rows
    where version_id = private.enrichment_seed_uuid('drinking-window:burgaud-cote-du-py-2022-750:v2')),
    2::bigint, 'The draft holds its previous row and the newly reviewed James row');
select is((select count(*) from public.drinking_window_reference_evidence link
    join private.drinking_window_producer_candidate_stagings stage
      on stage.reference_row_id = link.reference_row_id), 0::bigint,
    'Research links are not silently promoted to reviewed evidence');

select * from finish();
rollback;
