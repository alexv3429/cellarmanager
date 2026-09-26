begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.create_capture_session(uuid,jsonb)', 'execute'), 'Anonymous users cannot create photo captures');
select ok(not has_function_privilege('service_role', 'public.create_capture_session(uuid,jsonb)', 'execute'), 'The worker cannot create owner photo captures');
select ok(not has_function_privilege('anon', 'public.list_capture_sessions(uuid)', 'execute'), 'Anonymous users cannot list photo captures');
select ok(not has_table_privilege('authenticated', 'private.capture_sessions', 'select'), 'Capture sessions remain server-only');
select ok(not has_table_privilege('authenticated', 'private.capture_assets', 'select'), 'Object keys remain server-only');
select ok(has_schema_privilege('authenticated', 'capture_guard', 'usage') and not has_schema_privilege('anon', 'capture_guard', 'usage'), 'Only authenticated Storage requests can resolve the non-API guard schema');
select ok(has_function_privilege('authenticated', 'capture_guard.capture_object_operation_allowed(text,text)', 'execute') and not has_function_privilege('anon', 'capture_guard.capture_object_operation_allowed(text,text)', 'execute') and not has_function_privilege('service_role', 'capture_guard.capture_object_operation_allowed(text,text)', 'execute'), 'The non-exposed Storage guard is callable only by authenticated RLS checks');
select ok(has_function_privilege('service_role', 'public.claim_capture_cleanup(integer)', 'execute'), 'Only the service worker can claim expired cleanup');
select ok(not has_function_privilege('authenticated', 'public.claim_capture_cleanup(integer)', 'execute'), 'Clients cannot claim cleanup jobs');
select is((select public from storage.buckets where id = 'capture-labels'), false, 'Capture bucket is private');
select is((select file_size_limit from storage.buckets where id = 'capture-labels'), 6291456::bigint, 'Capture bucket enforces the six MiB upload cap');
select ok((select allowed_mime_types = array['image/jpeg', 'image/png']::text[] from storage.buckets where id = 'capture-labels'), 'Capture bucket allows only JPEG and PNG MIME types');
select ok((select count(*) = 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capture_label_upload_insert'), 'Storage insert is guarded by the exact active capture key');
select ok((select count(*) = 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capture_label_upload_response_select'), 'Upload metadata reads are operation restricted');
select ok((select count(*) = 0 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname ilike 'capture_label%update%'), 'Capture objects cannot be updated or overwritten');
select is((select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects'), 3, 'No unmanaged Storage policy can broaden capture access');

insert into auth.users(id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000009987', 'capture-member@example.test', '{}');
insert into public.household_members(household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009987', 'member');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009987';
select throws_ok(
    $$select public.create_capture_session('00000000-0000-4000-8000-000000000100', '[{"content_type":"image/jpeg","size_bytes":5}]'::jsonb)$$,
    '42501', 'Household owner permission is required', 'Members cannot create photo sessions'
);
select throws_ok(
    $$select public.list_capture_sessions('00000000-0000-4000-8000-000000000100')$$,
    '42501', 'Household owner permission is required', 'Members cannot list photo sessions'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok(
    $$select public.create_capture_session('00000000-0000-4000-8000-000000000200', '[{"content_type":"image/jpeg","size_bytes":5}]'::jsonb)$$,
    '42501', 'User is not a member of this household', 'An owner cannot create a capture in another household'
);
select throws_ok(
    $$select public.create_capture_session('00000000-0000-4000-8000-000000000100', '[]'::jsonb)$$,
    '22023', 'Choose one or two JPEG or PNG photos', 'Empty photo selections are rejected'
);
select throws_ok(
    $$select public.create_capture_session('00000000-0000-4000-8000-000000000100', '[{"content_type":"image/svg+xml","size_bytes":5}]'::jsonb)$$,
    '22023', 'Photos must be JPEG or PNG files no larger than 6 MB', 'Unsupported image MIME types are rejected'
);
select throws_ok(
    $$select public.create_capture_session('00000000-0000-4000-8000-000000000100', '[{"content_type":"image/jpeg","size_bytes":6291457}]'::jsonb)$$,
    '22023', 'Photos must be JPEG or PNG files no larger than 6 MB', 'Oversized files are rejected server-side'
);
select throws_ok(
    $$select public.create_capture_session('00000000-0000-4000-8000-000000000100', '[{"content_type":"image/jpeg","size_bytes":5,"filename":"private.jpg"}]'::jsonb)$$,
    '22023', 'Each photo needs a supported image type and size', 'Client filenames and unexpected asset fields are rejected'
);

create temporary table capture_created as
select public.create_capture_session(
    '00000000-0000-4000-8000-000000000100',
    '[{"content_type":"image/jpeg","size_bytes":123},{"content_type":"image/png","size_bytes":456}]'::jsonb
) as response;

select is(jsonb_array_length(response->'objects'), 2, 'Owner receives two distinct server-created upload slots') from capture_created;
select ok((response->>'session_id') ~ '^[0-9a-f-]{36}$', 'Session ID is opaque and server generated') from capture_created;
select ok((response->'objects'->0->>'object_name') ~ '^[0-9a-f-]{36}$', 'Upload path is an opaque UUID, not a filename') from capture_created;
select is((select jsonb_array_length(public.list_capture_sessions('00000000-0000-4000-8000-000000000100'))), 1, 'Owner can list only their own capture summaries');
select ok((select public.list_capture_sessions('00000000-0000-4000-8000-000000000100')::text not like '%object_name%'), 'Session listing never reveals object keys');
do $$
begin
    for i in 1..9 loop
        perform public.create_capture_session(
            '00000000-0000-4000-8000-000000000100',
            '[{"content_type":"image/jpeg","size_bytes":10}]'::jsonb
        );
    end loop;
end;
$$;
select throws_ok(
    $$select public.create_capture_session('00000000-0000-4000-8000-000000000100', '[{"content_type":"image/jpeg","size_bytes":10}]'::jsonb)$$,
    'P0001', 'Capture limit reached; cancel or finish an earlier photo capture', 'Concurrent-safe ten-session active limit is enforced'
);
select ok(
    capture_guard.capture_object_operation_allowed((select response->'objects'->0->>'object_name' from capture_created), 'uploading'),
    'The initiating Owner is authorized for the exact live upload slot'
);
reset role;
insert into storage.objects(bucket_id, name, metadata)
select 'capture-labels', response->'objects'->0->>'object_name',
       jsonb_build_object('mimetype', 'image/jpeg', 'size', 123)
from capture_created;
insert into storage.objects(bucket_id, name, metadata)
select 'capture-labels', response->'objects'->1->>'object_name',
       jsonb_build_object('mimetype', 'image/png', 'size', 456)
from capture_created;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(
    (select count(*)::integer from storage.objects where bucket_id = 'capture-labels'),
    0,
    'Owner cannot list or download private originals before image preprocessing'
);
reset role;
set local role authenticated;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009987';
select ok(
    not capture_guard.capture_object_operation_allowed((select response->'objects'->0->>'object_name' from capture_created), 'uploading'),
    'A household Member cannot use an Owner capture upload key'
);
select ok(
    not capture_guard.capture_object_operation_allowed((select response->'objects'->0->>'object_name' from capture_created), 'deletion_pending'),
    'A household Member cannot delete an Owner capture object'
);
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select ok(
    not capture_guard.capture_object_operation_allowed((select response->'objects'->0->>'object_name' from capture_created), 'uploading'),
    'A different household Owner cannot access this capture object'
);
reset role;

-- A cancellation closes access before cleanup. The database retains the
-- reservation until Storage confirms the bytes are gone.
update private.capture_session_events
set created_at = now() - interval '2 hours'
where initiating_user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
create temporary table cancel_result as
select public.cancel_capture_session((select (response->>'session_id')::uuid from capture_created)) as response;
select is(jsonb_array_length(response->'object_names'), 2, 'Cancellation returns only the two exact paths needed for Storage API deletion') from cancel_result;
select ok(
    capture_guard.capture_object_operation_allowed((select response->'objects'->0->>'object_name' from capture_created), 'deletion_pending'),
    'Owner can delete an exact object only after closing the capture'
);
select is(
    public.complete_capture_cleanup((select (response->>'session_id')::uuid from capture_created)),
    false,
    'Database refuses to release the capture reservation while Storage objects remain'
);
select is(
    (select item->>'state' from jsonb_array_elements(public.list_capture_sessions('00000000-0000-4000-8000-000000000100')) item where item->>'session_id' = (select response->>'session_id' from capture_created)),
    'deletion_pending',
    'Cancelled captures stay closed but visible until Storage confirms deletion'
);

reset role;
update private.capture_sessions
set cleanup_retry_after = now() + interval '1 hour'
where id = (select (response->>'session_id')::uuid from capture_created);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
create temporary table expiring_capture as
select public.create_capture_session(
    '00000000-0000-4000-8000-000000000100',
    '[{"content_type":"image/jpeg","size_bytes":99}]'::jsonb
) as response;
reset role;
update private.capture_sessions
set expires_at = now() - interval '1 second'
where id = (select (response->>'session_id')::uuid from expiring_capture);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
create temporary table claimed_capture as
select * from public.claim_capture_cleanup(10);
select is((select count(*)::integer from claimed_capture), 1, 'Worker claims an expired capture for bounded cleanup');
select is((select array_length(object_names, 1) from claimed_capture), null::integer, 'Worker receives no nonexistent object paths');
create temporary table claimed_again as
select * from public.claim_capture_cleanup(10);
select is((select count(*)::integer from claimed_again), 0, 'Backoff prevents an unsuccessful first batch from starving later captures');
select is(
    public.complete_capture_cleanup((select session_id from claimed_capture)),
    true,
    'Worker releases expired capture metadata only after Storage no longer has its objects'
);

reset role;
select * from finish();
rollback;
