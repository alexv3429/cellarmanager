begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

create function pg_temp.authoring_rejects(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select set_config('app.source_version', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);
select set_config('app.test_row', (select id::text
    from public.drinking_window_reference_rows
    where version_id = current_setting('app.source_version')::uuid
    limit 1), true);
select set_config('app.test_release', (select release_id::text
    from public.drinking_window_reference_rows
    where id = current_setting('app.test_row')::uuid), true);
select set_config('app.test_region', (select region_id::text
    from public.drinking_window_reference_rows
    where id = current_setting('app.test_row')::uuid), true);
select set_config('app.test_appellation', (select appellation_id::text
    from public.drinking_window_reference_rows
    where id = current_setting('app.test_row')::uuid), true);
insert into public.drinking_window_reference_versions (id, version_number)
values ('f9000000-0000-4000-8000-000000000001', 991814);
select set_config('app.test_version', 'f9000000-0000-4000-8000-000000000001', true);
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('00000000-0000-4000-8000-000000000001', 'Synthetic curator',
    array['drinking-window'], 'Routine authoring test', 'database-test');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select ok(pg_temp.authoring_rejects(format(
    'select public.create_drinking_window_exact_draft_row(%L,%L,%L,%L,%L,1500,2025,2028,2040,%L)',
    current_setting('app.test_version'),
    current_setting('app.test_release'), current_setting('app.test_region'),
    current_setting('app.test_appellation'),
    'red', 'Synthetic test dates still need reviewed evidence and approval'
), '42501'), 'A non-curator cannot author a common reference row');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select set_config('app.authored_row', (
    select public.create_drinking_window_exact_draft_row(
        current_setting('app.test_version')::uuid,
        current_setting('app.test_release')::uuid,
        current_setting('app.test_region')::uuid,
        current_setting('app.test_appellation')::uuid,
        'red', 1500, 2025, 2028, 2040,
        'Synthetic test dates still need reviewed evidence and approval')::text
), true);
reset role;
select is((select scope from public.drinking_window_reference_rows
    where id = current_setting('app.authored_row')::uuid), 'release',
    'The curator can stage an exact canonical release without a developer migration');
select is((select format_ml from public.drinking_window_reference_rows
    where id = current_setting('app.authored_row')::uuid), 1500,
    'The staged rule is bottle-size specific');
select is((select curator_id from private.drinking_window_draft_row_authorship
    where row_id = current_setting('app.authored_row')::uuid),
    '00000000-0000-4000-8000-000000000001'::uuid,
    'Curator authorship is auditable');
select ok((select count(*) from public.drinking_window_publication_issues(
    current_setting('app.test_version')::uuid)) > 0,
    'An authored row cannot publish without evidence and fresh review');
select ok(pg_temp.authoring_rejects(format(
    'select public.create_drinking_window_exact_draft_row(%L,%L,%L,%L,%L,1500,2025,2028,2040,%L)',
    current_setting('app.test_version'),
    current_setting('app.test_release'), current_setting('app.test_region'),
    current_setting('app.test_appellation'),
    'red', 'A repeated exact row should not silently shadow its predecessor'
), '23505'), 'A duplicate exact release is rejected');

select * from finish();
rollback;
