begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

create function pg_temp.rejects_with(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select has_table('public', 'drinking_window_ageing_group_memberships',
    'Versioned ageing-group membership exists');
select has_table('public', 'drinking_window_reference_evidence',
    'Window, group, and membership evidence links exist');

select ok(
    (select bool_and(relrowsecurity)
     from pg_catalog.pg_class
     where oid in (
         'public.drinking_window_ageing_group_memberships'::regclass,
         'public.drinking_window_reference_evidence'::regclass
     )),
    'Both new tables have RLS enabled'
);

select ok(
    not has_table_privilege('authenticated',
        'public.drinking_window_ageing_group_memberships', 'SELECT')
    and not has_table_privilege('authenticated',
        'public.drinking_window_reference_evidence', 'SELECT')
    and not has_table_privilege('powersync_role',
        'public.drinking_window_reference_evidence', 'SELECT'),
    'Browsers and PowerSync cannot read draft eligibility or evidence'
);

select ok(
    has_table_privilege('service_role',
        'public.drinking_window_ageing_group_memberships', 'SELECT, INSERT, UPDATE, DELETE')
    and has_table_privilege('service_role',
        'public.drinking_window_reference_evidence', 'SELECT, INSERT, UPDATE, DELETE'),
    'Trusted service can curate the draft records'
);

select is(
    (select count(*) from public.drinking_window_reference_versions
     where status = 'active'),
    0::bigint,
    'Draft memberships and evidence links publish no advice'
);

insert into public.enrichment_places (id, place_type, canonical_name)
values ('f6000000-0000-4000-8000-000000000001', 'region', 'Synthetic Eligibility Region');
insert into public.enrichment_places (id, parent_id, place_type, canonical_name)
values ('f6000000-0000-4000-8000-000000000002',
    'f6000000-0000-4000-8000-000000000001', 'appellation', 'Synthetic Eligibility Appellation');

insert into public.wine_reference_entities (id, entity_type) values
    ('f6000000-0000-4000-8000-000000000003', 'producer'),
    ('f6000000-0000-4000-8000-000000000004', 'product'),
    ('f6000000-0000-4000-8000-000000000005', 'release');
insert into public.wine_reference_producers (id, canonical_name)
values ('f6000000-0000-4000-8000-000000000003', 'Synthetic Eligibility Producer');
insert into public.wine_reference_products (id, producer_id, canonical_name)
values ('f6000000-0000-4000-8000-000000000004',
    'f6000000-0000-4000-8000-000000000003', 'Synthetic Eligibility Cuvee');
insert into public.wine_reference_releases (id, product_id, vintage_year)
values ('f6000000-0000-4000-8000-000000000005',
    'f6000000-0000-4000-8000-000000000004', 2022);

insert into public.drinking_window_reference_versions (id, version_number) values
    ('f6000000-0000-4000-8000-000000000006', 991001),
    ('f6000000-0000-4000-8000-000000000007', 991002);
insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition)
values ('f6000000-0000-4000-8000-000000000008',
    'f6000000-0000-4000-8000-000000000006', 'region',
    'f6000000-0000-4000-8000-000000000001', 'red',
    'structured', 'Synthetic reviewed eligibility definition');

insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_place_id,
     first_vintage_year, last_vintage_year, rationale)
values ('f6000000-0000-4000-8000-000000000009',
    'f6000000-0000-4000-8000-000000000006',
    'f6000000-0000-4000-8000-000000000008', 'place',
    'f6000000-0000-4000-8000-000000000002', 2021, 2023,
    'Synthetic place membership');
insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_product_id, rationale)
values ('f6000000-0000-4000-8000-000000000010',
    'f6000000-0000-4000-8000-000000000006',
    'f6000000-0000-4000-8000-000000000008', 'product',
    'f6000000-0000-4000-8000-000000000004', 'Synthetic product membership');
insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_release_id, rationale)
values ('f6000000-0000-4000-8000-000000000011',
    'f6000000-0000-4000-8000-000000000006',
    'f6000000-0000-4000-8000-000000000008', 'release',
    'f6000000-0000-4000-8000-000000000005', 'Synthetic release membership');

select is(
    (select count(*) from public.drinking_window_ageing_group_memberships
     where group_id = 'f6000000-0000-4000-8000-000000000008'),
    3::bigint,
    'One group can record explicit place, cuvee, and release eligibility'
);

select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_ageing_group_memberships
        (version_id, group_id, member_kind, member_place_id, member_product_id, rationale)
    values ('f6000000-0000-4000-8000-000000000006',
        'f6000000-0000-4000-8000-000000000008', 'place',
        'f6000000-0000-4000-8000-000000000002',
        'f6000000-0000-4000-8000-000000000004', 'Invalid multiple targets')
$test$, '23514'), 'A membership cannot name two target identities');

select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_ageing_group_memberships
        (version_id, group_id, member_kind, member_place_id,
         first_vintage_year, last_vintage_year, rationale)
    values ('f6000000-0000-4000-8000-000000000006',
        'f6000000-0000-4000-8000-000000000008', 'place',
        'f6000000-0000-4000-8000-000000000002', 2023, 2021,
        'Invalid vintage range')
$test$, '23514'), 'A membership cannot reverse its vintage range');

select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_ageing_group_memberships
        (version_id, group_id, member_kind, member_place_id, rationale)
    values ('f6000000-0000-4000-8000-000000000007',
        'f6000000-0000-4000-8000-000000000008', 'place',
        'f6000000-0000-4000-8000-000000000002', 'Wrong version')
$test$, '23503'), 'A membership cannot point to a group in another version');

select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_ageing_group_memberships
        (version_id, group_id, member_kind, member_place_id,
         first_vintage_year, last_vintage_year, rationale)
    values ('f6000000-0000-4000-8000-000000000006',
        'f6000000-0000-4000-8000-000000000008', 'place',
        'f6000000-0000-4000-8000-000000000002', 2021, 2023,
        'Duplicate exact membership')
$test$, '23505'), 'An identical member and vintage range cannot be added twice');

insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     ageing_group_id, first_trial_year, best_start_year, best_end_year, rationale)
values ('f6000000-0000-4000-8000-000000000012',
    'f6000000-0000-4000-8000-000000000006', 'region',
    'f6000000-0000-4000-8000-000000000001', 'red', 2022,
    'f6000000-0000-4000-8000-000000000008',
    2025, 2028, 2036, 'Synthetic three-date draft');

insert into public.enrichment_sources (id, source_key, source_name, source_kind)
values ('f6000000-0000-4000-8000-000000000013',
    'synthetic-window-eligibility', 'Synthetic Window Eligibility', 'cellarmanager');
insert into public.enrichment_source_policies
    (id, source_id, policy_version, effective_from)
values ('f6000000-0000-4000-8000-000000000014',
    'f6000000-0000-4000-8000-000000000013', 1, date '2026-10-15');
insert into public.enrichment_evidence
    (id, source_id, source_policy_id, source_record_url, content_mode,
     claim_type, scope_level, place_id)
values ('f6000000-0000-4000-8000-000000000015',
    'f6000000-0000-4000-8000-000000000013',
    'f6000000-0000-4000-8000-000000000014',
    'https://example.test/synthetic-window-evidence', 'pointer-only',
    'maturity-window', 'place', 'f6000000-0000-4000-8000-000000000001');

insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part)
values
    ('f6000000-0000-4000-8000-000000000006',
     'f6000000-0000-4000-8000-000000000012',
     'f6000000-0000-4000-8000-000000000015', 'first_trial'),
    ('f6000000-0000-4000-8000-000000000006',
     'f6000000-0000-4000-8000-000000000012',
     'f6000000-0000-4000-8000-000000000015', 'optimal_period');
insert into public.drinking_window_reference_evidence
    (version_id, ageing_group_id, evidence_id, claim_part)
values ('f6000000-0000-4000-8000-000000000006',
    'f6000000-0000-4000-8000-000000000008',
    'f6000000-0000-4000-8000-000000000015', 'group_definition');
insert into public.drinking_window_reference_evidence
    (version_id, membership_id, evidence_id, claim_part)
values ('f6000000-0000-4000-8000-000000000006',
    'f6000000-0000-4000-8000-000000000009',
    'f6000000-0000-4000-8000-000000000015', 'membership_eligibility');

select is(
    (select count(*) from public.drinking_window_reference_evidence
     where version_id = 'f6000000-0000-4000-8000-000000000006'),
    4::bigint,
    'Dates, group definition, and membership can carry separate evidence links'
);

select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_reference_evidence
        (version_id, reference_row_id, ageing_group_id, evidence_id, claim_part)
    values ('f6000000-0000-4000-8000-000000000006',
        'f6000000-0000-4000-8000-000000000012',
        'f6000000-0000-4000-8000-000000000008',
        'f6000000-0000-4000-8000-000000000015', 'first_trial')
$test$, '23514'), 'An evidence link cannot cover two different targets');

select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_reference_evidence
        (version_id, membership_id, evidence_id, claim_part)
    values ('f6000000-0000-4000-8000-000000000006',
        'f6000000-0000-4000-8000-000000000009',
        'f6000000-0000-4000-8000-000000000015', 'first_trial')
$test$, '23514'), 'Membership evidence cannot be mislabelled as a date claim');

select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_reference_evidence
        (version_id, reference_row_id, evidence_id, claim_part)
    values ('f6000000-0000-4000-8000-000000000007',
        'f6000000-0000-4000-8000-000000000012',
        'f6000000-0000-4000-8000-000000000015', 'context')
$test$, '23503'), 'Evidence cannot cross into another reference version');

select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_reference_evidence
        (version_id, reference_row_id, evidence_id, claim_part)
    values ('f6000000-0000-4000-8000-000000000006',
        'f6000000-0000-4000-8000-000000000012',
        'f6000000-0000-4000-8000-000000000015', 'first_trial')
$test$, '23505'), 'The same evidence cannot be linked twice to one milestone');

select is(
    (select review_status from public.enrichment_evidence
     where id = 'f6000000-0000-4000-8000-000000000015'),
    'pending',
    'Attaching draft evidence does not approve its claim or rights'
);

select ok(pg_temp.rejects_with($test$
    update public.drinking_window_reference_versions
    set status = 'active', published_at = now()
    where id = 'f6000000-0000-4000-8000-000000000006'
$test$, '23514'), 'Evidence links do not unlock publication');

select * from finish();
rollback;
