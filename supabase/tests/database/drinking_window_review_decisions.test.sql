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

select has_table('public', 'drinking_window_reference_reviews',
    'Attributable drinking-window review decisions are stored');
select ok(
    not has_table_privilege('authenticated', 'public.drinking_window_reference_reviews', 'SELECT')
    and not has_table_privilege('authenticated', 'public.drinking_window_reference_reviews', 'INSERT')
    and not has_function_privilege('authenticated',
        'public.drinking_window_review_issues(uuid)', 'EXECUTE')
    and has_function_privilege('service_role',
        'public.drinking_window_review_issues(uuid)', 'EXECUTE'),
    'Draft reviews and their diagnostic are not browser-readable'
);
select ok(
    (select relrowsecurity from pg_catalog.pg_class
     where oid = 'public.drinking_window_reference_reviews'::regclass),
    'Review history has RLS enabled'
);

insert into auth.users (id, email)
values ('f8000000-0000-4000-8000-000000000001', 'window-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f8000000-0000-4000-8000-000000000001', 'Window Curator',
    array['place'], 'Existing place profile curator for this synthetic test.',
    'database-test');

insert into public.enrichment_places (id, place_type, canonical_name)
values ('f8000000-0000-4000-8000-000000000002', 'region', 'Synthetic Review Region');
insert into public.enrichment_places (id, parent_id, place_type, canonical_name)
values ('f8000000-0000-4000-8000-000000000003',
    'f8000000-0000-4000-8000-000000000002', 'appellation',
    'Synthetic Review Appellation');
insert into public.drinking_window_reference_versions (id, version_number)
values ('f8000000-0000-4000-8000-000000000004', 991201),
       ('f8000000-0000-4000-8000-000000000005', 991202);
insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition)
values ('f8000000-0000-4000-8000-000000000006',
    'f8000000-0000-4000-8000-000000000004', 'region',
    'f8000000-0000-4000-8000-000000000002', 'red',
    'structured', 'Synthetic red ageing group under review');
insert into public.drinking_window_ageing_group_memberships
    (id, version_id, group_id, member_kind, member_place_id, rationale)
values ('f8000000-0000-4000-8000-000000000007',
    'f8000000-0000-4000-8000-000000000004',
    'f8000000-0000-4000-8000-000000000006', 'place',
    'f8000000-0000-4000-8000-000000000003',
    'Synthetic appellation eligibility under review');
insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     ageing_group_id, first_trial_year, best_start_year, best_end_year, rationale)
values ('f8000000-0000-4000-8000-000000000008',
    'f8000000-0000-4000-8000-000000000004', 'region',
    'f8000000-0000-4000-8000-000000000002', 'red', 2022,
    'f8000000-0000-4000-8000-000000000006',
    2025, 2028, 2036, 'Synthetic coherent three-milestone window');

select is(
    (select count(*) from public.drinking_window_review_issues(
        'f8000000-0000-4000-8000-000000000004')
     where issue_code = 'missing_current_approval'),
    3::bigint, 'The window, group definition, and membership need separate review'
);
select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_reference_reviews
        (version_id, reference_row_id, curator_id, verdict, rationale)
    values ('f8000000-0000-4000-8000-000000000004',
        'f8000000-0000-4000-8000-000000000008',
        'f8000000-0000-4000-8000-000000000001', 'approve',
        'I reviewed all three years as one coherent window.')
$test$, '42501'), 'Existing profile authority does not authorize drinking-window review');

update public.enrichment_curator_eligibilities
set profile_scopes = array['place', 'drinking-window']
where user_id = 'f8000000-0000-4000-8000-000000000001';
insert into public.drinking_window_reference_reviews
    (version_id, reference_row_id, curator_id, verdict, rationale)
values ('f8000000-0000-4000-8000-000000000004',
    'f8000000-0000-4000-8000-000000000008',
    'f8000000-0000-4000-8000-000000000001', 'approve',
    'I reviewed the three years together with their provenance.');
insert into public.drinking_window_reference_reviews
    (version_id, ageing_group_id, curator_id, verdict, rationale)
values ('f8000000-0000-4000-8000-000000000004',
    'f8000000-0000-4000-8000-000000000006',
    'f8000000-0000-4000-8000-000000000001', 'approve',
    'I reviewed the locally defined ageing style.');
insert into public.drinking_window_reference_reviews
    (version_id, membership_id, curator_id, verdict, rationale)
values ('f8000000-0000-4000-8000-000000000004',
    'f8000000-0000-4000-8000-000000000007',
    'f8000000-0000-4000-8000-000000000001', 'approve',
    'I reviewed the explicit place eligibility.');

select ok(
    (select bool_and(subject_sha256 ~ '^[0-9a-f]{64}$')
     from public.drinking_window_reference_reviews
     where version_id = 'f8000000-0000-4000-8000-000000000004'),
    'Every review carries a server-computed subject snapshot hash'
);
select is(
    (select count(*) from public.drinking_window_review_issues(
        'f8000000-0000-4000-8000-000000000004')),
    0::bigint, 'A current approval exists for each draft subject'
);

update public.enrichment_curator_eligibilities
set eligibility_status = 'suspended', revoked_at = now()
where user_id = 'f8000000-0000-4000-8000-000000000001';
select is(
    (select count(*) from public.drinking_window_review_issues(
        'f8000000-0000-4000-8000-000000000004')
     where issue_code = 'missing_current_approval'),
    3::bigint, 'A suspended curator no longer supplies current approval'
);
update public.enrichment_curator_eligibilities
set eligibility_status = 'active', revoked_at = null
where user_id = 'f8000000-0000-4000-8000-000000000001';

update public.drinking_window_reference_rows set best_end_year = 2037
where id = 'f8000000-0000-4000-8000-000000000008';
select is(
    (select count(*) from public.drinking_window_review_issues(
        'f8000000-0000-4000-8000-000000000004')
     where subject_kind = 'row' and issue_code in (
         'stale_review', 'missing_current_approval'
     )),
    2::bigint, 'Changing a date invalidates the prior whole-window approval'
);
insert into public.drinking_window_reference_reviews
    (version_id, reference_row_id, curator_id, verdict, rationale)
values ('f8000000-0000-4000-8000-000000000004',
    'f8000000-0000-4000-8000-000000000008',
    'f8000000-0000-4000-8000-000000000001', 'approve',
    'I reviewed the amended end of the optimum.');
select is(
    (select count(*) from public.drinking_window_review_issues(
        'f8000000-0000-4000-8000-000000000004')),
    0::bigint, 'Re-reviewing the new snapshot clears the stale decision'
);

insert into public.enrichment_sources (id, source_key, source_name, source_kind)
values ('f8000000-0000-4000-8000-000000000009',
    'synthetic-window-review', 'Synthetic Review Source', 'cellarmanager');
insert into public.enrichment_source_policies
    (id, source_id, policy_version, effective_from)
values ('f8000000-0000-4000-8000-000000000010',
    'f8000000-0000-4000-8000-000000000009', 1, current_date);
insert into public.enrichment_evidence
    (id, source_id, source_policy_id, source_record_url, content_mode,
     claim_type, scope_level, place_id)
values ('f8000000-0000-4000-8000-000000000011',
    'f8000000-0000-4000-8000-000000000009',
    'f8000000-0000-4000-8000-000000000010',
    'https://example.test/synthetic-review-evidence', 'pointer-only',
    'maturity-window', 'place', 'f8000000-0000-4000-8000-000000000002');
insert into public.drinking_window_reference_evidence
    (version_id, reference_row_id, evidence_id, claim_part)
values ('f8000000-0000-4000-8000-000000000004',
    'f8000000-0000-4000-8000-000000000008',
    'f8000000-0000-4000-8000-000000000011', 'optimal_period');
select is(
    (select count(*) from public.drinking_window_review_issues(
        'f8000000-0000-4000-8000-000000000004')
     where subject_kind = 'row' and issue_code = 'stale_review'),
    1::bigint, 'Adding an evidence link invalidates the old review'
);
insert into public.drinking_window_reference_reviews
    (version_id, reference_row_id, curator_id, verdict, rationale)
values ('f8000000-0000-4000-8000-000000000004',
    'f8000000-0000-4000-8000-000000000008',
    'f8000000-0000-4000-8000-000000000001', 'approve',
    'I reviewed the new source pointer for the optimum.');
update public.enrichment_source_policies set
    notes = 'Rights require another review before cross-household use.'
where id = 'f8000000-0000-4000-8000-000000000010';
select is(
    (select count(*) from public.drinking_window_review_issues(
        'f8000000-0000-4000-8000-000000000004')
     where subject_kind = 'row' and issue_code = 'stale_review'),
    1::bigint, 'Changing the linked source policy invalidates the review'
);

select ok(pg_temp.rejects_with($test$
    update public.drinking_window_reference_reviews set verdict = 'disagree'
    where reference_row_id = 'f8000000-0000-4000-8000-000000000008'
$test$, '23514'), 'Review decisions are append-only');
select ok(pg_temp.rejects_with($test$
    delete from public.drinking_window_reference_reviews
    where reference_row_id = 'f8000000-0000-4000-8000-000000000008'
$test$, '23514'), 'Review history cannot be deleted');
select ok(pg_temp.rejects_with($test$
    insert into public.drinking_window_reference_reviews
        (version_id, reference_row_id, curator_id, verdict, rationale)
    values ('f8000000-0000-4000-8000-000000000005',
        'f8000000-0000-4000-8000-000000000008',
        'f8000000-0000-4000-8000-000000000001', 'approve',
        'This subject belongs to another version and must fail.')
$test$, 'P0002'), 'A review cannot approve a target in a different version');

insert into public.drinking_window_reference_reviews
    (version_id, reference_row_id, curator_id, verdict, rationale)
values ('f8000000-0000-4000-8000-000000000004',
    'f8000000-0000-4000-8000-000000000008',
    'f8000000-0000-4000-8000-000000000001', 'disagree',
    'The current evidence does not justify this end year.');
select is(
    (select count(*) from public.drinking_window_review_issues(
        'f8000000-0000-4000-8000-000000000004')
     where issue_code = 'disputed_review'),
    1::bigint, 'A current disagreement remains visible for review'
);
insert into public.drinking_window_reference_reviews
    (version_id, reference_row_id, curator_id, verdict, rationale)
values ('f8000000-0000-4000-8000-000000000004',
    'f8000000-0000-4000-8000-000000000008',
    'f8000000-0000-4000-8000-000000000001', 'approve',
    'The objection is resolved after another source review.');
select is(
    (select count(*) from public.drinking_window_review_issues(
        'f8000000-0000-4000-8000-000000000004')
     where issue_code = 'disputed_review'),
    0::bigint, 'The same curator can resolve a dispute with a newer decision'
);

select ok(pg_temp.rejects_with($test$
    update public.drinking_window_reference_versions
    set status = 'active', published_at = now()
    where id = 'f8000000-0000-4000-8000-000000000004'
$test$, '23514'), 'Human review still does not enable publication');

select * from finish();
rollback;
