begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- The synthetic seed's first owner is both an explicitly authorized curator
-- and publisher for this rollback-only test. Neither role is granted live by
-- the feature migration.
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('00000000-0000-4000-8000-000000000001', 'Synthetic pilot reviewer',
    array['drinking-window'], 'Synthetic in-app publication integration test.',
    'database-test');
insert into private.drinking_window_publishers (user_id, granted_by, rationale)
values ('00000000-0000-4000-8000-000000000001', 'database-test',
    'Synthetic publisher grant for the rollback-only integration test.');
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
select set_config('app.test_report', public.request_drinking_window_working_draft_pilot(
    current_setting('app.test_version')::uuid,
    '00000000-0000-4000-8000-000000000100')::text, true);
reset role;
select ok((select exists(select 1 from pg_catalog.jsonb_array_elements(report.rows) item
    where item ->> 'draft_status' = 'draft_match')
    from private.drinking_window_shadow_reports report
    where report.id = current_setting('app.test_report')::uuid),
    'The owner-facing comparison includes the actual matched wine');
select set_config('app.test_report_hash', (select content_sha256
    from private.drinking_window_shadow_reports
    where id = current_setting('app.test_report')::uuid), true);
set local role authenticated;
select ok(public.review_drinking_window_shadow_report(
    current_setting('app.test_report')::uuid, current_setting('app.test_report_hash'),
    'approve', 'I accept this exact comparison for my cellar') is not null,
    'The cellar owner accepts the whole-cellar comparison in the app');
select is((public.publish_reviewed_drinking_window_draft(
    current_setting('app.test_version')::uuid) ->> 'reviewed_household_count')::integer, 1,
    'The separately authorized in-app publisher activates only the approved pilot');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source', 'reviewed_reference',
    'The pilot wine now receives the reviewed producer/release dates');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select ok(public.get_wine_maturity('00000000-0000-4000-8000-000000000210')
    ->> 'effective_source' <> 'reviewed_reference',
    'The other household remains unchanged');

select * from finish();
rollback;
