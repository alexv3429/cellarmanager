begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- One authorized curator reviews, previews and publishes for all cellars.
-- Neither a separate publisher grant nor household approval is required.
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('00000000-0000-4000-8000-000000000001', 'Synthetic pilot reviewer',
    array['drinking-window'], 'Synthetic in-app publication integration test.',
    'database-test');
select set_config('app.test_version', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);
select set_config('app.test_row', (select id::text from public.drinking_window_reference_rows
    where version_id = current_setting('app.test_version')::uuid), true);
select set_config('app.test_hash', private.drinking_window_review_subject_hash(
    current_setting('app.test_version')::uuid, 'row',
    current_setting('app.test_row')::uuid), true);
update public.wines set producer = 'Jean-Marc Burgaud', cuvee = 'Côte du Py',
    vintage = 2022, color = 'red', area = 'Beaujolais', appellation = 'Morgon',
    format_ml = 750
where id = '00000000-0000-4000-8000-000000000110';
update public.wines set wine_reference_type = 'release',
    wine_reference_id = (select release_id from public.drinking_window_reference_rows
        where id = current_setting('app.test_row')::uuid)
where id = '00000000-0000-4000-8000-000000000110';
update public.wines set producer = 'Jean-Marc Burgaud', cuvee = 'Côte du Py',
    vintage = 2022, color = 'red', area = 'Beaujolais', appellation = 'Morgon',
    format_ml = 750
where id = '00000000-0000-4000-8000-000000000210';
update public.wines set wine_reference_type = 'release',
    wine_reference_id = (select release_id from public.drinking_window_reference_rows
        where id = current_setting('app.test_row')::uuid)
where id = '00000000-0000-4000-8000-000000000210';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select ok(public.record_drinking_window_reference_review(
    current_setting('app.test_version')::uuid, 'row',
    current_setting('app.test_row')::uuid, current_setting('app.test_hash'),
    'approve', 'I reviewed this exact release and its linked evidence.') is not null,
    'The owner-curator can approve the exact three-date draft in the app');
select is((public.check_drinking_window_working_draft(
    current_setting('app.test_version')::uuid) ->> 'issue_count')::integer, 0,
    'The in-app preflight accepts the fully reviewed draft');
select is((public.preview_drinking_window_publication_impact(
    current_setting('app.test_version')::uuid) ->> 'matched_count')::integer, 2,
    'The required impact preview sees both cellars without exposing wine details');
select is((public.publish_reviewed_drinking_window_draft(
    current_setting('app.test_version')::uuid) ->> 'reviewed_household_count')::integer, 0,
    'The same curator publishes without separate permission or owner approval');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source', 'reviewed_reference',
    'The first cellar now receives the reviewed exact release dates');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000210')
    ->> 'effective_source', 'reviewed_reference',
    'The other cellar receives the publication without an owner opt-in');

select * from finish();
rollback;
