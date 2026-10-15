begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.rejects_with(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select has_function('public', 'drinking_window_draft_issues', array['uuid'],
    'Draft diagnostics can be run by the service');
select ok(
    not has_function_privilege('authenticated', 'public.drinking_window_draft_issues(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.drinking_window_draft_issues(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.drinking_window_draft_issues(uuid)', 'EXECUTE'),
    'Only the trusted service can inspect draft diagnostics'
);
select ok(pg_temp.rejects_with($test$
    select * from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
$test$, '22023'), 'A missing draft cannot be assessed');

insert into public.enrichment_places (id, place_type, canonical_name) values
    ('f7000000-0000-4000-8000-000000000002', 'region', 'Synthetic Diagnostic Region'),
    ('f7000000-0000-4000-8000-000000000003', 'region', 'Synthetic Other Region');
insert into public.enrichment_places (id, parent_id, place_type, canonical_name)
values ('f7000000-0000-4000-8000-000000000004',
    'f7000000-0000-4000-8000-000000000002', 'appellation', 'Synthetic Diagnostic Appellation');

insert into public.wine_reference_entities (id, entity_type) values
    ('f7000000-0000-4000-8000-000000000005', 'producer'),
    ('f7000000-0000-4000-8000-000000000006', 'product'),
    ('f7000000-0000-4000-8000-000000000007', 'release');
insert into public.wine_reference_producers (id, canonical_name)
values ('f7000000-0000-4000-8000-000000000005', 'Synthetic Diagnostic Producer');
insert into public.wine_reference_products (id, producer_id, canonical_name)
values ('f7000000-0000-4000-8000-000000000006',
    'f7000000-0000-4000-8000-000000000005', 'Synthetic Diagnostic Cuvee');
insert into public.wine_reference_releases (id, product_id, vintage_year)
values ('f7000000-0000-4000-8000-000000000007',
    'f7000000-0000-4000-8000-000000000006', 2022);

insert into public.drinking_window_reference_versions (id, version_number)
values ('f7000000-0000-4000-8000-000000000001', 991101);
select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'empty_version'),
    1::bigint, 'An empty draft is reported rather than approved'
);

insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition)
values ('f7000000-0000-4000-8000-000000000008',
    'f7000000-0000-4000-8000-000000000001', 'region',
    'f7000000-0000-4000-8000-000000000002', 'red',
    'structured', 'Synthetic group for diagnostic tests');
insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_product_id, rationale)
values ('f7000000-0000-4000-8000-000000000009',
    'f7000000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000008', 'product',
    'f7000000-0000-4000-8000-000000000006', 'Synthetic product eligibility');
insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     ageing_group_id, first_trial_year, best_start_year, best_end_year, rationale)
values ('f7000000-0000-4000-8000-000000000010',
    'f7000000-0000-4000-8000-000000000001', 'region',
    'f7000000-0000-4000-8000-000000000002', 'red', 2022,
    'f7000000-0000-4000-8000-000000000008',
    2025, 2028, 2036, 'Synthetic complete three-year window');

select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code like 'missing_%_support'),
    4::bigint, 'Both date claims, the group, and its membership need evidence'
);

insert into public.enrichment_sources (id, source_key, source_name, source_kind)
values ('f7000000-0000-4000-8000-000000000011',
    'synthetic-window-diagnostics', 'Synthetic Diagnostic Source', 'cellarmanager');
insert into public.enrichment_source_policies
    (id, source_id, policy_version, effective_from)
values ('f7000000-0000-4000-8000-000000000012',
    'f7000000-0000-4000-8000-000000000011', 1, current_date);
insert into public.enrichment_evidence
    (id, source_id, source_policy_id, source_record_url, content_mode,
     claim_type, scope_level, place_id)
values ('f7000000-0000-4000-8000-000000000013',
    'f7000000-0000-4000-8000-000000000011',
    'f7000000-0000-4000-8000-000000000012',
    'https://example.test/synthetic-diagnostic-source', 'pointer-only',
    'maturity-window', 'place', 'f7000000-0000-4000-8000-000000000002');
insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part)
values
    ('f7000000-0000-4000-8000-000000000001',
     'f7000000-0000-4000-8000-000000000010',
     'f7000000-0000-4000-8000-000000000013', 'first_trial'),
    ('f7000000-0000-4000-8000-000000000001',
     'f7000000-0000-4000-8000-000000000010',
     'f7000000-0000-4000-8000-000000000013', 'optimal_period');
insert into public.drinking_window_reference_evidence
    (version_id, ageing_group_id, evidence_id, claim_part)
values ('f7000000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000008',
    'f7000000-0000-4000-8000-000000000013', 'group_definition');
insert into public.drinking_window_reference_evidence
    (version_id, membership_id, evidence_id, claim_part)
values ('f7000000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000009',
    'f7000000-0000-4000-8000-000000000013', 'membership_eligibility');

select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'unreviewed_or_unlicensed_evidence'),
    4::bigint, 'Linked pending evidence and unknown rights remain visible issues'
);

update public.enrichment_source_policies set
    status = 'reviewed', terms_checked_on = current_date,
    evidence_url = 'https://example.test/synthetic-policy',
    display_right = 'allowed', normalized_storage_right = 'allowed',
    raw_payload_storage_right = 'prohibited', offline_sync_right = 'prohibited',
    retention_right = 'allowed', cross_household_reuse_right = 'allowed'
where id = 'f7000000-0000-4000-8000-000000000012';
update public.enrichment_evidence set review_status = 'reviewed', reviewed_at = now()
where id = 'f7000000-0000-4000-8000-000000000013';

select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')),
    0::bigint, 'A coherent synthetic draft has no currently known issues'
);

update public.enrichment_source_policies
set cross_household_reuse_right = 'prohibited'
where id = 'f7000000-0000-4000-8000-000000000012';
select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'unreviewed_or_unlicensed_evidence'),
    4::bigint, 'Reviewed evidence still fails when cross-household reuse is prohibited'
);
update public.enrichment_source_policies
set cross_household_reuse_right = 'allowed'
where id = 'f7000000-0000-4000-8000-000000000012';

update public.drinking_window_ageing_group_memberships
set first_vintage_year = 2023
where id = 'f7000000-0000-4000-8000-000000000009';
select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'group_without_member_for_vintage'),
    1::bigint, 'A group needs an eligible member for that row vintage'
);
update public.drinking_window_ageing_group_memberships
set first_vintage_year = null
where id = 'f7000000-0000-4000-8000-000000000009';

insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     all_at_scope, first_trial_year, best_start_year, best_end_year, rationale)
values ('f7000000-0000-4000-8000-000000000014',
    'f7000000-0000-4000-8000-000000000001', 'region',
    'f7000000-0000-4000-8000-000000000002', 'red', 2022,
    true, 2024, 2027, 2033, 'Unsafe overlapping all-at-scope row');
select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'all_scope_overlap'),
    1::bigint, 'All-at-scope cannot overlap a group at one lookup key'
);
delete from public.drinking_window_reference_rows
where id = 'f7000000-0000-4000-8000-000000000014';

insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition)
values ('f7000000-0000-4000-8000-000000000015',
    'f7000000-0000-4000-8000-000000000001', 'region',
    'f7000000-0000-4000-8000-000000000002', 'red',
    'other-style', 'Conflicting synthetic group');
insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_release_id, rationale)
values ('f7000000-0000-4000-8000-000000000016',
    'f7000000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000015', 'release',
    'f7000000-0000-4000-8000-000000000007', 'Conflicting release membership');
insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     ageing_group_id, first_trial_year, best_start_year, best_end_year, rationale)
values ('f7000000-0000-4000-8000-000000000017',
    'f7000000-0000-4000-8000-000000000001', 'region',
    'f7000000-0000-4000-8000-000000000002', 'red', 2022,
    'f7000000-0000-4000-8000-000000000015',
    2024, 2027, 2033, 'Conflicting synthetic window');
select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'membership_group_overlap'),
    1::bigint, 'Product and release membership in competing groups is detected'
);

insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_place_id, rationale)
values ('f7000000-0000-4000-8000-000000000018',
    'f7000000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000008', 'place',
    'f7000000-0000-4000-8000-000000000003', 'Wrong region');
select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'membership_outside_region'),
    1::bigint, 'Out-of-region membership is reported'
);

insert into public.drinking_window_reference_rows
    (id, version_id, scope, producer_id, appellation_id, region_id,
     wine_color, vintage_year, all_at_scope,
     first_trial_year, best_start_year, best_end_year, rationale)
values ('f7000000-0000-4000-8000-000000000019',
    'f7000000-0000-4000-8000-000000000001', 'producer_appellation',
    'f7000000-0000-4000-8000-000000000005',
    'f7000000-0000-4000-8000-000000000004',
    'f7000000-0000-4000-8000-000000000003', 'red', 2022, true,
    2025, 2028, 2036, 'Wrong appellation region');
select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'appellation_region_mismatch'),
    1::bigint, 'An appellation cannot be borrowed from another region'
);

insert into public.drinking_window_reference_rows
    (id, version_id, scope, producer_id, product_id, release_id,
     appellation_id, region_id, wine_color, vintage_year, all_at_scope,
     first_trial_year, best_start_year, best_end_year, rationale)
values ('f7000000-0000-4000-8000-000000000020',
    'f7000000-0000-4000-8000-000000000001', 'release',
    'f7000000-0000-4000-8000-000000000005',
    'f7000000-0000-4000-8000-000000000006',
    'f7000000-0000-4000-8000-000000000007',
    'f7000000-0000-4000-8000-000000000004',
    'f7000000-0000-4000-8000-000000000002', 'red', 2023, true,
    2025, 2028, 2036, 'Wrong release vintage');
select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'release_identity_mismatch'),
    1::bigint, 'A release cannot be assigned another vintage'
);

insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part, evidence_role)
values ('f7000000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000010',
    'f7000000-0000-4000-8000-000000000013', 'context', 'contradicts');
select is(
    (select count(*) from public.drinking_window_draft_issues(
        'f7000000-0000-4000-8000-000000000001')
     where issue_code = 'contradictory_evidence'),
    1::bigint, 'Contradictory evidence remains an explicit review item'
);

select ok(pg_temp.rejects_with($test$
    update public.drinking_window_reference_versions
    set status = 'active', published_at = now()
    where id = 'f7000000-0000-4000-8000-000000000001'
$test$, '23514'), 'A zero-issue report still cannot activate publication');

select * from finish();
rollback;
