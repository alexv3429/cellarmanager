begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

create function pg_temp.rejects_with(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select has_function('public', 'drinking_window_evidence_fit_issues', array['uuid'],
    'Supporting evidence metadata has a draft fit report');
select ok(
    has_function_privilege('service_role',
        'public.drinking_window_evidence_fit_issues(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.drinking_window_evidence_fit_issues(uuid)', 'EXECUTE')
    and not has_function_privilege('powersync_role',
        'public.drinking_window_evidence_fit_issues(uuid)', 'EXECUTE'),
    'Only the trusted service can inspect evidence fit issues'
);
select ok(pg_temp.rejects_with($test$
    select * from public.drinking_window_evidence_fit_issues(
        'c2000000-0000-4000-8000-000000000001')
$test$, '22023'), 'A missing draft cannot be assessed');

insert into public.enrichment_places (id, place_type, canonical_name) values
    ('c2000000-0000-4000-8000-000000000002', 'region', 'Evidence Region'),
    ('c2000000-0000-4000-8000-000000000003', 'region', 'Unrelated Region');
insert into public.enrichment_places (id, parent_id, place_type, canonical_name) values
    ('c2000000-0000-4000-8000-000000000004',
     'c2000000-0000-4000-8000-000000000002', 'appellation', 'Evidence Appellation'),
    ('c2000000-0000-4000-8000-000000000005',
     'c2000000-0000-4000-8000-000000000002', 'appellation', 'Sibling Appellation');
insert into public.wine_reference_entities (id, entity_type) values
    ('c2000000-0000-4000-8000-000000000006', 'producer'),
    ('c2000000-0000-4000-8000-000000000007', 'producer'),
    ('c2000000-0000-4000-8000-000000000008', 'product'),
    ('c2000000-0000-4000-8000-000000000009', 'product'),
    ('c2000000-0000-4000-8000-000000000010', 'release'),
    ('c2000000-0000-4000-8000-000000000011', 'release');
insert into public.wine_reference_producers (id, canonical_name) values
    ('c2000000-0000-4000-8000-000000000006', 'Evidence Producer'),
    ('c2000000-0000-4000-8000-000000000007', 'Different Evidence Producer');
insert into public.wine_reference_products (id, producer_id, canonical_name) values
    ('c2000000-0000-4000-8000-000000000008',
     'c2000000-0000-4000-8000-000000000006', 'Evidence Cuvee'),
    ('c2000000-0000-4000-8000-000000000009',
     'c2000000-0000-4000-8000-000000000007', 'Different Cuvee');
insert into public.wine_reference_releases (id, product_id, vintage_year) values
    ('c2000000-0000-4000-8000-000000000010',
     'c2000000-0000-4000-8000-000000000008', 2022),
    ('c2000000-0000-4000-8000-000000000011',
     'c2000000-0000-4000-8000-000000000008', 2023);
insert into public.drinking_window_reference_versions (id, version_number)
values ('c2000000-0000-4000-8000-000000000001', 991401);
insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition)
values ('c2000000-0000-4000-8000-000000000012',
    'c2000000-0000-4000-8000-000000000001', 'region',
    'c2000000-0000-4000-8000-000000000002', 'red',
    'structured', 'Synthetic evidence group');
insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_place_id,
     member_product_id, first_vintage_year, last_vintage_year, rationale)
values ('c2000000-0000-4000-8000-000000000013',
    'c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000012', 'product',
    'c2000000-0000-4000-8000-000000000004',
    'c2000000-0000-4000-8000-000000000008', 2022, 2022,
    'Synthetic evidence eligibility');
insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     ageing_group_id, first_trial_year, best_start_year, best_end_year, rationale)
values ('c2000000-0000-4000-8000-000000000014',
    'c2000000-0000-4000-8000-000000000001', 'region',
    'c2000000-0000-4000-8000-000000000002', 'red', 2022,
    'c2000000-0000-4000-8000-000000000012',
    2025, 2028, 2035, 'Synthetic regional evidence window');
insert into public.drinking_window_reference_rows
    (id, version_id, scope, producer_id, product_id, release_id,
     appellation_id, region_id, wine_color, vintage_year, all_at_scope,
     first_trial_year, best_start_year, best_end_year, rationale)
values ('c2000000-0000-4000-8000-000000000015',
    'c2000000-0000-4000-8000-000000000001', 'release',
    'c2000000-0000-4000-8000-000000000006',
    'c2000000-0000-4000-8000-000000000008',
    'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000004',
    'c2000000-0000-4000-8000-000000000002', 'red', 2022, true,
    2025, 2028, 2035, 'Synthetic exact-release evidence window');

insert into public.enrichment_sources (id, source_key, source_name, source_kind)
values ('c2000000-0000-4000-8000-000000000016',
    'synthetic-window-fit', 'Synthetic Window Fit Source', 'cellarmanager');
insert into public.enrichment_source_policies
    (id, source_id, policy_version, effective_from)
values ('c2000000-0000-4000-8000-000000000017',
    'c2000000-0000-4000-8000-000000000016', 1, current_date);
insert into public.enrichment_evidence
    (id, source_id, source_policy_id, source_record_url,
     content_mode, claim_type, scope_level, place_id, vintage_year, wine_color)
values
    ('c2000000-0000-4000-8000-000000000018',
     'c2000000-0000-4000-8000-000000000016',
     'c2000000-0000-4000-8000-000000000017',
     'https://example.test/evidence-2022', 'pointer-only',
     'maturity-window', 'vintage',
     'c2000000-0000-4000-8000-000000000002', 2022, 'red'),
    ('c2000000-0000-4000-8000-000000000019',
     'c2000000-0000-4000-8000-000000000016',
     'c2000000-0000-4000-8000-000000000017',
     'https://example.test/evidence-2023', 'pointer-only',
     'maturity-window', 'vintage',
     'c2000000-0000-4000-8000-000000000002', 2023, 'white'),
    ('c2000000-0000-4000-8000-000000000020',
     'c2000000-0000-4000-8000-000000000016',
     'c2000000-0000-4000-8000-000000000017',
     'https://example.test/other-place', 'pointer-only',
     'maturity-window', 'place',
     'c2000000-0000-4000-8000-000000000005', null, null),
    ('c2000000-0000-4000-8000-000000000021',
     'c2000000-0000-4000-8000-000000000016',
     'c2000000-0000-4000-8000-000000000017',
     'https://example.test/wrong-kind', 'pointer-only',
     'food-pairing', 'place',
     'c2000000-0000-4000-8000-000000000002', null, null),
    ('c2000000-0000-4000-8000-000000000026',
     'c2000000-0000-4000-8000-000000000016',
     'c2000000-0000-4000-8000-000000000017',
     'https://example.test/unrelated-region', 'pointer-only',
     'maturity-window', 'place',
     'c2000000-0000-4000-8000-000000000003', null, null);
insert into public.enrichment_evidence
    (id, source_id, source_policy_id, source_record_url,
     content_mode, claim_type, scope_level, producer_id, product_id, release_id)
values
    ('c2000000-0000-4000-8000-000000000022',
     'c2000000-0000-4000-8000-000000000016',
     'c2000000-0000-4000-8000-000000000017',
     'https://example.test/other-producer', 'pointer-only',
     'maturity-window', 'producer',
     'c2000000-0000-4000-8000-000000000007', null, null),
    ('c2000000-0000-4000-8000-000000000023',
     'c2000000-0000-4000-8000-000000000016',
     'c2000000-0000-4000-8000-000000000017',
     'https://example.test/specific-product', 'pointer-only',
     'maturity-window', 'product', null,
     'c2000000-0000-4000-8000-000000000008', null),
    ('c2000000-0000-4000-8000-000000000024',
     'c2000000-0000-4000-8000-000000000016',
     'c2000000-0000-4000-8000-000000000017',
     'https://example.test/different-release', 'pointer-only',
     'maturity-window', 'release', null, null,
     'c2000000-0000-4000-8000-000000000011'),
    ('c2000000-0000-4000-8000-000000000025',
     'c2000000-0000-4000-8000-000000000016',
     'c2000000-0000-4000-8000-000000000017',
     'https://example.test/other-product', 'pointer-only',
     'maturity-window', 'product', null,
     'c2000000-0000-4000-8000-000000000009', null);

insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part)
values ('c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000014',
    'c2000000-0000-4000-8000-000000000018', 'optimal_period');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')), 0::bigint,
    'A compatible regional vintage window pointer has no metadata conflict');
insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part, evidence_role)
values ('c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000014',
    'c2000000-0000-4000-8000-000000000019', 'context', 'context');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')), 0::bigint,
    'A comparison vintage in context is not mistaken for support');

insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part)
values
    ('c2000000-0000-4000-8000-000000000001',
     'c2000000-0000-4000-8000-000000000014',
     'c2000000-0000-4000-8000-000000000019', 'first_trial'),
    ('c2000000-0000-4000-8000-000000000001',
     'c2000000-0000-4000-8000-000000000015',
     'c2000000-0000-4000-8000-000000000020', 'optimal_period'),
    ('c2000000-0000-4000-8000-000000000001',
     'c2000000-0000-4000-8000-000000000014',
     'c2000000-0000-4000-8000-000000000020', 'first_trial'),
    ('c2000000-0000-4000-8000-000000000001',
     'c2000000-0000-4000-8000-000000000015',
     'c2000000-0000-4000-8000-000000000021', 'first_trial'),
    ('c2000000-0000-4000-8000-000000000001',
     'c2000000-0000-4000-8000-000000000015',
     'c2000000-0000-4000-8000-000000000022', 'optimal_period'),
    ('c2000000-0000-4000-8000-000000000001',
     'c2000000-0000-4000-8000-000000000014',
     'c2000000-0000-4000-8000-000000000023', 'first_trial'),
    ('c2000000-0000-4000-8000-000000000001',
     'c2000000-0000-4000-8000-000000000015',
     'c2000000-0000-4000-8000-000000000024', 'optimal_period'),
    ('c2000000-0000-4000-8000-000000000001',
     'c2000000-0000-4000-8000-000000000015',
     'c2000000-0000-4000-8000-000000000025', 'optimal_period');
insert into public.drinking_window_reference_evidence
    (version_id, ageing_group_id, evidence_id, claim_part)
values ('c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000012',
    'c2000000-0000-4000-8000-000000000026', 'group_definition');
insert into public.drinking_window_reference_evidence
    (version_id, membership_id, evidence_id, claim_part)
values ('c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000013',
    'c2000000-0000-4000-8000-000000000025', 'membership_eligibility');

select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')
    where issue_code = 'support_vintage_conflict'), 2::bigint,
    'A wrong vintage is caught for a row and an exact release');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')
    where issue_code = 'support_color_conflict'), 1::bigint,
    'A white source cannot support a red window');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')
    where issue_code = 'support_place_conflict' and subject_kind = 'row'),
    1::bigint,
    'A sibling appellation cannot support the exact release');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')
    where issue_code = 'support_producer_conflict'), 3::bigint,
    'Wrong producer evidence is caught for release and member identity');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')
    where issue_code = 'support_product_conflict'), 2::bigint,
    'Wrong cuvee evidence is caught for release and member identity');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')
    where issue_code = 'support_release_conflict'), 1::bigint,
    'An unrelated release cannot support the exact release');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')
    where issue_code = 'support_too_narrow_for_claim'), 2::bigint,
    'A single cuvee or appellation source does not prove a regional window');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')
    where issue_code = 'date_source_not_window_claim'), 1::bigint,
    'A food-pairing claim cannot support a drinking date');
select is((select count(*) from public.drinking_window_evidence_fit_issues(
    'c2000000-0000-4000-8000-000000000001')
    where issue_code = 'support_place_conflict' and subject_kind = 'group'),
    1::bigint, 'Group definitions also reject a source from another region');

select ok(pg_temp.rejects_with($test$
    update public.drinking_window_reference_versions set status = 'active',
        published_at = now()
    where id = 'c2000000-0000-4000-8000-000000000001'
$test$, '23514'), 'Evidence checks do not enable publication');

select * from finish();
rollback;
