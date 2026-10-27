begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

create function pg_temp.refresh_rejects(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select has_function('public', 'request_drinking_window_draft_shadow_report',
    array['uuid'], 'An owner can request a new private draft comparison');
select ok(has_function_privilege('authenticated',
    'public.request_drinking_window_draft_shadow_report(uuid)', 'EXECUTE')
    and not has_function_privilege('anon',
    'public.request_drinking_window_draft_shadow_report(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
    'public.record_drinking_window_shadow_report(uuid,uuid)', 'EXECUTE'),
    'Only authenticated callers reach the scoped wrapper, not the raw recorder');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(pg_temp.refresh_rejects($test$
    select public.request_drinking_window_draft_shadow_report(
        '00000000-0000-4000-8000-000000000100')
$test$, '22023'), 'An owner cannot discover a draft never shared with them');
reset role;

select ok((select report_id is not null
    from public.record_drinking_window_shadow_report(
        private.enrichment_seed_uuid(
            'drinking-window:burgaud-cote-du-py-2022-750:v2'),
    '00000000-0000-4000-8000-000000000100')),
    'Trusted service can seed an owner-bound draft report');
select set_config('test.draft_refresh_first_report', (
    select id::text from private.drinking_window_shadow_reports
    where household_id = '00000000-0000-4000-8000-000000000100'
      and requested_by = '00000000-0000-4000-8000-000000000001'
    order by report_sequence desc limit 1), true);
select set_config('test.draft_refresh_first_hash', (
    select content_sha256 from private.drinking_window_shadow_reports
    where id = current_setting('test.draft_refresh_first_report')::uuid), true);

set local role authenticated;
select ok(public.review_drinking_window_shadow_report(
    current_setting('test.draft_refresh_first_report')::uuid,
    current_setting('test.draft_refresh_first_hash'),
    'reject', 'I reviewed this complete draft comparison') is not null,
    'The owner can record a decision on the first comparison');
select is(public.request_drinking_window_draft_shadow_report(
    '00000000-0000-4000-8000-000000000100'),
    current_setting('test.draft_refresh_first_report')::uuid,
    'Refreshing an unchanged draft reuses the exact decided report');
reset role;
select is((select count(*) from private.drinking_window_shadow_reports
    where household_id = '00000000-0000-4000-8000-000000000100'
      and requested_by = '00000000-0000-4000-8000-000000000001'
      and version_id = private.enrichment_seed_uuid(
          'drinking-window:burgaud-cote-du-py-2022-750:v2')),
    1::bigint, 'An unchanged refresh creates no duplicate report');
select is((select decision.verdict from private.drinking_window_shadow_decisions decision
    where decision.report_id =
        current_setting('test.draft_refresh_first_report')::uuid
    order by decision.decision_sequence desc limit 1),
    'reject', 'The previous owner decision remains on the current report');

update public.wines set area = 'Beaujolais'
where id = '00000000-0000-4000-8000-000000000110';
set local role authenticated;
select isnt(public.request_drinking_window_draft_shadow_report(
    '00000000-0000-4000-8000-000000000100'),
    current_setting('test.draft_refresh_first_report')::uuid,
    'Editing a wine creates a new comparison requiring a new decision');
reset role;
select isnt((select content_sha256 from private.drinking_window_shadow_reports
    where household_id = '00000000-0000-4000-8000-000000000100'
      and requested_by = '00000000-0000-4000-8000-000000000001'
    order by report_sequence desc limit 1),
    current_setting('test.draft_refresh_first_hash'),
    'The new snapshot reflects the edited cellar');
select is((select count(*) from private.drinking_window_shadow_reports
    where household_id = '00000000-0000-4000-8000-000000000100'
      and requested_by = '00000000-0000-4000-8000-000000000001'
      and version_id = private.enrichment_seed_uuid(
          'drinking-window:burgaud-cote-du-py-2022-750:v2')),
    2::bigint, 'Only the actual cellar change creates a second immutable report');
select is((select decision.verdict from private.drinking_window_shadow_decisions decision
    where decision.report_id =
        current_setting('test.draft_refresh_first_report')::uuid
    order by decision.decision_sequence desc limit 1),
    'reject', 'The old decision remains in history after a real change');
select ok(not exists (
    select 1 from private.drinking_window_shadow_decisions decision
    where decision.report_id = (
        select report.id from private.drinking_window_shadow_reports report
        where report.household_id = '00000000-0000-4000-8000-000000000100'
          and report.requested_by = '00000000-0000-4000-8000-000000000001'
        order by report.report_sequence desc limit 1)),
    'The changed comparison does not inherit consent automatically');
select set_config('test.draft_refresh_changed_report', (
    select report.id::text from private.drinking_window_shadow_reports report
    where report.household_id = '00000000-0000-4000-8000-000000000100'
      and report.requested_by = '00000000-0000-4000-8000-000000000001'
    order by report.report_sequence desc limit 1), true);
set local role authenticated;
select is(public.request_drinking_window_draft_shadow_report(
    '00000000-0000-4000-8000-000000000100'),
    current_setting('test.draft_refresh_changed_report')::uuid,
    'A second unchanged refresh also reuses the current comparison');
reset role;
select is((select count(*) from private.drinking_window_shadow_reports
    where household_id = '00000000-0000-4000-8000-000000000100'
      and requested_by = '00000000-0000-4000-8000-000000000001'
      and version_id = private.enrichment_seed_uuid(
          'drinking-window:burgaud-cote-du-py-2022-750:v2')),
    2::bigint, 'Repeated unchanged refreshes do not accumulate snapshots');

insert into auth.users (id, email) values
    ('f9000000-0000-4000-8000-000000000001',
     'second-draft-refresh-owner@example.test');
insert into public.household_members (household_id, user_id, role) values
    ('00000000-0000-4000-8000-000000000100',
     'f9000000-0000-4000-8000-000000000001', 'owner');
set local request.jwt.claim.sub = 'f9000000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(pg_temp.refresh_rejects($test$
    select public.request_drinking_window_draft_shadow_report(
        '00000000-0000-4000-8000-000000000100')
$test$, '22023'), 'Another owner cannot use someone else’s private report');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select ok(pg_temp.refresh_rejects($test$
    select public.request_drinking_window_draft_shadow_report(
        '00000000-0000-4000-8000-000000000100')
$test$, '42501'), 'A member of another household cannot refresh this draft');
reset role;
select is((select status from public.drinking_window_reference_versions
    where id = private.enrichment_seed_uuid(
        'drinking-window:burgaud-cote-du-py-2022-750:v2')),
    'draft', 'Refreshing did not publish or activate the draft');

select * from finish();
rollback;
