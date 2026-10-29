begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.create_drinking_window_candidate_release(uuid,uuid,uuid,uuid,text,text,text,boolean)',
    'execute'), 'Anonymous callers cannot create shared wine identities');
insert into auth.users(id,email)
values ('f9700000-0000-4000-8000-000000000001','identity-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id,display_name,profile_scopes,rationale,granted_by)
values ('f9700000-0000-4000-8000-000000000001','Identity Curator',
    array['drinking-window'],'Synthetic identity creation curator.','database-test');
insert into public.drinking_window_candidates(
    source_sha256,source_locator,candidate_scope,source_identity,
    wine_color,vintage_year,first_trial_year,best_start_year,best_end_year,
    review_status,review_reason
) values (
    repeat('b',64),'producer-exchange:new-wine:2023:750','release',
    '{"origin":"producer-exchange","producer":"Synthetic New Producer",
      "cuvee":"New Cuvée","appellation":"Morgon","region":"Beaujolais",
      "format_ml":750,"evidence_urls":["https://example.test/new-wine"]}'::jsonb,
    'red',2023,2026,2030,2038,'needs-review','Synthetic research candidate.'
);
select set_config('app.test_candidate',(select id::text from public.drinking_window_candidates
    where source_sha256=repeat('b',64)),true);

set local role authenticated;
set local request.jwt.claim.sub = 'f9700000-0000-4000-8000-000000000099';
select throws_ok($q$select public.create_drinking_window_candidate_release(
    current_setting('app.test_candidate')::uuid,
    'f9700000-0000-4000-8000-000000000003',null,null,
    'Synthetic New Producer','New Cuvée',
    'I verified this exact producer and new cuvée independently.',true)$q$,
    '42501','An active curator grant for this profile type is required',
    'An ordinary user cannot create shared identities');
set local request.jwt.claim.sub = 'f9700000-0000-4000-8000-000000000001';
select throws_ok($q$select public.create_drinking_window_candidate_release(
    current_setting('app.test_candidate')::uuid,
    'f9700000-0000-4000-8000-000000000003',null,null,
    'Synthetic New Producer','New Cuvée',
    'I verified this exact producer and new cuvée independently.',true)$q$,
    '40001','A current, complete research review is required',
    'Unreviewed research cannot create a canonical identity');
reset role;

insert into private.drinking_window_candidate_review_drafts(
    id,candidate_id,proposed_scope,first_trial_year,best_start_year,
    best_end_year,rationale,evidence_urls,rights_status,disposition,curator_id
) values (
    'f9700000-0000-4000-8000-000000000003',
    current_setting('app.test_candidate')::uuid,
    'release',2026,2030,2038,'Synthetic reviewed research proposal.',
    array['https://example.test/new-wine'],'reuse-allowed','propose',
    'f9700000-0000-4000-8000-000000000001'
);
set local role authenticated;
select set_config('app.test_created',public.create_drinking_window_candidate_release(
    current_setting('app.test_candidate')::uuid,
    'f9700000-0000-4000-8000-000000000003',null,null,
    'Synthetic New Producer','New Cuvée',
    'I checked existing identities and independently verified this precise release.',true)::text,true);
select is((current_setting('app.test_created')::jsonb ->> 'created_release')::boolean,
    true,'A reviewer can create the missing producer, cuvée and vintage');
select is((public.create_drinking_window_candidate_release(
    current_setting('app.test_candidate')::uuid,
    'f9700000-0000-4000-8000-000000000003',null,null,
    'Synthetic New Producer','New Cuvée',
    'I checked existing identities and independently verified this precise release.',true)
    ->> 'already_created')::boolean,true,
    'A retry does not duplicate a canonical identity');
reset role;
select is((select count(*) from private.drinking_window_candidate_identity_creations
    where candidate_id=current_setting('app.test_candidate')::uuid),1::bigint,
    'The explicit identity decision is audited once');
select is((select count(*) from public.drinking_window_reference_rows
    where release_id=(current_setting('app.test_created')::jsonb ->> 'release_id')::uuid),0::bigint,
    'Creating the identity never publishes or stages research dates');

select * from finish();
rollback;
