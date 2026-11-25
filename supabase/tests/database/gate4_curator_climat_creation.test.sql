begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id) values ('fa700000-0000-4000-8000-000000000001'),
 ('fa700000-0000-4000-8000-000000000002') on conflict do nothing;
insert into public.enrichment_curator_eligibilities(user_id,display_name,profile_scopes,rationale,granted_by)
values ('fa700000-0000-4000-8000-000000000001','Synthetic climat curator',
 array['drinking-window'],'Tests geographic creation on disposable data.','database-test');
insert into public.enrichment_places(id,place_type,canonical_name,country_code) values
 ('fa700000-0000-4000-8000-000000000003','region','Synthetic Climat Region','FR');
insert into public.enrichment_places(id,parent_id,place_type,canonical_name,country_code) values
 ('fa700000-0000-4000-8000-000000000004','fa700000-0000-4000-8000-000000000003','appellation','Synthetic Village A','FR'),
 ('fa700000-0000-4000-8000-000000000005','fa700000-0000-4000-8000-000000000003','appellation','Synthetic Village B','FR');
select ok(not has_function_privilege('anon',
 'public.create_drinking_window_curation_climates(uuid,text[],text,text,boolean)','execute'),
 'Anonymous users cannot create shared climates');
select set_config('request.jwt.claim.sub','fa700000-0000-4000-8000-000000000002',true);
select throws_ok($test$ select public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004',array['Les Caillerets'],
 'https://example.org/places','Synthetic official list checked carefully.',true) $test$,
 '42501','An active curator grant for this profile type is required',
 'An ordinary user cannot create shared climates');
select set_config('request.jwt.claim.sub','fa700000-0000-4000-8000-000000000001',true);
select throws_ok($test$ select public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000003',array['Les Caillerets'],
 'https://example.org/places','Synthetic official list checked carefully.',true) $test$,
 '22023','Choose a shared appellation','The parent must be an appellation');
select throws_ok($test$ select public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004',array['Les Caillerets'],
 'http://example.org/places','Synthetic official list checked carefully.',true) $test$,
 '22023','Confirm the appellation, names, source and reason','A secure source is required');
select throws_ok($test$ select public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004',array['Les Caillerets'],
 'https://example.org@untrusted.invalid/places','Synthetic official list checked carefully.',true) $test$,
 '22023','Confirm the appellation, names, source and reason','Credential-like source URLs are rejected');
select throws_ok($test$ select public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004',array['Les Caillerets',' les caillerets '],
 'https://example.org/places','Synthetic official list checked carefully.',true) $test$,
 '22023','Provide distinct valid climat names','Repeated names are rejected before writing');
select is(jsonb_array_length(public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004',array['Les Caillerets','Les Charmes'],
 'https://example.org/places','Synthetic official list checked carefully.',true)->'created'),2,
 'A curator can add a checked batch of two climates');
select is(jsonb_array_length(public.list_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004')),2,'The curator can list climates by appellation');
select is((select count(*) from private.drinking_window_climat_creations
 where appellation_id='fa700000-0000-4000-8000-000000000004'
   and source_url='https://example.org/places'),2::bigint,'Each identity retains its source and reviewer');
select throws_ok($test$ select public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004',array['Les Caillerets','Les Perrières'],
 'https://example.org/places','Synthetic official list checked carefully.',true) $test$,
 '23505','A climat with this name already exists in this appellation',
 'An existing identity blocks the entire batch');
select is(jsonb_array_length(public.list_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004')),2,'A rejected batch creates no partial identities');
select throws_ok($test$ select public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004',array['Synthetic Village A Caillerets'],
 'https://example.org/places','Synthetic official list checked carefully.',true) $test$,
 '23505','A climat with this name already exists in this appellation',
 'An appellation prefix and optional Les cannot create a duplicate');
select is(jsonb_array_length(public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000004',array['Le Porusot','Porusot'],
 'https://example.org/places','Two independently named official climats checked against the list.',true)->'created'),2,
 'Le Porusot and Porusot are not conflated');
select is(jsonb_array_length(public.create_drinking_window_curation_climates(
 'fa700000-0000-4000-8000-000000000005',array['Les Caillerets'],
 'https://example.org/places','Synthetic official list checked carefully.',true)->'created'),1,
 'The same name in a different appellation is a separate identity');
select is((select count(*) from public.drinking_window_reference_rows r
 where r.appellation_id in ('fa700000-0000-4000-8000-000000000004','fa700000-0000-4000-8000-000000000005')),
 0::bigint,'Creating geographic identities creates no drinking windows');
select * from finish();
rollback;
