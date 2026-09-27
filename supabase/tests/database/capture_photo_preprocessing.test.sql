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
set local role authenticated;

reset role;
-- Direct storage-row writes here simulate objects created by the Storage API.
-- PostgreSQL intentionally blocks deletes from storage.objects, so disable its
-- guard only inside this rollback-only test to model Storage API deletion.
insert into storage.objects(bucket_id, name, metadata)
select 'capture-labels',
       claim->'assets'->0->>'normalized_object_name',
       jsonb_build_object('mimetype', 'image/jpeg', 'size', 4)
from preprocessing_claim;
alter table storage.objects disable trigger user;
delete from storage.objects
where bucket_id = 'capture-labels'
  and name = (select claim->'assets'->0->>'source_object_name' from preprocessing_claim);
alter table storage.objects enable trigger user;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select is(
    public.complete_capture_preprocessing((select (response->>'session_id')::uuid from preprocessing_capture)),
    true,
    'Service finalization requires a verified JPEG derivative and deleted source object'
);

reset role;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
reset role;
select is((select state from private.capture_sessions where id = (select (response->>'session_id')::uuid from preprocessing_capture)), 'processed', 'Finalization publishes only the processed state');
set local role authenticated;
select is(jsonb_array_length(public.list_capture_processed_assets((select (response->>'session_id')::uuid from preprocessing_capture))), 1, 'Owner receives one sanitized asset key for preview');
select is(
    public.list_capture_processed_assets((select (response->>'session_id')::uuid from preprocessing_capture))->0->>'object_name',
    (select claim->'assets'->0->>'normalized_object_name' from preprocessing_claim),
    'The preview API returns the derivative key, not the uploaded source key'
);
select ok(
    capture_guard.capture_object_operation_allowed(
        (select claim->'assets'->0->>'normalized_object_name' from preprocessing_claim), 'processed'
    ),
    'The initiating Owner can download the verified processed derivative'
);
select ok(
    not capture_guard.capture_object_operation_allowed(
        (select claim->'assets'->0->>'source_object_name' from preprocessing_claim), 'processed'
    ),
    'The source key is not readable after preprocessing'
);
reset role;
select is(
    (select count(*)::integer from storage.objects
     where bucket_id = 'capture-labels'
       and name = (select claim->'assets'->0->>'source_object_name' from preprocessing_claim)),
    0,
    'The source Storage object is deleted before the session is marked processed'
);
set local role authenticated;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009987';
select throws_ok(
    $$select public.list_capture_processed_assets((select (response->>'session_id')::uuid from preprocessing_capture))$$,
    '42501', 'Capture is not available to this account', 'Household Members cannot view prepared label photos'
);
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select public.cancel_capture_session((select (response->>'session_id')::uuid from preprocessing_capture));
reset role;
alter table storage.objects disable trigger user;
delete from storage.objects
where bucket_id = 'capture-labels'
  and name = (select claim->'assets'->0->>'normalized_object_name' from preprocessing_claim);
alter table storage.objects enable trigger user;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(
    public.complete_capture_cleanup((select (response->>'session_id')::uuid from preprocessing_capture)),
    true,
    'Capture reservation is released only after its sanitized photo has been deleted'
);

reset role;
select * from finish();
rollback;
