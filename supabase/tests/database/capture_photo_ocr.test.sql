begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.complete_capture_ocr(uuid,jsonb,text,text)', 'execute'), 'Anonymous users cannot save OCR text');
select ok(has_function_privilege('authenticated', 'public.complete_capture_ocr(uuid,jsonb,text,text)', 'execute'), 'Authenticated owners can save their own OCR text');
select ok(has_function_privilege('authenticated', 'public.list_capture_ocr_result(uuid)', 'execute'), 'Authenticated owners can read their own OCR text');
select ok(not has_table_privilege('authenticated', 'private.capture_ocr_results', 'select'), 'OCR text cannot be read directly from its private table');
select ok(not has_table_privilege('service_role', 'private.capture_ocr_results', 'select'), 'Service workers cannot read OCR text');
select ok(has_function_privilege('service_role', 'public.claim_capture_cleanup(integer)', 'execute'), 'Cleanup worker can expire private OCR captures');
select ok(not has_function_privilege('authenticated', 'public.claim_capture_cleanup(integer)', 'execute'), 'Owners cannot claim cleanup jobs');

insert into auth.users(id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000009986', 'capture-ocr-member@example.test', '{}');
insert into public.household_members(household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009986', 'member');

create temporary table ocr_capture(response jsonb);
grant select, insert on ocr_capture to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
insert into ocr_capture
select public.create_capture_session(
    '00000000-0000-4000-8000-000000000100',
    '[{"content_type":"image/jpeg","size_bytes":8}]'::jsonb
);
reset role;

update private.capture_sessions
set state = 'processed'
where id = (select (response->>'session_id')::uuid from ocr_capture);
update private.capture_assets
set object_name = 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    state = 'processed',
    uploaded_bytes = 8,
    uploaded_at = now()
where session_id = (select (response->>'session_id')::uuid from ocr_capture);
insert into storage.objects(bucket_id, name, metadata)
values ('capture-labels', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', '{"mimetype":"image/jpeg","size":8}'::jsonb);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok(
    $$select public.complete_capture_ocr((select (response->>'session_id')::uuid from ocr_capture), 'null'::jsonb, 'fra+eng', '7.0.0')$$,
    '22023', 'OCR result is invalid', 'Non-array OCR payloads are rejected safely'
);
select throws_ok(
    $$select public.complete_capture_ocr((select (response->>'session_id')::uuid from ocr_capture), '["not a page"]'::jsonb, 'fra+eng', '7.0.0')$$,
    '22023', 'OCR result is invalid', 'Malformed page data is rejected before field validation'
);
create temporary table ocr_saved as
select public.complete_capture_ocr(
    (select (response->>'session_id')::uuid from ocr_capture),
    '[{"object_name":"f47ac10b-58cc-4372-a567-0e02b2c3d479","text":"Domaine Exemple\nBourgogne blanc 2022","confidence":91}]'::jsonb,
    'fra+eng',
    '7.0.0'
) as result;
select is(result->>'state', 'ocr_deletion_pending', 'Saving text closes photo access and starts photo deletion') from ocr_saved;
select is(jsonb_array_length(result->'object_names'), 1, 'Only the exact stored photo path is returned for deletion') from ocr_saved;
select ok(capture_guard.capture_object_operation_allowed('f47ac10b-58cc-4372-a567-0e02b2c3d479', 'deletion_pending'), 'Owner can delete the prepared photo after its text is saved');
select is(
    (public.list_capture_ocr_result((select (response->>'session_id')::uuid from ocr_capture))->'recognized_pages'->0->>'text'),
    'Domaine Exemple
Bourgogne blanc 2022',
    'Owner can read the private recognized text'
);
select ok(
    public.list_capture_ocr_result((select (response->>'session_id')::uuid from ocr_capture))::text not like '%object_name%',
    'The result reader does not expose private Storage object keys'
);
select is(
    public.complete_capture_cleanup((select (response->>'session_id')::uuid from ocr_capture)),
    false,
    'Cleanup cannot mark the image deleted while Storage still contains it'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009986';
select throws_ok(
    $$select public.list_capture_ocr_result((select (response->>'session_id')::uuid from ocr_capture))$$,
    '42501', 'Capture is not available to this account', 'A household Member cannot read an Owner OCR draft'
);
select ok(not capture_guard.capture_object_operation_allowed('f47ac10b-58cc-4372-a567-0e02b2c3d479', 'deletion_pending'), 'A household Member cannot delete an Owner photo');

reset role;
update private.capture_sessions
set state = 'recognized', expires_at = now() - interval '1 second'
where id = (select (response->>'session_id')::uuid from ocr_capture);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(
    public.complete_capture_cleanup((select (response->>'session_id')::uuid from ocr_capture)),
    false,
    'Expired OCR text is not released before any remaining Storage image is removed'
);
reset role;
select is(
    (select state from private.capture_sessions where id = (select (response->>'session_id')::uuid from ocr_capture)),
    'deletion_pending',
    'Expired OCR drafts enter the retriable image-deletion flow'
);
select is(
    (select count(*)::integer from private.capture_ocr_results where session_id = (select (response->>'session_id')::uuid from ocr_capture)),
    1,
    'OCR text remains available only to cleanup until Storage deletion succeeds'
);

insert into private.capture_sessions(
    id, household_id, initiating_user_id, state, expires_at, reserved_bytes
)
values (
    '00000000-0000-4000-8000-000000009985',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000001',
    'ocr_deletion_pending', now() + interval '1 hour', 1024
);
insert into private.capture_ocr_results(session_id, language_code, engine_version, recognized_pages)
values (
    '00000000-0000-4000-8000-000000009985',
    'fra+eng',
    '7.0.0',
    '[{"object_name":"550e8400-e29b-41d4-a716-446655440000","text":"Domaine Exemple","confidence":90}]'::jsonb
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(
    public.complete_capture_cleanup('00000000-0000-4000-8000-000000009985'),
    true,
    'A capture becomes recognized after Storage confirms the photo is absent'
);
select is(
    (select item->>'photo_count' from jsonb_array_elements(public.list_capture_sessions('00000000-0000-4000-8000-000000000100')) item where item->>'session_id' = '00000000-0000-4000-8000-000000009985'),
    '0',
    'Recognized text-only drafts no longer appear to contain photos'
);
select is(
    (public.list_capture_ocr_result('00000000-0000-4000-8000-000000009985')->'recognized_pages'->0->>'text'),
    'Domaine Exemple',
    'The owner can retrieve recognized text after its photo is deleted'
);
reset role;
select is(
    (select state from private.capture_sessions where id = '00000000-0000-4000-8000-000000009985'),
    'recognized',
    'The recognized text-only session is retained'
);
select is(
    (select reserved_bytes from private.capture_sessions where id = '00000000-0000-4000-8000-000000009985'),
    0::bigint,
    'Photo-storage reservation is released once the photo is confirmed deleted'
);
select ok(
    (select recognized_pages::text not like '%object_name%' from private.capture_ocr_results where session_id = '00000000-0000-4000-8000-000000009985'),
    'The persistent text-only draft no longer retains the deleted photo key'
);

select * from finish();
rollback;
