begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.rejects_with(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select ok(
    has_function_privilege('service_role',
        'public.drinking_window_publication_issues(uuid)', 'EXECUTE')
    and has_function_privilege('service_role',
        'public.drinking_window_draft_fingerprint(uuid)', 'EXECUTE')
    and has_function_privilege('service_role',
        'public.record_drinking_window_publication_preflight(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.drinking_window_publication_issues(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.drinking_window_draft_fingerprint(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.record_drinking_window_publication_preflight(uuid)', 'EXECUTE'),
    'Publication preflight is service-only'
);
select ok(
    not has_table_privilege('service_role',
        'private.drinking_window_publication_preflights', 'SELECT')
    and not has_table_privilege('authenticated',
        'private.drinking_window_publication_preflights', 'SELECT'),
    'Private preflight history has no direct service or browser grants'
);

insert into public.enrichment_places (id, place_type, canonical_name)
values ('fb000000-0000-4000-8000-000000000001', 'region',
    'Synthetic Preflight Region');
insert into public.drinking_window_reference_versions (id, version_number)
values ('fb000000-0000-4000-8000-000000000002', 991701);

select is(
    (select count(*) from public.drinking_window_publication_issues(
        'fb000000-0000-4000-8000-000000000002')
     where check_name = 'structure' and issue_code = 'empty_version'),
    1::bigint, 'An empty draft cannot pass structural preflight'
);
select ok(pg_temp.rejects_with($test$
    select public.drinking_window_draft_fingerprint(
        'fb000000-0000-4000-8000-000000000099')
$test$, '22023'), 'A missing draft cannot be fingerprinted');

insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     all_at_scope, first_trial_year, best_start_year, best_end_year, rationale)
values ('fb000000-0000-4000-8000-000000000003',
    'fb000000-0000-4000-8000-000000000002', 'region',
    'fb000000-0000-4000-8000-000000000001', 'white', 2022,
    true, 2025, 2027, 2032, 'Synthetic complete three-year preflight window');

select ok(
    exists (select 1 from public.drinking_window_publication_issues(
        'fb000000-0000-4000-8000-000000000002')
        where check_name = 'structure'
          and issue_code = 'missing_first_trial_support')
    and exists (select 1 from public.drinking_window_publication_issues(
        'fb000000-0000-4000-8000-000000000002')
        where check_name = 'structure'
          and issue_code = 'missing_optimal_period_support')
    and exists (select 1 from public.drinking_window_publication_issues(
        'fb000000-0000-4000-8000-000000000002')
        where check_name = 'review'
          and issue_code = 'missing_current_approval'),
    'Preflight combines missing evidence and curator review diagnostics'
);
select ok(
    public.drinking_window_draft_fingerprint(
        'fb000000-0000-4000-8000-000000000002') ~ '^[0-9a-f]{64}$',
    'A draft fingerprint is a 64-character SHA-256 value'
);

select ok(
    (select issue_count > 0 and content_sha256 ~ '^[0-9a-f]{64}$'
     from public.record_drinking_window_publication_preflight(
        'fb000000-0000-4000-8000-000000000002')),
    'An incomplete draft gets an issue-bearing audit record, not an approval'
);
select is(
    (select count(*) from private.drinking_window_publication_preflights
     where version_id = 'fb000000-0000-4000-8000-000000000002'),
    1::bigint, 'The preflight record is retained privately'
);
select ok(
    (select issues @> '[{"check":"review","code":"missing_current_approval"}]'::jsonb
     from private.drinking_window_publication_preflights
     where version_id = 'fb000000-0000-4000-8000-000000000002'),
    'The audit record contains attributable issue codes'
);

update public.drinking_window_reference_rows set best_end_year = 2033
where id = 'fb000000-0000-4000-8000-000000000003';
select isnt(
    (select content_sha256 from private.drinking_window_publication_preflights
     where version_id = 'fb000000-0000-4000-8000-000000000002'),
    public.drinking_window_draft_fingerprint(
        'fb000000-0000-4000-8000-000000000002'),
    'Editing a milestone makes the recorded fingerprint stale'
);
select ok(pg_temp.rejects_with($test$
    update private.drinking_window_publication_preflights
    set issue_count = 0
    where version_id = 'fb000000-0000-4000-8000-000000000002'
$test$, '23514'), 'Preflight history cannot be rewritten');
select ok(pg_temp.rejects_with($test$
    delete from private.drinking_window_publication_preflights
    where version_id = 'fb000000-0000-4000-8000-000000000002'
$test$, '23514'), 'Preflight history cannot be deleted');

insert into public.enrichment_sources (id, source_key, source_name, source_kind)
values ('fb000000-0000-4000-8000-000000000004',
    'synthetic-publication-preflight', 'Synthetic Preflight Source', 'cellarmanager');
insert into public.enrichment_source_policies
    (id, source_id, policy_version, effective_from, status,
     terms_checked_on, evidence_url, display_right, normalized_storage_right,
     raw_payload_storage_right, offline_sync_right, retention_right,
     cross_household_reuse_right)
values ('fb000000-0000-4000-8000-000000000005',
    'fb000000-0000-4000-8000-000000000004', 1, current_date, 'reviewed',
    current_date, 'https://example.test/synthetic-preflight-policy',
    'allowed', 'allowed', 'prohibited', 'prohibited', 'allowed', 'allowed');
insert into public.enrichment_evidence
    (id, source_id, source_policy_id, source_record_url, content_mode,
     claim_type, scope_level, place_id, vintage_year, wine_color,
     review_status, reviewed_at)
values ('fb000000-0000-4000-8000-000000000006',
    'fb000000-0000-4000-8000-000000000004',
    'fb000000-0000-4000-8000-000000000005',
    'https://example.test/synthetic-preflight-window', 'pointer-only',
    'maturity-window', 'vintage',
    'fb000000-0000-4000-8000-000000000001', 2022, 'white',
    'reviewed', now());
insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part)
values
    ('fb000000-0000-4000-8000-000000000002',
     'fb000000-0000-4000-8000-000000000003',
     'fb000000-0000-4000-8000-000000000006', 'first_trial'),
    ('fb000000-0000-4000-8000-000000000002',
     'fb000000-0000-4000-8000-000000000003',
     'fb000000-0000-4000-8000-000000000006', 'optimal_period');
insert into auth.users (id, email)
values ('fb000000-0000-4000-8000-000000000007',
    'publication-preflight-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('fb000000-0000-4000-8000-000000000007',
    'Preflight Curator', array['drinking-window'],
    'Synthetic curator grant for complete publication preflight.',
    'database-test');
insert into public.drinking_window_reference_reviews
    (version_id, reference_row_id, curator_id, verdict, rationale)
values ('fb000000-0000-4000-8000-000000000002',
    'fb000000-0000-4000-8000-000000000003',
    'fb000000-0000-4000-8000-000000000007', 'approve',
    'The coherent three-year window and evidence are approved.');

select is(
    (select count(*) from public.drinking_window_publication_issues(
        'fb000000-0000-4000-8000-000000000002')),
    0::bigint, 'A fully evidenced and approved three-milestone draft passes preflight'
);
select is(
    (select issue_count from public.record_drinking_window_publication_preflight(
        'fb000000-0000-4000-8000-000000000002')),
    0, 'A zero-issue preflight can be recorded without publishing'
);

select ok(pg_temp.rejects_with($test$
    update public.drinking_window_reference_versions set status = 'active'
    where id = 'fb000000-0000-4000-8000-000000000002'
$test$, '23514'), 'Recording a preflight does not unlock publication');
select is(
    (select status from public.drinking_window_reference_versions
     where id = 'fb000000-0000-4000-8000-000000000002'),
    'draft', 'The reference version remains inert after preflight'
);
select ok(pg_temp.rejects_with($test$
    select * from public.record_drinking_window_publication_preflight(
        'fb000000-0000-4000-8000-000000000099')
$test$, '22023'), 'A missing draft cannot produce a preflight record');

select * from finish();
rollback;
