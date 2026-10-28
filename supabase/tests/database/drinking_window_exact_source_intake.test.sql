begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.get_drinking_window_source_intake(uuid,uuid)', 'execute'),
    'Anonymous users cannot read source assessments');
select ok(not has_function_privilege('anon',
    'public.submit_drinking_window_source_intake(uuid,uuid,text,text,text,text,text,text,text)', 'execute'),
    'Anonymous users cannot submit source assessments');
select ok(not has_function_privilege('anon',
    'public.review_drinking_window_source_intake(uuid,text,text,text,boolean,boolean)', 'execute'),
    'Anonymous users cannot verify sources');
select ok(not has_table_privilege('authenticated',
    'private.drinking_window_source_intake', 'select'),
    'Browser roles cannot read the private intake table');

insert into auth.users(id, email)
values ('f9300000-0000-4000-8000-000000000001', 'source-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9300000-0000-4000-8000-000000000001', 'Source Curator',
    array['drinking-window'], 'Synthetic source curator for this test.', 'database-test');
select set_config('app.test_version', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);
select set_config('app.test_row', (select id::text
    from public.drinking_window_reference_rows
    where version_id = current_setting('app.test_version')::uuid limit 1), true);
select set_config('app.evidence_before', (select count(*)::text
    from public.enrichment_evidence), true);

set local role authenticated;
set local request.jwt.claim.sub = 'f9300000-0000-4000-8000-000000000099';
select throws_ok($test$
    select public.get_drinking_window_source_intake(
        current_setting('app.test_version')::uuid, current_setting('app.test_row')::uuid)
$test$, '42501', 'An active curator grant for this profile type is required',
    'An ordinary user cannot read assessments');
select throws_ok($test$
    select public.submit_drinking_window_source_intake(
        current_setting('app.test_version')::uuid, current_setting('app.test_row')::uuid,
        repeat('a', 64), 'Producer page', 'producer',
        'https://example.test/cote-du-py-2022-dates',
        'The exact three years appear on the source page.',
        'https://example.test/terms',
        'The source permits display and reuse of the factual citation.')
$test$, '42501', 'An active curator grant for this profile type is required',
    'An ordinary user cannot submit an assessment');
set local request.jwt.claim.sub = 'f9300000-0000-4000-8000-000000000001';
select set_config('app.initial_hash',
    public.get_drinking_window_draft_row_correction(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid) ->> 'hash', true);
select throws_ok($test$
    select public.submit_drinking_window_source_intake(
        current_setting('app.test_version')::uuid, current_setting('app.test_row')::uuid,
        current_setting('app.initial_hash'), 'Producer page', 'producer',
        'https://example.test/cote-du-py-2022-dates',
        'The exact three years appear on the source page.',
        'http://example.test/terms',
        'The source permits display and reuse of the factual citation.')
$test$, '22023',
    'Provide the source, an exact-date note, and a documented reuse-rights assessment',
    'A non-HTTPS rights record is rejected');
select set_config('app.intake_id', public.submit_drinking_window_source_intake(
    current_setting('app.test_version')::uuid,
    current_setting('app.test_row')::uuid, current_setting('app.initial_hash'),
    'Producer page', 'producer', 'https://example.test/cote-du-py-2022-dates',
    'The exact three years appear on the source page.',
    'https://example.test/terms',
    'The source permits display and reuse of the factual citation.')::text, true);
select is(jsonb_array_length(public.get_drinking_window_source_intake(
    current_setting('app.test_version')::uuid,
    current_setting('app.test_row')::uuid)), 1,
    'A pending assessment is visible to the curator');
select throws_ok($test$
    select public.review_drinking_window_source_intake(
        current_setting('app.intake_id')::uuid, current_setting('app.initial_hash'),
        'approve', 'The dates and rights were checked for this page.', true, false)
$test$, '22023', 'Verify all three exact dates and the documented reuse rights',
    'A source cannot be approved without both checks');
reset role;
select is((select count(*) from public.enrichment_evidence)::integer,
    current_setting('app.evidence_before')::integer,
    'Pending assessment has not created reviewed evidence');
set local role authenticated;
set local request.jwt.claim.sub = 'f9300000-0000-4000-8000-000000000001';
select is(public.review_drinking_window_source_intake(
    current_setting('app.intake_id')::uuid, current_setting('app.initial_hash'),
    'approve', 'The three years and citation rights were checked on the linked pages.',
    true, true) ->> 'status', 'approved',
    'A curator can explicitly verify an exact-date citation and its rights');
select throws_ok($test$
    select public.review_drinking_window_source_intake(
        current_setting('app.intake_id')::uuid, current_setting('app.initial_hash'),
        'approve', 'A second approval must not alter this assessment.', true, true)
$test$, '22023', 'Choose a pending source',
    'The assessment can be decided only once');
select set_config('app.rejected_id', public.submit_drinking_window_source_intake(
    current_setting('app.test_version')::uuid,
    current_setting('app.test_row')::uuid, current_setting('app.initial_hash'),
    'Rejected page', 'critic', 'https://example.test/rejected-source',
    'This page only discusses general cellaring, not the three dates.',
    'https://example.test/terms',
    'A possible citation whose date claim needs explicit rejection.')::text, true);
select is(public.review_drinking_window_source_intake(
    current_setting('app.rejected_id')::uuid, current_setting('app.initial_hash'),
    'reject', 'The page does not state the proposed three exact years.',
    false, false) ->> 'status', 'rejected',
    'A curator can reject a general ageing source without granting rights');
select set_config('app.stale_id', public.submit_drinking_window_source_intake(
    current_setting('app.test_version')::uuid,
    current_setting('app.test_row')::uuid, current_setting('app.initial_hash'),
    'Stale page', 'producer', 'https://example.test/stale-source',
    'These dates would be reviewed only if the draft remained unchanged.',
    'https://example.test/terms',
    'A test citation that must not survive a changed draft window.')::text, true);
select lives_ok($test$
    select public.correct_drinking_window_draft_row(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid,
        current_setting('app.initial_hash'), 2026, 2029, 2040,
        'A changed synthetic estimate invalidates pending source assessments.')
$test$, 'A draft correction changes the assessed three-date subject');
select throws_ok($test$
    select public.review_drinking_window_source_intake(
        current_setting('app.stale_id')::uuid, current_setting('app.initial_hash'),
        'approve', 'A stale source assessment must not be approved.', true, true)
$test$, '40001',
    'This draft changed; submit a new source assessment for the current dates',
    'A stale assessment cannot verify a changed draft');
select is(public.review_drinking_window_source_intake(
    current_setting('app.stale_id')::uuid,
    (public.get_drinking_window_draft_row_correction(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid) ->> 'hash'),
    'reject', 'This old assessment no longer matches the corrected dates.',
    false, false) ->> 'status', 'rejected',
    'A stale assessment can be closed without creating evidence');
reset role;
select set_config('app.evidence_id', (select evidence_id::text
    from private.drinking_window_source_intake
    where id = current_setting('app.intake_id')::uuid), true);
select ok(exists (
    select 1 from public.enrichment_evidence e
    join public.enrichment_source_policies policy on policy.id = e.source_policy_id
    where e.id = current_setting('app.evidence_id')::uuid
      and e.review_status = 'reviewed' and e.content_mode = 'pointer-only'
      and e.claim_type = 'maturity-window' and e.scope_level = 'release'
      and policy.status = 'reviewed'
      and policy.evidence_url = 'https://example.test/terms'
      and policy.raw_payload_storage_right = 'prohibited'
      and policy.cross_household_reuse_right = 'allowed'
), 'Approval creates a pointer-only, exact-release evidence record with reviewed rights');
select ok(private.drinking_window_reusable_release_evidence(
    current_setting('app.evidence_id')::uuid, current_setting('app.test_row')::uuid),
    'The verified source is eligible for explicit linking');
select is((select count(*) from public.drinking_window_reference_evidence
    where evidence_id = current_setting('app.evidence_id')::uuid), 0::bigint,
    'Verification alone does not link evidence to the reference');
select is((select count(*) from public.enrichment_evidence)::integer,
    current_setting('app.evidence_before')::integer + 1,
    'Rejected and stale assessments create no evidence');
select is((select count(*) from private.drinking_window_publications), 0::bigint,
    'Verification does not publish a reference');
select is((select count(*) from private.drinking_window_household_rollouts where enabled), 0::bigint,
    'Verification does not opt in a cellar');

select * from finish();
rollback;
