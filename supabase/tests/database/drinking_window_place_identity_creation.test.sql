begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.create_drinking_window_curation_place(text,uuid,text,text,text,boolean)',
    'execute'), 'Anonymous callers cannot create shared places');
insert into auth.users(id,email)
values ('f9800000-0000-4000-8000-000000000001','place-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id,display_name,profile_scopes,rationale,granted_by)
values ('f9800000-0000-4000-8000-000000000001','Place Curator',
    array['drinking-window'],'Synthetic place-identity curator.','database-test');
set local role authenticated;
set local request.jwt.claim.sub = 'f9800000-0000-4000-8000-000000000099';
select throws_ok($q$select public.create_drinking_window_curation_place(
    'region',null,'Synthetic Region','FR',
    'I checked this regional identity against the source labels.',true)$q$,
    '42501','An active curator grant for this profile type is required',
    'An ordinary signed-in user cannot create a shared place');
set local request.jwt.claim.sub = 'f9800000-0000-4000-8000-000000000001';
select set_config('app.test_region',public.create_drinking_window_curation_place(
    'region',null,'Synthetic Region','FR',
    'I checked this regional identity against the source labels.',true)
    ->> 'id',true);
select set_config('app.test_appellation',public.create_drinking_window_curation_place(
    'appellation',current_setting('app.test_region')::uuid,
    'Synthetic Appellation','FR',
    'I checked this appellation and its exact parent region.',true)
    ->> 'id',true);
select throws_ok($q$select public.create_drinking_window_curation_place(
    'region',null,'synthetic region','FR',
    'I checked this regional identity against the source labels.',true)$q$,
    '23505','This place name already exists; select it instead',
    'Normalized duplicate names are refused');
select throws_ok($q$select public.create_drinking_window_curation_place(
    'appellation',current_setting('app.test_region')::uuid,
    'Wrong-country Appellation','IT',
    'I checked this appellation and its exact parent region.',true)$q$,
    '22023','Choose an existing parent region in the same country',
    'An appellation cannot be assigned to a region in another country');
reset role;
select ok(private.drinking_window_place_contains(
    current_setting('app.test_region')::uuid,
    current_setting('app.test_appellation')::uuid),
    'The new appellation is contained in its selected region');
select is((select count(*) from private.drinking_window_place_creations
    where place_id in (current_setting('app.test_region')::uuid,
                       current_setting('app.test_appellation')::uuid)),2::bigint,
    'Both identity decisions are audited');
select is((select count(*) from public.drinking_window_reference_rows
    where region_id=current_setting('app.test_region')::uuid),0::bigint,
    'Creating a place does not create or publish a drinking window');

select * from finish();
rollback;
