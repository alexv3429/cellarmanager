begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id, email)
values ('f9600000-0000-4000-8000-000000000001', 'correction-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9600000-0000-4000-8000-000000000001', 'Correction Curator',
    array['drinking-window'], 'Synthetic fallback correction curator.', 'database-test');
select set_config('app.test_version', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);
select set_config('app.test_region', private.enrichment_seed_uuid('place:beaujolais')::text, true);
select set_config('app.test_place', private.enrichment_seed_uuid('place:morgon')::text, true);

set local role authenticated;
set local request.jwt.claim.sub = 'f9600000-0000-4000-8000-000000000001';
select set_config('app.test_group', public.create_drinking_window_ageing_group(
    current_setting('app.test_version')::uuid, 'region',
    current_setting('app.test_region')::uuid, null, null, 'red',
    'long_ageing_correction', 'Individually reviewed long-ageing red Beaujolais releases.')::text, true);
select set_config('app.test_member', public.add_drinking_window_group_membership(
    current_setting('app.test_group')::uuid, 'release',
    '0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
    current_setting('app.test_place')::uuid, 2022, 2022,
    'This exact James release belongs in the reviewed long-ageing group.')::text, true);
select set_config('app.test_row', public.add_drinking_window_group_year(
    current_setting('app.test_group')::uuid, 2022, 2026, 2030, 2038,
    'First synthetic estimate for the reviewed long-ageing group.')::text, true);
select ok(public.get_drinking_window_fallback_subject(
    current_setting('app.test_version')::uuid, 'membership',
    current_setting('app.test_member')::uuid) ->> 'target_label' is not null,
    'The correction UI can display the current canonical member identity');
select set_config('app.row_before', public.get_drinking_window_fallback_subject(
    current_setting('app.test_version')::uuid, 'row',
    current_setting('app.test_row')::uuid) ->> 'hash', true);
select set_config('app.test_evidence', public.attest_drinking_window_editorial_estimate(
    current_setting('app.test_version')::uuid,
    current_setting('app.test_row')::uuid, current_setting('app.row_before'),
    'I reviewed these three synthetic dates as an editorial estimate, not a producer claim.',
    array['https://example.test/window'], true) ->> 'evidence_id', true);
select set_config('app.row_with_evidence', public.get_drinking_window_fallback_subject(
    current_setting('app.test_version')::uuid, 'row',
    current_setting('app.test_row')::uuid) ->> 'hash', true);
select set_config('app.row_after', public.correct_drinking_window_fallback_subject(
    current_setting('app.test_version')::uuid, 'row',
    current_setting('app.test_row')::uuid, current_setting('app.row_with_evidence'),
    '{"first_trial_year":2026,"best_start_year":2031,"best_end_year":2040,
      "rationale":"Corrected synthetic window after a more precise review."}'::jsonb), true);
select isnt(current_setting('app.row_after'), current_setting('app.row_with_evidence'),
    'Correcting dates changes the review hash');
reset role;
select is((select count(*) from public.drinking_window_reference_evidence
    where reference_row_id = current_setting('app.test_row')::uuid), 0::bigint,
    'Old date evidence is removed, not misrepresented as support for corrected dates');
select is((select count(*) from private.drinking_window_fallback_corrections
    where subject_id = current_setting('app.test_row')::uuid), 1::bigint,
    'The date correction is retained in an immutable audit record');
set local role authenticated;
select throws_ok($q$select public.correct_drinking_window_fallback_subject(
    current_setting('app.test_version')::uuid, 'row',
    current_setting('app.test_row')::uuid, current_setting('app.row_with_evidence'),
    '{"first_trial_year":2026,"best_start_year":2031,"best_end_year":2040,
      "rationale":"Corrected synthetic window after a more precise review."}'::jsonb)$q$,
    '40001', 'This subject changed; refresh before correcting it',
    'A stale form cannot silently overwrite a changed draft');

select set_config('app.group_before', public.get_drinking_window_fallback_subject(
    current_setting('app.test_version')::uuid, 'group',
    current_setting('app.test_group')::uuid) ->> 'hash', true);
select set_config('app.group_after', public.correct_drinking_window_fallback_subject(
    current_setting('app.test_version')::uuid, 'group',
    current_setting('app.test_group')::uuid, current_setting('app.group_before'),
    '{"group_key":"reviewed_long_ageing", "definition":
      "Only individually reviewed long-ageing Beaujolais red releases."}'::jsonb), true);
select isnt(current_setting('app.group_after'), current_setting('app.group_before'),
    'A group correction changes its review hash');

select set_config('app.member_before', public.get_drinking_window_fallback_subject(
    current_setting('app.test_version')::uuid, 'membership',
    current_setting('app.test_member')::uuid) ->> 'hash', true);
select set_config('app.member_after', public.correct_drinking_window_fallback_subject(
    current_setting('app.test_version')::uuid, 'membership',
    current_setting('app.test_member')::uuid, current_setting('app.member_before'),
    pg_catalog.jsonb_build_object('member_kind','release',
      'target_id','0ea70dd0-a315-4fff-f438-c9b3ed5fe573',
      'place_id',current_setting('app.test_place'),
      'first_vintage_year',2022,'last_vintage_year',2022,
      'rationale','This exact James release now has a more precise eligibility rationale.')),
    true);
select isnt(current_setting('app.member_after'), current_setting('app.member_before'),
    'A membership correction changes its review hash');
reset role;

select is((select count(*) from private.drinking_window_fallback_corrections
    where version_id = current_setting('app.test_version')::uuid), 3::bigint,
    'Date, group and membership corrections are all audited');

select * from finish();
rollback;
