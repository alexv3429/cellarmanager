begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

create function pg_temp.shadow_rejects(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select has_function('public', 'record_drinking_window_shadow_report',
    array['uuid', 'uuid'], 'Service can record a complete private shadow report');
select has_function('public', 'get_drinking_window_shadow_report',
    array['uuid'], 'Owner can inspect a private shadow report');
select has_function('public', 'review_drinking_window_shadow_report',
    array['uuid', 'text', 'text', 'text'], 'Owner can explicitly review a report');
select ok(
    has_function_privilege('service_role',
        'public.record_drinking_window_shadow_report(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.record_drinking_window_shadow_report(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated',
        'public.get_drinking_window_shadow_report(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated',
        'public.review_drinking_window_shadow_report(uuid,text,text,text)', 'EXECUTE'),
    'Only trusted service records reports; owners read and decide');
select ok(
    not has_table_privilege('authenticated',
        'private.drinking_window_shadow_reports', 'SELECT')
    and not has_table_privilege('service_role',
        'private.drinking_window_shadow_reports', 'SELECT')
    and not has_table_privilege('authenticated',
        'private.drinking_window_shadow_decisions', 'INSERT'),
    'Raw report and decision tables have no direct API grants');

insert into public.enrichment_places (id, place_type, canonical_name)
values ('f5000000-0000-4000-8000-000000000001', 'region',
    'Synthetic Shadow Review Region');
insert into public.drinking_window_reference_versions (id, version_number)
values ('f5000000-0000-4000-8000-000000000002', 991812);
insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     all_at_scope, first_trial_year, best_start_year, best_end_year, rationale)
values ('f5000000-0000-4000-8000-000000000003',
    'f5000000-0000-4000-8000-000000000002', 'region',
    'f5000000-0000-4000-8000-000000000001', 'white', 2022,
    true, 2024, 2026, 2031, 'Synthetic complete shadow review window');
update public.wines set area = 'Synthetic Shadow Review Region',
    vintage = 2022, color = 'white'
where id = '00000000-0000-4000-8000-000000000110';

select ok((select draft_issue_count > 0 and wine_count = 1
    from public.record_drinking_window_shadow_report(
        'f5000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000100')),
    'An incomplete draft produces an issue-bearing report, not approval');
select is((select jsonb_array_length(rows)
    from private.drinking_window_shadow_reports
    where version_id = 'f5000000-0000-4000-8000-000000000002'),
    1, 'The private snapshot covers the whole household');
do $$ begin
    perform set_config('test.shadow_report_id', (
        select id::text from private.drinking_window_shadow_reports
        where version_id = 'f5000000-0000-4000-8000-000000000002'
        order by recorded_at limit 1
    ), true);
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select ok(pg_temp.shadow_rejects(format(
    'select public.get_drinking_window_shadow_report(%L::uuid)',
    current_setting('test.shadow_report_id')), '42501'),
    'Another household cannot read the report');
reset role;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select ok((select public.get_drinking_window_shadow_report(id) ->> 'wine_count' = '1'
    from private.drinking_window_shadow_reports
    where version_id = 'f5000000-0000-4000-8000-000000000002'
    order by recorded_at limit 1),
    'The owner can inspect the exact one-wine snapshot');
select ok(pg_temp.shadow_rejects(format(
    'select public.review_drinking_window_shadow_report(%L::uuid,%L,%L,%L)',
    (select id from private.drinking_window_shadow_reports
     where version_id = 'f5000000-0000-4000-8000-000000000002'
     order by recorded_at limit 1),
    (select content_sha256 from private.drinking_window_shadow_reports
     where version_id = 'f5000000-0000-4000-8000-000000000002'
     order by recorded_at limit 1), 'approve',
    'I reviewed all changed windows'), '23514'),
    'An issue-bearing draft cannot receive owner approval');

insert into public.enrichment_sources (id, source_key, source_name, source_kind)
values ('f5000000-0000-4000-8000-000000000004',
    'synthetic-shadow-review', 'Synthetic Shadow Source', 'cellarmanager');
insert into public.enrichment_source_policies
    (id, source_id, policy_version, effective_from, status,
     terms_checked_on, evidence_url, display_right, normalized_storage_right,
     raw_payload_storage_right, offline_sync_right, retention_right,
     cross_household_reuse_right)
values ('f5000000-0000-4000-8000-000000000005',
    'f5000000-0000-4000-8000-000000000004', 1, current_date, 'reviewed',
    current_date, 'https://example.test/shadow-policy',
    'allowed', 'allowed', 'prohibited', 'prohibited', 'allowed', 'allowed');
insert into public.enrichment_evidence
    (id, source_id, source_policy_id, source_record_url, content_mode,
     claim_type, scope_level, place_id, vintage_year, wine_color,
     review_status, reviewed_at)
values ('f5000000-0000-4000-8000-000000000006',
    'f5000000-0000-4000-8000-000000000004',
    'f5000000-0000-4000-8000-000000000005',
    'https://example.test/shadow-window', 'pointer-only',
    'maturity-window', 'vintage',
    'f5000000-0000-4000-8000-000000000001', 2022, 'white',
    'reviewed', now());
insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part)
values
    ('f5000000-0000-4000-8000-000000000002',
     'f5000000-0000-4000-8000-000000000003',
     'f5000000-0000-4000-8000-000000000006', 'first_trial'),
    ('f5000000-0000-4000-8000-000000000002',
     'f5000000-0000-4000-8000-000000000003',
     'f5000000-0000-4000-8000-000000000006', 'optimal_period');
insert into auth.users (id, email)
values ('f5000000-0000-4000-8000-000000000007',
    'shadow-review-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f5000000-0000-4000-8000-000000000007',
    'Shadow Curator', array['drinking-window'],
    'Synthetic curator grant for shadow review tests.', 'database-test');
insert into public.drinking_window_reference_reviews
    (version_id, reference_row_id, curator_id, verdict, rationale)
values ('f5000000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000003',
    'f5000000-0000-4000-8000-000000000007', 'approve',
    'The three milestones and source evidence are approved.');

select is((select count(*) from public.drinking_window_publication_issues(
    'f5000000-0000-4000-8000-000000000002')),
    0::bigint, 'Curated synthetic draft has no preflight issues');
select is((select issue_count from public.record_drinking_window_publication_preflight(
    'f5000000-0000-4000-8000-000000000002')),
    0, 'Zero-issue publication preflight is recorded');
select is((select draft_issue_count
    from public.record_drinking_window_shadow_report(
        'f5000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000100')),
    0::bigint, 'Fresh whole-household shadow report is ready for review');
select is((select requested_by from private.drinking_window_shadow_reports
    where version_id = 'f5000000-0000-4000-8000-000000000002'
      and draft_issue_count = 0),
    '00000000-0000-4000-8000-000000000001'::uuid,
    'Fresh report is bound to the owner whose dates it compared');
insert into auth.users (id, email) values
    ('f5000000-0000-4000-8000-000000000008',
     'second-shadow-owner@example.test');
insert into public.household_members (household_id, user_id, role) values
    ('00000000-0000-4000-8000-000000000100',
     'f5000000-0000-4000-8000-000000000008', 'owner');
select set_config('request.jwt.claim.sub',
    'f5000000-0000-4000-8000-000000000008', true);
select is(jsonb_array_length(public.list_drinking_window_shadow_reports(
    '00000000-0000-4000-8000-000000000100')), 0,
    'Another owner is not shown a report with someone else’s timing');
select ok(pg_temp.shadow_rejects(format(
    'select public.review_drinking_window_shadow_report(%L::uuid,%L,%L,%L)',
    (select id from private.drinking_window_shadow_reports
     where version_id = 'f5000000-0000-4000-8000-000000000002'
       and requested_by = '00000000-0000-4000-8000-000000000001'
       and draft_issue_count = 0),
    (select content_sha256 from private.drinking_window_shadow_reports
     where version_id = 'f5000000-0000-4000-8000-000000000002'
       and requested_by = '00000000-0000-4000-8000-000000000001'
       and draft_issue_count = 0),
    'approve', 'I reviewed all changed windows'), '42501'),
    'Another owner cannot approve dates calculated for someone else');
select set_config('request.jwt.claim.sub',
    '00000000-0000-4000-8000-000000000001', true);

select ok(pg_temp.shadow_rejects(format(
    'select public.review_drinking_window_shadow_report(%L::uuid,%L,%L,%L)',
    (select id from private.drinking_window_shadow_reports
     where version_id = 'f5000000-0000-4000-8000-000000000002'
       and draft_issue_count = 0),
    repeat('0', 64), 'approve', 'I reviewed all changed windows'), '22023'),
    'Wrong report fingerprint cannot be approved');

select ok((select public.review_drinking_window_shadow_report(
    id, content_sha256, 'approve', 'I reviewed every changed window') is not null
    from private.drinking_window_shadow_reports
    where version_id = 'f5000000-0000-4000-8000-000000000002'
      and draft_issue_count = 0),
    'Owner can approve the exact clean, current full-cellar report');
select is((select public.get_drinking_window_shadow_report(id)
        -> 'latest_decision' ->> 'verdict'
    from private.drinking_window_shadow_reports
    where version_id = 'f5000000-0000-4000-8000-000000000002'
      and draft_issue_count = 0),
    'approve', 'Owner sees the recorded latest decision');
select set_config('request.jwt.claim.sub',
    'f5000000-0000-4000-8000-000000000008', true);
select is((select draft_issue_count
    from public.record_drinking_window_shadow_report(
        'f5000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000100')),
    0::bigint, 'A second owner can request their own fresh comparison');
select set_config('request.jwt.claim.sub',
    '00000000-0000-4000-8000-000000000001', true);
select ok(pg_temp.shadow_rejects(format(
    'select public.review_drinking_window_shadow_report(%L::uuid,%L,%L,%L)',
    (select id from private.drinking_window_shadow_reports
     where version_id = 'f5000000-0000-4000-8000-000000000002'
       and requested_by = '00000000-0000-4000-8000-000000000001'
       and draft_issue_count = 0),
    (select content_sha256 from private.drinking_window_shadow_reports
     where version_id = 'f5000000-0000-4000-8000-000000000002'
       and requested_by = '00000000-0000-4000-8000-000000000001'
       and draft_issue_count = 0),
    'approve', 'I reviewed all changed windows'), '40001'),
    'A later household comparison makes an earlier approval stale');

update public.wines set vintage = 2023
where id = '00000000-0000-4000-8000-000000000110';
select ok(pg_temp.shadow_rejects(format(
    'select public.review_drinking_window_shadow_report(%L::uuid,%L,%L,%L)',
    (select id from private.drinking_window_shadow_reports
     where version_id = 'f5000000-0000-4000-8000-000000000002'
       and requested_by = '00000000-0000-4000-8000-000000000001'
       and draft_issue_count = 0),
    (select content_sha256 from private.drinking_window_shadow_reports
     where version_id = 'f5000000-0000-4000-8000-000000000002'
       and requested_by = '00000000-0000-4000-8000-000000000001'
       and draft_issue_count = 0),
    'approve', 'I reviewed all changed windows'), '40001'),
    'A changed cellar invalidates the old snapshot');
select ok(pg_temp.shadow_rejects($test$
    update private.drinking_window_shadow_reports set wine_count = 2
    where version_id = 'f5000000-0000-4000-8000-000000000002'
$test$, '23514'), 'Private report history cannot be edited');
select ok(pg_temp.shadow_rejects($test$
    update public.drinking_window_reference_versions set status = 'active'
    where id = 'f5000000-0000-4000-8000-000000000002'
$test$, '23514'), 'Owner approval does not enable publication');

select * from finish();
rollback;
