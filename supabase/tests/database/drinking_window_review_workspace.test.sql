begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.get_drinking_window_review_workspace()', 'execute'),
    'Anonymous users cannot read the curator workspace');
select ok(not has_table_privilege('authenticated', 'private.drinking_window_candidate_review_drafts', 'select')
    and not has_table_privilege('authenticated', 'private.drinking_window_candidate_review_drafts', 'insert'),
    'Browsers cannot inspect or forge candidate review drafts');

insert into auth.users(id, email)
values ('f9000000-0000-4000-8000-000000000001', 'candidate-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9000000-0000-4000-8000-000000000001', 'Candidate Curator',
    array['place'], 'Synthetic candidate review curator for this test.', 'database-test');
insert into public.drinking_window_candidates
    (id, source_sha256, source_locator, candidate_scope, source_identity,
     wine_color, vintage_year, best_start_year, best_end_year)
values ('f9000000-0000-4000-8000-000000000002', repeat('a', 64),
    'Barraud!A2:F2', 'release', '{"producer":"Barraud","cuvee":"En France"}',
    'white', 2019, 2024, 2031);

set local role authenticated;
set local request.jwt.claim.sub = 'f9000000-0000-4000-8000-000000000001';
select is((public.get_drinking_window_review_workspace()->>'eligible')::boolean,
    false, 'A profile curator does not automatically see drinking-window candidates');
select is(jsonb_array_length(public.get_drinking_window_review_workspace()->'candidates'),
    0, 'Non-drinking-window curator receives no candidate details');
select throws_ok($test$
    select public.save_drinking_window_candidate_review(
        'f9000000-0000-4000-8000-000000000002', null, 'release',
        2023, 2024, 2031, '', 'Synthetic candidate research under review.',
        array['https://example.test/source'], 'reuse-allowed', 'propose')
$test$, '42501', 'An active curator grant for this profile type is required',
    'A profile curator cannot save drinking-window review drafts');

reset role;
update public.enrichment_curator_eligibilities
set profile_scopes = array['place', 'drinking-window']
where user_id = 'f9000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.get_drinking_window_review_workspace()->>'eligible')::boolean,
    true, 'Explicit drinking-window curator grant opens workspace');
select is(jsonb_array_length(public.get_drinking_window_review_workspace()->'candidates'),
    1, 'Curator can inspect the staged historical candidate');
select throws_ok($test$
    select public.save_drinking_window_candidate_review(
        'f9000000-0000-4000-8000-000000000002', null, 'release',
        null, 2024, 2031, '', 'Source pair still needs a start-tasting date.',
        array['https://example.test/source'], 'reuse-allowed', 'propose')
$test$, '22023', 'Candidate review is incomplete or invalid',
    'An incomplete three-date proposal cannot be marked complete');
select lives_ok($test$
    select public.save_drinking_window_candidate_review(
        'f9000000-0000-4000-8000-000000000002', null, 'release',
        null, 2024, 2031, 'exact cuvée',
        'Start tasting still requires independent research.',
        array[]::text[], 'unverified', 'investigate')
$test$, 'An incomplete research draft can be saved without publication');
select throws_ok($test$
    select public.save_drinking_window_candidate_review(
        'f9000000-0000-4000-8000-000000000002', null, 'release',
        2023, 2024, 2031, 'exact cuvée',
        'Reviewed complete three-date proposal for this wine.',
        array['https://example.test/source'], 'reuse-allowed', 'propose')
$test$, '40001', 'Candidate review changed; refresh before saving',
    'Concurrent stale draft cannot overwrite a newer curator review');
reset role;
select is((select count(*) from public.drinking_window_reference_rows),
    0::bigint, 'Candidate reviews do not create effective reference rows');
select is((select count(*) from private.drinking_window_candidate_review_drafts
    where candidate_id = 'f9000000-0000-4000-8000-000000000002'),
    1::bigint, 'Review history is stored separately from imported source row');

select * from finish();
rollback;
