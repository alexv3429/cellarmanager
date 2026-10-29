begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.create_drinking_window_working_draft(uuid)', 'execute'),
    'Anonymous callers cannot copy a shared reference');
select ok(not has_function_privilege('anon',
    'public.publish_reviewed_drinking_window_draft(uuid)', 'execute'),
    'Anonymous callers cannot publish a reference');
select ok(not has_table_privilege('authenticated',
    'private.drinking_window_publishers', 'insert'),
    'A browser user cannot self-grant publisher access');

insert into auth.users(id, email)
values ('f9400000-0000-4000-8000-000000000001', 'release-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9400000-0000-4000-8000-000000000001', 'Release Curator',
    array['drinking-window'], 'Synthetic release curator for this test.', 'database-test');
select set_config('app.test_base', private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text, true);

set local role authenticated;
set local request.jwt.claim.sub = 'f9400000-0000-4000-8000-000000000099';
select throws_ok($test$
    select public.create_drinking_window_working_draft(current_setting('app.test_base')::uuid)
$test$, '42501', 'An active curator grant for this profile type is required',
    'An ordinary user cannot create a shared working draft');

set local request.jwt.claim.sub = 'f9400000-0000-4000-8000-000000000001';
select is((public.get_drinking_window_release_workspace() ->> 'can_publish')::boolean,
    false, 'A curator is not automatically a publisher');
select set_config('app.test_working',
    public.create_drinking_window_working_draft(current_setting('app.test_base')::uuid)
      ->> 'version_id', true);
select is((public.get_drinking_window_release_workspace() -> 'versions' -> 0 ->> 'version_number')::integer, 3,
    'Copying prepares the next unpublished version');
select throws_ok($test$
    select public.publish_reviewed_drinking_window_draft(current_setting('app.test_working')::uuid)
$test$, '42501', 'Shared-reference publication requires a separate publisher grant',
    'A curator without a publisher grant cannot activate any reference');
select is((public.check_drinking_window_working_draft(
    current_setting('app.test_working')::uuid) ->> 'issue_count')::integer > 0,
    true, 'A copied version needs fresh review before publication');
reset role;

select is((select count(*) from public.drinking_window_reference_rows
    where version_id = current_setting('app.test_working')::uuid), 1::bigint,
    'Copy keeps the reference rows');
select is((select count(*) from public.drinking_window_reference_reviews
    where version_id = current_setting('app.test_working')::uuid), 0::bigint,
    'Copy does not carry over prior approvals');
select is((select count(*) from private.drinking_window_publications
    where version_id = current_setting('app.test_working')::uuid), 0::bigint,
    'No publication happened during copy or preflight');

select * from finish();
rollback;
