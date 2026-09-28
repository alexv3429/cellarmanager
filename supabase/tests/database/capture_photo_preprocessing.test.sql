begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_function_privilege('authenticated', 'public.claim_capture_preprocessing(uuid)', 'execute'), 'Owners may request preprocessing of their own capture');
select ok(has_function_privilege('authenticated', 'public.list_capture_processed_assets(uuid)', 'execute'), 'Owners may list sanitized capture keys after preprocessing');
select ok(has_function_privilege('service_role', 'public.complete_capture_preprocessing(uuid)', 'execute'), 'Only the service may publish a completed derivative');
select ok(not has_function_privilege('authenticated', 'public.complete_capture_preprocessing(uuid)', 'execute'), 'Owners cannot mark an unverified derivative complete');
select ok(has_function_privilege('service_role', 'public.fail_capture_preprocessing(uuid)', 'execute'), 'Only the service may close failed processing');
select ok(not has_function_privilege('authenticated', 'public.fail_capture_preprocessing(uuid)', 'execute'), 'Owners cannot trigger service cleanup directly');
select ok((select count(*) = 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capture_label_processed_select'), 'Authenticated download policy is limited to processed capture assets');
select ok((select count(*)::integer = 4 from pg_policies where schemaname = 'storage' and tablename = 'objects'), 'Capture bucket has only upload, upload-response, processed-read, and deletion policies');

insert into auth.users(id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000009987', 'capture-preprocess-member@example.test', '{}');
insert into public.household_members(household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009987', 'member');

create temporary table preprocessing_capture(response jsonb);
grant select, insert on preprocessing_capture to authenticated;
grant select on preprocessing_capture to service_role;
create temporary table preprocessing_claim(claim jsonb);
grant select, insert on preprocessing_claim to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
insert into preprocessing_capture
select public.create_capture_session(
    '00000000-0000-4000-8000-000000000100',
    '[{"content_type":"image/jpeg","size_bytes":6}]'::jsonb
);

reset role;
insert into storage.objects(bucket_id, name, metadata)
select 'capture-labels', response->'objects'->0->>'object_name',
       jsonb_build_object('mimetype', 'image/jpeg', 'size', 6)
from preprocessing_capture;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select public.complete_capture_session((select (response->>'session_id')::uuid from preprocessing_capture));
insert into preprocessing_claim
select public.claim_capture_preprocessing((select (response->>'session_id')::uuid from preprocessing_capture));
select is((select claim->>'state' from preprocessing_claim), 'claimed', 'First owner request receives the bounded image-processing claim');
select is(jsonb_array_length((select claim->'assets' from preprocessing_claim)), 1, 'Claim reveals only this capture’s exact source and derivative slots');
select is(public.claim_capture_preprocessing((select (response->>'session_id')::uuid from preprocessing_capture))->>'state', 'processing', 'A duplicate concurrent request observes the active claim without claiming the same objects again');
reset role;
select is((select state from private.capture_sessions where id = (select (response->>'session_id')::uuid from preprocessing_capture)), 'processing', 'Claim atomically closes upload and starts processing');
select ok(
    (select preprocessing_started_at > now() - interval '1 minute'
     from private.capture_sessions where id = (select (response->>'session_id')::uuid from preprocessing_capture)),
    'A processing claim records its recovery lease timestamp'
);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select is(
    public.complete_capture_preprocessing((select (response->>'session_id')::uuid from preprocessing_capture)),
    false,
    'Service cannot finalize before a derivative is verified and the original is removed through Storage'
);

reset role;
select is((select state from private.capture_sessions where id = (select (response->>'session_id')::uuid from preprocessing_capture)), 'processing', 'Unverified assets do not advance the session');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(jsonb_array_length(public.list_capture_processed_assets((select (response->>'session_id')::uuid from preprocessing_capture))), 0, 'Owner receives no preview keys until preprocessing is verified');
select ok(
    not capture_guard.capture_object_operation_allowed(
        (select claim->'assets'->0->>'source_object_name' from preprocessing_claim), 'processed'
    ),
    'The original upload is never directly downloadable during preprocessing'
);

create temporary table stale_preprocessing_claim(claim jsonb);
grant select, insert on stale_preprocessing_claim to authenticated;
reset role;
update private.capture_sessions
set preprocessing_started_at = now() - interval '6 minutes'
where id = (select (response->>'session_id')::uuid from preprocessing_capture);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
insert into stale_preprocessing_claim
select public.claim_capture_preprocessing((select (response->>'session_id')::uuid from preprocessing_capture));
select is((select claim->>'state' from stale_preprocessing_claim), 'claimed', 'An expired preprocessing lease can be reclaimed');
select is((select claim->>'reclaimed' from stale_preprocessing_claim), 'true', 'A reclaimed claim tells the Worker to remove any partial derivative before retrying');
select is(
    (select claim->'assets'->0->>'normalized_object_name' from stale_preprocessing_claim),
    (select claim->'assets'->0->>'normalized_object_name' from preprocessing_claim),
    'A reclaimed attempt reuses its reserved derivative key so failed cleanup remains discoverable'
);
select is(
    public.claim_capture_preprocessing((select (response->>'session_id')::uuid from preprocessing_capture))->>'state',
    'processing',
    'A fresh retry lease remains exclusive to its current Worker'
);
select ok(
    exists (
        select 1
        from jsonb_array_elements(public.list_capture_sessions('00000000-0000-4000-8000-000000000100')) as listed(item)
        where listed.item->>'session_id' = (select response->>'session_id' from preprocessing_capture)
          and listed.item->>'processing_started_at' is not null
    ),
    'The Owner can see the lease timestamp needed to offer a safe retry'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009987';
select throws_ok(
    $$select public.list_capture_processed_assets((select (response->>'session_id')::uuid from preprocessing_capture))$$,
    '42501', 'Capture is not available to this account', 'Household Members cannot view prepared label photos'
);

reset role;
select * from finish();
rollback;
