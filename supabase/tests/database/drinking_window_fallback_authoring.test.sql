begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id, email)
values ('f9500000-0000-4000-8000-000000000001', 'fallback-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9500000-0000-4000-8000-000000000001', 'Fallback Curator',
    array['drinking-window'], 'Synthetic fallback curator for this test.', 'database-test');
select set_config('app.test_version', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);
select set_config('app.test_region', private.enrichment_seed_uuid('place:beaujolais')::text, true);
select set_config('app.test_place', private.enrichment_seed_uuid('place:morgon')::text, true);

set local role authenticated;
set local request.jwt.claim.sub = 'f9500000-0000-4000-8000-000000000001';
select ok(jsonb_array_length(public.search_drinking_window_curation_targets(
    'region','Beaujolais')) > 0, 'A curator can search exact region identities');
select set_config('app.test_group', public.create_drinking_window_ageing_group(
    current_setting('app.test_version')::uuid, 'region',
    current_setting('app.test_region')::uuid, null, null, 'red',
    'long_ageing_test', 'Long-ageing Beaujolais releases, individually reviewed.')::text, true);
select is(jsonb_array_length(public.get_drinking_window_authoring_groups(
    current_setting('app.test_version')::uuid)), 1,
    'The new explicit ageing group appears in authoring');
select set_config('app.test_member', public.add_drinking_window_group_membership(
    current_setting('app.test_group')::uuid, 'release',
    '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
    current_setting('app.test_place')::uuid, 2022, 2022,
    'This exact James release belongs in the long-ageing group.')::text, true);
select set_config('app.test_row', public.add_drinking_window_group_year(
    current_setting('app.test_group')::uuid, 2022, 2026, 2030, 2038,
    'Synthetic editorial estimate for the reviewed long-ageing release.')::text, true);
reset role;

select set_config('app.test_group_hash', private.drinking_window_review_subject_hash(
    current_setting('app.test_version')::uuid, 'group', current_setting('app.test_group')::uuid), true);
select set_config('app.test_member_hash', private.drinking_window_review_subject_hash(
    current_setting('app.test_version')::uuid, 'membership', current_setting('app.test_member')::uuid), true);
select set_config('app.test_row_hash', private.drinking_window_review_subject_hash(
    current_setting('app.test_version')::uuid, 'row', current_setting('app.test_row')::uuid), true);

set local role authenticated;
select set_config('app.test_group_evidence',
    public.attest_drinking_window_editorial_context(
        current_setting('app.test_version')::uuid, 'group',
        current_setting('app.test_group')::uuid, current_setting('app.test_group_hash'),
        'I reviewed this group as a long-ageing Beaujolais subset, not every red Beaujolais.',
        array['https://example.test/region-context'], true) ->> 'evidence_id', true);
select set_config('app.test_member_evidence',
    public.attest_drinking_window_editorial_context(
        current_setting('app.test_version')::uuid, 'membership',
        current_setting('app.test_member')::uuid, current_setting('app.test_member_hash'),
        'I reviewed this exact 2022 release as eligible for the long-ageing group.',
        array['https://example.test/james-context'], true) ->> 'evidence_id', true);
select set_config('app.test_row_evidence',
    public.attest_drinking_window_editorial_estimate(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_row')::uuid, current_setting('app.test_row_hash'),
        'These three dates are a reviewed editorial estimate, not published by the producer.',
        array['https://example.test/james-context'], true) ->> 'evidence_id', true);
select is(public.get_drinking_window_editorial_context(
    current_setting('app.test_member_evidence')::uuid) ->> 'subject_kind',
    'membership', 'The in-app note explains the reviewed membership');
reset role;

select is((select count(*) from public.drinking_window_eligibility_issues(
    current_setting('app.test_version')::uuid) where subject_id in (
        current_setting('app.test_group')::uuid,
        current_setting('app.test_member')::uuid,
        current_setting('app.test_row')::uuid)), 0::bigint,
    'The explicit group, release membership and vintage row have coherent eligibility');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    current_setting('app.test_version')::uuid) where subject_id in (
        current_setting('app.test_group')::uuid,
        current_setting('app.test_member')::uuid,
        current_setting('app.test_row')::uuid)), 0::bigint,
    'Editorial evidence is scoped to the group, release and vintage it supports');

select * from finish();
rollback;
