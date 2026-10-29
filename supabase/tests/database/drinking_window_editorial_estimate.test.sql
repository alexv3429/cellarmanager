begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.attest_drinking_window_editorial_estimate(uuid,uuid,text,text,text[],boolean)', 'execute'),
    'Anonymous callers cannot attest editorial evidence');
select ok(not has_table_privilege('authenticated',
    'private.drinking_window_editorial_estimates', 'insert'),
    'Browsers cannot forge editorial consent');

insert into auth.users(id, email)
values ('f9300000-0000-4000-8000-000000000001', 'editorial-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9300000-0000-4000-8000-000000000001', 'Editorial Curator',
    array['drinking-window'], 'Synthetic editorial curator for this test.', 'database-test');

select set_config('app.test_version', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);
select set_config('app.test_row', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:row')::text, true);
select set_config('app.test_hash', private.drinking_window_review_subject_hash(
    current_setting('app.test_version')::uuid, 'row', current_setting('app.test_row')::uuid), true);

set local role authenticated;
set local request.jwt.claim.sub = 'f9300000-0000-4000-8000-000000000099';
select throws_ok($test$
    select public.attest_drinking_window_editorial_estimate(
        current_setting('app.test_version')::uuid, current_setting('app.test_row')::uuid,
        current_setting('app.test_hash'),
        'These are my contextual estimates, not dates published by a producer.',
        array['https://example.test/context'], true)
$test$, '42501', 'An active curator grant for this profile type is required',
    'An ordinary user cannot create shared editorial evidence');

set local request.jwt.claim.sub = 'f9300000-0000-4000-8000-000000000001';
select throws_ok($test$
    select public.attest_drinking_window_editorial_estimate(
        current_setting('app.test_version')::uuid, current_setting('app.test_row')::uuid,
        current_setting('app.test_hash'),
        'These are my contextual estimates, not dates published by a producer.',
        array['https://example.test/context'], false)
$test$, '22023', 'Review the estimate, give context links, and explicitly authorize shared reuse',
    'Editorial evidence requires explicit sharing consent');
select lives_ok($test$
    select public.attest_drinking_window_editorial_estimate(
        current_setting('app.test_version')::uuid, current_setting('app.test_row')::uuid,
        current_setting('app.test_hash'),
        'These are my contextual estimates, not dates published by a producer.',
        array['https://example.test/context'], true)
$test$, 'A curator may adopt an editorial estimate with consent and context links');
reset role;
select ok(exists (
    select 1 from public.drinking_window_reference_evidence link
    join private.drinking_window_editorial_estimates note on note.evidence_id = link.evidence_id
    where link.reference_row_id = current_setting('app.test_row')::uuid
      and link.claim_part = 'first_trial'
), 'The estimate supports the start-tasting milestone');

select is((select count(*) from private.drinking_window_editorial_date_issues(
    current_setting('app.test_version')::uuid)), 0::bigint,
    'The estimate initially agrees with the exact three dates');
update public.drinking_window_reference_rows set best_end_year = 2039
where id = current_setting('app.test_row')::uuid;
select is((select count(*) from private.drinking_window_editorial_date_issues(
    current_setting('app.test_version')::uuid)), 1::bigint,
    'Changing a date invalidates editorial evidence before publication');

select * from finish();
rollback;
