begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.publication_rejects(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select ok(has_function_privilege('authenticated',
    'public.publish_reviewed_drinking_window_draft(uuid)', 'EXECUTE')
    and not has_function_privilege('anon',
    'public.publish_reviewed_drinking_window_draft(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
    'public.publish_drinking_window_reference(uuid)', 'EXECUTE'),
    'Signed-in curators use the checked in-app publisher; anonymous callers are denied');
select ok(has_function_privilege('authenticated',
    'public.list_drinking_window_shadow_reports(uuid)', 'EXECUTE')
    and not has_table_privilege('authenticated',
    'private.drinking_window_publications', 'SELECT'),
    'Owners use a scoped report list, not raw publication tables');

insert into public.enrichment_places (id, place_type, canonical_name)
values ('f6000000-0000-4000-8000-000000000001', 'region',
    'Synthetic Published Region');
insert into public.drinking_window_reference_versions (id, version_number)
values ('f6000000-0000-4000-8000-000000000002', 991813);
insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     all_at_scope, first_trial_year, best_start_year, best_end_year, rationale)
values ('f6000000-0000-4000-8000-000000000003',
    'f6000000-0000-4000-8000-000000000002', 'region',
    'f6000000-0000-4000-8000-000000000001', 'white', 2022,
    true, 2024, 2026, 2031, 'Synthetic three-milestone published window');
update public.wines set area = 'Synthetic Published Region',
    vintage = 2022, color = 'white', appellation = null,
    wine_reference_id = null, wine_reference_type = null
where id = '00000000-0000-4000-8000-000000000110';
update public.wines set area = 'Synthetic Published Region',
    vintage = 2022, color = 'white', appellation = null,
    wine_reference_id = null, wine_reference_type = null
where id = '00000000-0000-4000-8000-000000000210';

select ok(pg_temp.publication_rejects($test$
    update public.drinking_window_reference_versions set status = 'active'
    where id = 'f6000000-0000-4000-8000-000000000002'
$test$, '23514'), 'Direct activation remains blocked');
select ok(pg_temp.publication_rejects($test$
    select public.publish_drinking_window_reference(
        'f6000000-0000-4000-8000-000000000002')
$test$, '42501'), 'A caller without curator permission cannot publish');

insert into public.enrichment_sources (id, source_key, source_name, source_kind)
values ('f6000000-0000-4000-8000-000000000004',
    'synthetic-published-window', 'Synthetic Published Source', 'cellarmanager');
insert into public.enrichment_source_policies
    (id, source_id, policy_version, effective_from, status,
     terms_checked_on, evidence_url, display_right, normalized_storage_right,
     raw_payload_storage_right, offline_sync_right, retention_right,
     cross_household_reuse_right)
values ('f6000000-0000-4000-8000-000000000005',
    'f6000000-0000-4000-8000-000000000004', 1, current_date, 'reviewed',
    current_date, 'https://example.test/published-policy',
    'allowed', 'allowed', 'prohibited', 'prohibited', 'allowed', 'allowed');
insert into public.enrichment_evidence
    (id, source_id, source_policy_id, source_record_url, content_mode,
     claim_type, scope_level, place_id, vintage_year, wine_color,
     review_status, reviewed_at)
values ('f6000000-0000-4000-8000-000000000006',
    'f6000000-0000-4000-8000-000000000004',
    'f6000000-0000-4000-8000-000000000005',
    'https://example.test/published-window', 'pointer-only',
    'maturity-window', 'vintage',
    'f6000000-0000-4000-8000-000000000001', 2022, 'white',
    'reviewed', now());
insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part)
values
    ('f6000000-0000-4000-8000-000000000002',
     'f6000000-0000-4000-8000-000000000003',
     'f6000000-0000-4000-8000-000000000006', 'first_trial'),
    ('f6000000-0000-4000-8000-000000000002',
     'f6000000-0000-4000-8000-000000000003',
     'f6000000-0000-4000-8000-000000000006', 'optimal_period');
insert into auth.users (id, email)
values ('f6000000-0000-4000-8000-000000000007',
    'published-window-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f6000000-0000-4000-8000-000000000007',
    'Publication Curator', array['drinking-window'],
    'Synthetic curator grant for publication tests.', 'database-test');
insert into public.drinking_window_reference_reviews
    (version_id, reference_row_id, curator_id, verdict, rationale)
values ('f6000000-0000-4000-8000-000000000002',
    'f6000000-0000-4000-8000-000000000003',
    'f6000000-0000-4000-8000-000000000007', 'approve',
    'The synthetic three-milestone window and evidence are approved.');
set local request.jwt.claim.sub = 'f6000000-0000-4000-8000-000000000007';

select is((select count(*) from public.drinking_window_publication_issues(
    'f6000000-0000-4000-8000-000000000002')), 0::bigint,
    'Complete reference has no publication issues');
select ok(pg_temp.publication_rejects($test$
    select public.publish_drinking_window_reference(
        'f6000000-0000-4000-8000-000000000002')
$test$, '23514'), 'Live gates alone do not replace a recorded preflight');
select is((select issue_count from public.record_drinking_window_publication_preflight(
    'f6000000-0000-4000-8000-000000000002')), 0,
    'Zero-issue preflight is recorded');
select ok(pg_temp.publication_rejects($test$
    select public.publish_drinking_window_reference(
        'f6000000-0000-4000-8000-000000000002')
$test$, '23514'), 'The curator must preview the publication impact first');
select ok((public.preview_drinking_window_publication_impact(
    'f6000000-0000-4000-8000-000000000002') ->> 'matched_count')::integer >= 2,
    'Curator previews affected wines across households');
select is((select reviewed_household_count from public.publish_drinking_window_reference(
    'f6000000-0000-4000-8000-000000000002')), 0,
    'Curator publishes directly; no cellar-owner pilot approval is required');
select is((select status from public.drinking_window_reference_versions
    where id = 'f6000000-0000-4000-8000-000000000002'),
    'active', 'Published version is the sole active reference');
select is((select count(*) from private.drinking_window_household_rollouts
    where version_id = 'f6000000-0000-4000-8000-000000000002'), 0::bigint,
    'Publication adds no household rollout records');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source', 'reviewed_reference',
    'Wine card selects the reviewed reference before any model result');
select is((public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    -> 'reference' ->> 'best_end_year')::integer, 2031,
    'Selected window uses the exact published row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000210')
    ->> 'effective_source', 'reviewed_reference',
    'Another household receives the same published reference without opting in');
select ok(pg_temp.publication_rejects($test$
    select public.request_drinking_window_shadow_report(
        '00000000-0000-4000-8000-000000000100')
$test$, '42501'), 'An owner cannot request another household comparison');
select is((public.get_drinking_window_rollout_status(
    '00000000-0000-4000-8000-000000000200') ->> 'selected_enabled')::boolean,
    true, 'Owner can see that the common reference is active');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is((public.get_household_maturity_overview(
    '00000000-0000-4000-8000-000000000100') -> 0 ->> 'effective_source'),
    'reviewed_reference', 'Catalogue overview uses the same published reference');
select is(public.set_drinking_window_reference_enabled(false,
    'f6000000-0000-4000-8000-000000000002',
    'Emergency rollback to the prior model'), false,
    'Trusted operator can disable the reference reader without erasing history');
select ok(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source' <> 'reviewed_reference',
    'Emergency switch restores the previous reader');
select public.set_drinking_window_reference_enabled(true,
    'f6000000-0000-4000-8000-000000000002',
    'Re-enable after validating the reference');
select ok(pg_temp.publication_rejects($test$
    update public.drinking_window_reference_rows set best_end_year = 2032
    where id = 'f6000000-0000-4000-8000-000000000003'
$test$, '23514'), 'Published reference content is immutable');

insert into public.wine_maturity_overrides
    (household_id, wine_id, first_trial_year, best_start_year,
     best_end_year, drink_by_year, created_by)
values ('00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    2025, 2027, 2033, 2036,
    '00000000-0000-4000-8000-000000000001');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source', 'manual',
    'Owner window takes precedence over the published reference');
select is((public.get_household_maturity_overview(
    '00000000-0000-4000-8000-000000000100') -> 0 ->> 'effective_source'),
    'manual', 'Catalogue agrees that the manual window wins');
delete from public.wine_maturity_overrides where
    wine_id = '00000000-0000-4000-8000-000000000110';
update public.wines set vintage = 2023
where id = '00000000-0000-4000-8000-000000000110';
select ok(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source' in ('model_estimate', 'unavailable'),
    'A nonmatching vintage falls back to the existing model or unavailable state');

select * from finish();
rollback;
