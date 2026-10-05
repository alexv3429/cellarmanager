begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select has_table('public', 'drinking_window_reference_versions', 'Reference versions exist');
select has_table('public', 'drinking_window_ageing_groups', 'Local ageing groups exist');
select has_table('public', 'drinking_window_reference_rows', 'Four-date reference rows exist');
select has_table('public', 'drinking_window_candidates', 'Incomplete candidates have separate staging');

select ok(
    (select bool_and(attnotnull)
     from pg_catalog.pg_attribute
     where attrelid = 'public.drinking_window_reference_rows'::regclass
       and attname in (
           'first_trial_year', 'best_start_year', 'best_end_year', 'drink_by_year'
       )),
    'All four reference milestones are required by the database'
);

select ok(
    (select bool_and(relrowsecurity)
     from pg_catalog.pg_class
     where oid in (
         'public.drinking_window_reference_versions'::regclass,
         'public.drinking_window_ageing_groups'::regclass,
         'public.drinking_window_reference_rows'::regclass,
         'public.drinking_window_candidates'::regclass
     )),
    'Every foundation table has RLS enabled'
);

select ok(
    not has_table_privilege('authenticated', 'public.drinking_window_reference_rows', 'SELECT')
    and not has_table_privilege('authenticated', 'public.drinking_window_candidates', 'SELECT')
    and not has_table_privilege('powersync_role', 'public.drinking_window_reference_rows', 'SELECT'),
    'Browsers and PowerSync cannot read unpublished reference data'
);

select ok(
    has_table_privilege('service_role', 'public.drinking_window_reference_rows', 'SELECT, INSERT, UPDATE, DELETE')
    and has_table_privilege('service_role', 'public.drinking_window_candidates', 'SELECT, INSERT, UPDATE, DELETE'),
    'Trusted service can stage and curate draft data'
);

select is(
    (select count(*) from public.drinking_window_reference_rows),
    0::bigint,
    'Migration publishes no advice'
);

insert into public.enrichment_places (id, place_type, canonical_name)
values ('f5000000-0000-4000-8000-000000000001', 'region', 'Synthetic Reference Region');

insert into public.drinking_window_reference_versions (id, version_number)
values ('f5000000-0000-4000-8000-000000000002', 1);

select throws_ok(
    $test$
        update public.drinking_window_reference_versions
        set status = 'active', published_at = now()
        where id = 'f5000000-0000-4000-8000-000000000002'
    $test$,
    '23514',
    'Drinking-window reference publication is not enabled',
    'First slice cannot activate reference advice'
);

insert into public.drinking_window_reference_rows (
    version_id, scope, region_id, wine_color, vintage_year, all_at_scope,
    first_trial_year, best_start_year, best_end_year, drink_by_year, rationale
) values (
    'f5000000-0000-4000-8000-000000000002', 'region',
    'f5000000-0000-4000-8000-000000000001', 'red', 2022, true,
    2025, 2028, 2036, 2039, 'Synthetic ordered test window'
);

select is(
    (select first_trial_year::text || '/' || best_start_year::text || '/' ||
            best_end_year::text || '/' || drink_by_year::text
     from public.drinking_window_reference_rows),
    '2025/2028/2036/2039',
    'A draft reference stores the four explicit years together'
);

select throws_ok(
    $test$
        insert into public.drinking_window_reference_rows (
            version_id, scope, region_id, wine_color, vintage_year, all_at_scope,
            best_start_year, best_end_year, rationale
        ) values (
            'f5000000-0000-4000-8000-000000000002', 'region',
            'f5000000-0000-4000-8000-000000000001', 'white', 2022, true,
            2028, 2036, 'Workbook pair cannot fill missing milestones'
        )
    $test$,
    '23502',
    'null value in column "first_trial_year" of relation "drinking_window_reference_rows" violates not-null constraint',
    'A workbook best-period pair cannot masquerade as a published four-date row'
);

select throws_ok(
    $test$
        insert into public.drinking_window_reference_rows (
            version_id, scope, region_id, wine_color, vintage_year, all_at_scope,
            first_trial_year, best_start_year, best_end_year, drink_by_year, rationale
        ) values (
            'f5000000-0000-4000-8000-000000000002', 'region',
            'f5000000-0000-4000-8000-000000000001', 'white', 2022, true,
            2030, 2028, 2036, 2039, 'Reversed test window'
        )
    $test$,
    '23514',
    'new row for relation "drinking_window_reference_rows" violates check constraint "drinking_window_reference_rows_years_check"',
    'Four milestones must be ordered and no earlier than the vintage'
);

insert into public.drinking_window_candidates (
    source_sha256, source_locator, candidate_scope, source_identity,
    wine_color, vintage_year, best_start_year, best_end_year
) values (
    repeat('a', 64), 'Millesimes!L42:M42', 'region',
    '{"region":"Synthetic Reference Region"}'::jsonb,
    'red', 2022, 2028, 2036
);

select is(
    (select count(*) from public.drinking_window_candidates
     where first_trial_year is null and drink_by_year is null
       and best_start_year = 2028 and best_end_year = 2036),
    1::bigint,
    'A two-year workbook pair remains an incomplete staged candidate'
);

select is(
    (select count(*) from pg_catalog.pg_publication_tables
     where pubname = 'powersync' and schemaname = 'public'
       and tablename like 'drinking_window_%'),
    0::bigint,
    'No new reference data is copied to PowerSync'
);

select * from finish();
rollback;
