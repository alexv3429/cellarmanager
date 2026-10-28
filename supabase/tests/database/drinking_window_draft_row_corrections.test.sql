begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.get_drinking_window_draft_row_correction(uuid,uuid)', 'execute'),
    'Anonymous users cannot read curator correction details');
select ok(not has_function_privilege('anon',
    'public.correct_drinking_window_draft_row(uuid,uuid,text,integer,integer,integer,text)', 'execute'),
    'Anonymous users cannot correct a reference row');
select ok(not has_function_privilege('anon',
    'public.change_drinking_window_draft_row_evidence(uuid,uuid,text,text,uuid)', 'execute'),
    'Anonymous users cannot alter linked evidence');
select ok(not has_table_privilege('authenticated',
    'private.drinking_window_draft_row_corrections', 'select'),
    'Browsers cannot read the private correction audit directly');

insert into auth.users(id, email)
values ('f9200000-0000-4000-8000-000000000001', 'correction-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9200000-0000-4000-8000-000000000001', 'Correction Curator',
    array['drinking-window'], 'Synthetic correction curator for this test.', 'database-test');
select set_config('app.test_version', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);
select set_config('app.test_row', (select id::text
    from public.drinking_window_reference_rows
    where version_id = current_setting('app.test_version')::uuid
    limit 1), true);
select set_config('app.test_evidence', (select evidence_id::text
    from public.drinking_window_reference_evidence
    where version_id = current_setting('app.test_version')::uuid
      and reference_row_id = current_setting('app.test_row')::uuid
      and claim_part = 'first_trial' limit 1), true);

set local role authenticated;
set local request.jwt.claim.sub = 'f9200000-0000-4000-8000-000000000099';
select throws_ok($test$
    select public.get_drinking_window_draft_row_correction(
        current_setting('app.test_version')::uuid, current_setting('app.test_row')::uuid)
$test$, '42501', 'An active curator grant for this profile type is required',
    'An ordinary user cannot read the correction workspace');
set local request.jwt.claim.sub = 'f9200000-0000-4000-8000-000000000001';
select set_config('app.initial_hash',
    public.get_drinking_window_draft_row_correction(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid) ->> 'hash', true);
select ok(jsonb_array_length(public.get_drinking_window_draft_row_correction(
    current_setting('app.test_version')::uuid,
    current_setting('app.test_row')::uuid) -> 'available') > 0,
    'The exact-release reviewed source is offered for linking');
select lives_ok($test$
    select public.record_drinking_window_reference_review(
        current_setting('app.test_version')::uuid, 'row',
        current_setting('app.test_row')::uuid,
        current_setting('app.initial_hash'), 'approve',
        'Synthetic approval before a later correction')
$test$, 'A curator can approve the original row for invalidation test');
reset role;
select set_config('app.original_draft_fingerprint',
    public.drinking_window_draft_fingerprint(current_setting('app.test_version')::uuid), true);
set local role authenticated;
set local request.jwt.claim.sub = 'f9200000-0000-4000-8000-000000000001';
select lives_ok($test$
    select public.correct_drinking_window_draft_row(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid,
        current_setting('app.initial_hash'), 2026, 2029, 2040,
        'A corrected synthetic three-date estimate for this release.')
$test$, 'A curator can correct all three dates and their rationale');
select throws_ok($test$
    select public.correct_drinking_window_draft_row(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid,
        current_setting('app.initial_hash'), 2027, 2030, 2041,
        'A stale correction must not overwrite another curator.')
$test$, '40001', 'This draft changed; refresh before correcting it',
    'An old subject hash cannot overwrite a correction');
select throws_ok($test$
    select public.correct_drinking_window_draft_row(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid,
        (public.get_drinking_window_draft_row_correction(
            current_setting('app.test_version')::uuid,
            current_setting('app.test_row')::uuid) ->> 'hash'),
        2028, 2027, 2040, 'Invalid inverted years must be rejected.')
$test$, '22023', 'Provide three ordered years and a reason of 10–2000 characters',
    'An inverted window is rejected');
reset role;
select ok(exists (select 1 from public.drinking_window_review_issues(
    current_setting('app.test_version')::uuid) issue
    where issue.subject_kind = 'row' and issue.subject_id = current_setting('app.test_row')::uuid
      and issue.issue_code = 'stale_review'),
    'Changing dates makes the old approval stale');
select isnt(public.drinking_window_draft_fingerprint(
    current_setting('app.test_version')::uuid),
    current_setting('app.original_draft_fingerprint'),
    'Correction changes the whole-draft fingerprint used by owner comparisons');
set local role authenticated;
set local request.jwt.claim.sub = 'f9200000-0000-4000-8000-000000000001';
select set_config('app.corrected_hash',
    public.get_drinking_window_draft_row_correction(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid) ->> 'hash', true);
select throws_ok($test$
    select public.change_drinking_window_draft_row_evidence(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid,
        current_setting('app.corrected_hash'), 'attach',
        '00000000-0000-4000-8000-000000000099')
$test$, '22023', 'This source is not a reviewed reusable claim for this exact release',
    'An unverified or unknown source cannot be attached');
select lives_ok($test$
    select public.change_drinking_window_draft_row_evidence(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid,
        current_setting('app.corrected_hash'), 'remove',
        current_setting('app.test_evidence')::uuid)
$test$, 'A curator can remove an incorrect source from the whole window');
reset role;
select is((select count(*) from public.drinking_window_reference_evidence
    where version_id = current_setting('app.test_version')::uuid
      and reference_row_id = current_setting('app.test_row')::uuid
      and evidence_id = current_setting('app.test_evidence')::uuid
      and claim_part in ('first_trial', 'optimal_period')
      and evidence_role = 'supports'), 0::bigint,
    'Removing a source clears both date claim links');
set local role authenticated;
set local request.jwt.claim.sub = 'f9200000-0000-4000-8000-000000000001';
select lives_ok($test$
    select public.change_drinking_window_draft_row_evidence(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid,
        (public.get_drinking_window_draft_row_correction(
            current_setting('app.test_version')::uuid,
            current_setting('app.test_row')::uuid) ->> 'hash'),
        'attach', current_setting('app.test_evidence')::uuid)
$test$, 'A curator can relink a reviewed exact-release source to the whole window');
reset role;
select is((select count(*) from public.drinking_window_reference_evidence
    where version_id = current_setting('app.test_version')::uuid
      and reference_row_id = current_setting('app.test_row')::uuid
      and evidence_id = current_setting('app.test_evidence')::uuid
      and claim_part in ('first_trial', 'optimal_period')
      and evidence_role = 'supports'), 2::bigint,
    'One source supports both date claim parts atomically');

select is((select count(*) from private.drinking_window_draft_row_corrections
    where version_id = current_setting('app.test_version')::uuid
      and row_id = current_setting('app.test_row')::uuid), 3::bigint,
    'Date and source changes each have an append-only correction event');
select is((select count(*) from private.drinking_window_publications), 0::bigint,
    'Correction does not publish a reference');
select is((select count(*) from private.drinking_window_household_rollouts where enabled), 0::bigint,
    'Correction does not opt a cellar in');
select * from finish();
rollback;
