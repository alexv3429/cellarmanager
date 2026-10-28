begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.stage_drinking_window_candidate_as_draft(uuid,uuid,uuid)', 'execute'),
    'Anonymous callers cannot stage reference drafts');
select ok(not has_table_privilege('authenticated',
    'private.drinking_window_candidate_stagings', 'insert'),
    'Browsers cannot forge a staging event');
select ok(not has_function_privilege('authenticated',
    'private.get_drinking_window_reference_drafts()', 'execute'),
    'The former draft reader is private behind the identity-aware wrapper');

insert into auth.users(id, email)
values ('f9100000-0000-4000-8000-000000000001', 'staging-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9100000-0000-4000-8000-000000000001', 'Staging Curator',
    array['drinking-window'], 'Synthetic draft-staging curator for this test.', 'database-test');
insert into public.drinking_window_candidates (
    id, source_sha256, source_locator, candidate_scope, source_identity,
    wine_color, vintage_year, first_trial_year, best_start_year, best_end_year
) values (
    'f9100000-0000-4000-8000-000000000002', repeat('e', 64),
    'cellar-owner-proposal:staging-test', 'release',
    jsonb_build_object('origin', 'cellar-owner-proposal',
        'release_id', '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
        'format_ml', 750, 'region', 'Beaujolais', 'appellation', 'Morgon',
        'producer', 'Jean-Marc Burgaud',
        'cuvee', 'Jean-Marc Burgaud, Cote du Py James, Morgon'),
    'red', 2022, 2026, 2032, 2042
);
insert into private.drinking_window_candidate_review_drafts (
    id, candidate_id, proposed_scope, first_trial_year,
    best_start_year, best_end_year, rationale, evidence_urls,
    rights_status, disposition, curator_id
) values (
    'f9100000-0000-4000-8000-000000000003',
    'f9100000-0000-4000-8000-000000000002', 'release',
    2026, 2032, 2042, 'A synthetic exact-release three-date review.',
    array['https://example.test/james-window'], 'reuse-allowed', 'propose',
    'f9100000-0000-4000-8000-000000000001'
);

select set_config('app.test_v1', private.enrichment_seed_uuid(
    'drinking-window:first-shared:burgaud-2022:version')::text, true);
select set_config('app.test_v2', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);
insert into public.drinking_window_ageing_groups (
    id, version_id, scope, region_id, wine_color, group_key, definition
) values (
    'f9100000-0000-4000-8000-000000000004',
    current_setting('app.test_v2')::uuid,
    'region', (select id from public.enrichment_places where canonical_name = 'Bourgogne'
        and place_type = 'region'), 'white', 'test-group',
    'Synthetic group that must be copied without changing its meaning.'
);
insert into public.drinking_window_ageing_group_memberships (
    id, version_id, group_id, member_kind, member_release_id, rationale
) values (
    'f9100000-0000-4000-8000-000000000005',
    current_setting('app.test_v2')::uuid,
    'f9100000-0000-4000-8000-000000000004',
    'release', 'a90a1111-c809-f15f-4754-4973a1ba108e',
    'Synthetic exact-release membership used to check version cloning.'
);

set local role authenticated;
set local request.jwt.claim.sub = 'f9100000-0000-4000-8000-000000000099';
select throws_ok($test$
    select public.stage_drinking_window_candidate_as_draft(
        'f9100000-0000-4000-8000-000000000002',
        'f9100000-0000-4000-8000-000000000003',
        current_setting('app.test_v2')::uuid)
$test$, '42501', 'An active curator grant for this profile type is required',
    'An ordinary signed-in user cannot stage a shared draft');
set local request.jwt.claim.sub = 'f9100000-0000-4000-8000-000000000001';
select throws_ok($test$
    select public.stage_drinking_window_candidate_as_draft(
        'f9100000-0000-4000-8000-000000000002',
        'f9100000-0000-4000-8000-000000000003',
        current_setting('app.test_v1')::uuid)
$test$, '22023', 'Choose a current draft or active base version',
    'Withdrawn reference versions cannot be copied');
select lives_ok($test$
    select public.stage_drinking_window_candidate_as_draft(
        'f9100000-0000-4000-8000-000000000002',
        'f9100000-0000-4000-8000-000000000003',
        current_setting('app.test_v2')::uuid)
$test$, 'A curator can stage a complete exact-release proposal');
select is(((public.stage_drinking_window_candidate_as_draft(
        'f9100000-0000-4000-8000-000000000002',
        'f9100000-0000-4000-8000-000000000003',
        current_setting('app.test_v2')::uuid)
    )->>'already_staged')::boolean, true,
    'Retry is idempotent for the same review');
select ok(exists (
    select 1
    from jsonb_array_elements(public.get_drinking_window_reference_drafts() -> 'drafts') draft,
         jsonb_array_elements(draft -> 'subjects') subject
    where (draft ->> 'version_number')::integer = 3
      and subject ->> 'kind' = 'row'
      and subject ->> 'title' like '%James%750 ml%'
      and (subject -> 'details' ->> 'format_ml')::integer = 750
), 'The review list identifies the exact cuvée and bottle size');
reset role;

select is((select count(*) from public.drinking_window_reference_versions
    where version_number = 3 and status = 'draft'), 1::bigint,
    'Staging creates exactly one unpublished version');
select is((select count(*) from public.drinking_window_reference_rows
    where version_id = private.enrichment_seed_uuid(
        'drinking-window:burgaud-cote-du-py-2022-750:v2')), 1::bigint,
    'Original draft remains untouched');
select is((select count(*) from public.drinking_window_reference_rows row
    join public.drinking_window_reference_versions version on version.id = row.version_id
    where version.version_number = 3), 2::bigint,
    'New draft carries forward the old row and adds the candidate');
select is((select count(*) from public.drinking_window_reference_rows row
    join public.drinking_window_reference_versions version on version.id = row.version_id
    where version.version_number = 3
      and row.release_id = '0ea70dd0-a315-4fff-f438-c9b3ed5fe573'
      and row.format_ml = 750
      and row.first_trial_year = 2026 and row.best_start_year = 2032
      and row.best_end_year = 2042), 1::bigint,
    'Candidate dates and bottle size are copied as an exact-release row');
select is((select count(*) from public.drinking_window_ageing_groups g
    join public.drinking_window_reference_versions v on v.id = g.version_id
    where v.version_number = 3 and g.group_key = 'test-group'), 1::bigint,
    'Ageing groups are carried forward');
select is((select count(*) from public.drinking_window_ageing_group_memberships m
    join public.drinking_window_ageing_groups g on g.id = m.group_id
    join public.drinking_window_reference_versions v on v.id = m.version_id
    where v.version_number = 3 and g.group_key = 'test-group'), 1::bigint,
    'Memberships point to their cloned group');
select is((select count(*) from public.drinking_window_reference_evidence link
    join public.drinking_window_reference_versions version on version.id = link.version_id
    where version.version_number = 3),
    (select count(*) from public.drinking_window_reference_evidence link
    where link.version_id = private.enrichment_seed_uuid(
        'drinking-window:burgaud-cote-du-py-2022-750:v2')),
    'Existing evidence links are carried forward');
select is((select count(*) from public.drinking_window_reference_evidence link
    join private.drinking_window_candidate_stagings stage
      on stage.reference_row_id = link.reference_row_id), 0::bigint,
    'Suggestion URLs are not misrepresented as reviewed evidence');
select is((select count(*) from public.drinking_window_reference_reviews review
    join public.drinking_window_reference_versions version on version.id = review.version_id
    where version.version_number = 3), 0::bigint,
    'Curator approvals are not copied to new subjects');

select * from finish();
rollback;
