begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.upload_request(p_id uuid, p_type text default 'MOVE', p_wine uuid default '00000000-0000-4000-8000-000000000110')
returns jsonb language sql as $$ select jsonb_build_object(
    'id', p_id, 'household_id', '00000000-0000-4000-8000-000000000100',
    'user_id', '00000000-0000-4000-8000-000000000001', 'device_id', '00000000-0000-4000-8000-000000000101',
    'operation_type', p_type, 'wine_id', p_wine, 'quantity', 2,
    'source_location_id', case when p_type = 'ADD' then null else '00000000-0000-4000-8000-000000000121' end,
    'destination_location_id', '00000000-0000-4000-8000-000000000122', 'remove_reason', null,
    'created_at_client', '2026-09-12T12:00:00Z', 'wine_label', 'Synthetic wine'); $$;

select ok(not has_function_privilege('anon', 'public.stop_inventory_upload(uuid,jsonb)', 'execute'), 'Anonymous cancellation denied');
select ok(not has_function_privilege('anon', 'public.get_stopped_inventory_uploads(uuid)', 'execute'), 'Anonymous history denied');
select ok(not has_table_privilege('authenticated', 'private.stopped_inventory_uploads', 'select'), 'Stop records cannot be read directly');
select ok(not has_table_privilege('authenticated', 'private.stopped_inventory_uploads', 'insert'), 'Stop records cannot be forged directly');
select ok(not has_table_privilege('authenticated', 'private.stopped_inventory_uploads', 'delete'), 'Stop records cannot be revived by deletion');
select ok(not has_function_privilege('authenticated', 'private.apply_inventory_operation_before_stop(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text)', 'execute'), 'Stock stop guard cannot be bypassed');
select ok(not has_function_privilege('authenticated', 'private.apply_add_inventory_operation_before_stop(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz)', 'execute'), 'New-wine stop guard cannot be bypassed');
select ok(not has_function_privilege('authenticated', 'private.inventory_upload_was_stopped(uuid,uuid,uuid)', 'execute'), 'Private stop lookup cannot be called directly');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok($$select public.stop_inventory_upload('00000000-0000-4000-8000-000000093001', pg_temp.upload_request('00000000-0000-4000-8000-000000093099'))$$,
    '22023', 'The original request identity and quantity are required', 'Mismatched request ID is refused');
select throws_ok($$select public.stop_inventory_upload('00000000-0000-4000-8000-000000093001', pg_temp.upload_request('00000000-0000-4000-8000-000000093001') || '{"quantity":0}')$$,
    '22023', 'The original request identity and quantity are required', 'Zero quantity is refused');
select throws_ok($$select public.stop_inventory_upload('00000000-0000-4000-8000-000000093001', '[]'::jsonb)$$,
    '22023', 'A bounded original inventory request is required', 'Malformed request is refused');
select throws_ok($$select public.stop_inventory_upload('00000000-0000-4000-8000-000000093001', pg_temp.upload_request('00000000-0000-4000-8000-000000093001') || jsonb_build_object('wine_label', repeat('x', 8192)))$$,
    '22023', 'A bounded original inventory request is required', 'Oversized private payload is refused');
select is(public.stop_inventory_upload('00000000-0000-4000-8000-000000093001', pg_temp.upload_request('00000000-0000-4000-8000-000000093001'))->>'status', 'STOPPED', 'An own queued request can be stopped');
select is(public.stop_inventory_upload('00000000-0000-4000-8000-000000093001', pg_temp.upload_request('00000000-0000-4000-8000-000000093001'))->>'status', 'STOPPED', 'Cancellation replay is idempotent');
select is(public.stop_inventory_upload('00000000-0000-4000-8000-000000093001', pg_temp.upload_request('00000000-0000-4000-8000-000000093001') || '{"wine_label":"Renamed display"}')->>'status', 'STOPPED', 'Display-only changes do not prevent receipt recovery');
select throws_ok($$select public.stop_inventory_upload('00000000-0000-4000-8000-000000093001', pg_temp.upload_request('00000000-0000-4000-8000-000000093001') || '{"quantity":3}')$$,
    '22023', 'A stopped request cannot be rewritten', 'Original intent cannot be overwritten');
select is((select operation_error_code from public.apply_inventory_operation('00000000-0000-4000-8000-000000093001', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'MOVE', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000122', 2, '2026-09-12T12:00:00Z', null)),
    'USER_CANCELLED', 'A stopped operation receives a terminal receipt instead of modifying stock');
select is((select quantity from public.holdings where id = '00000000-0000-4000-8000-000000000130'), 5, 'Stopping does not alter stock');
select is((select count(*)::int from public.inventory_operations where id = '00000000-0000-4000-8000-000000093001'), 0, 'No fabricated stock journal row');

select is(public.stop_inventory_upload('00000000-0000-4000-8000-000000093002', pg_temp.upload_request('00000000-0000-4000-8000-000000093002', 'ADD', '00000000-0000-4000-8000-000000093900'))->>'status', 'STOPPED', 'An offline ADD can be stopped before its wine exists');
select is((select operation_error_code from public.apply_add_inventory_operation('00000000-0000-4000-8000-000000093002', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000093900', 'Synthetic', 'Never created', 2020, 'red', null, null, 750, '00000000-0000-4000-8000-000000000122', 2, '2026-09-12T12:00:00Z')),
    'USER_CANCELLED', 'New-wine upload sees the stop before creating its wine');
select is((select operation_error_code from public.apply_add_inventory_operation('00000000-0000-4000-8000-000000093002', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000093900', 'Synthetic', 'Never created', 2020, '00000000-0000-4000-8000-000000000122', 2, '2026-09-12T12:00:00Z')),
    'USER_CANCELLED', 'Legacy ADD overload cannot bypass stopping');
select is((select count(*)::int from public.wines where id = '00000000-0000-4000-8000-000000093900'), 0, 'No phantom catalog wine is created');

select lives_ok($$select public.apply_inventory_operation('00000000-0000-4000-8000-000000093003', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'MOVE', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000122', 2, '2026-09-12T12:00:00Z', null)$$, 'Unstopped request can still be accepted');
select is(public.stop_inventory_upload('00000000-0000-4000-8000-000000093003', pg_temp.upload_request('00000000-0000-4000-8000-000000093003'))->>'status', 'ACCEPTED', 'Lost accepted response returns its real receipt');
select throws_ok($$select public.stop_inventory_upload('00000000-0000-4000-8000-000000093003', pg_temp.upload_request('00000000-0000-4000-8000-000000093003') || '{"quantity":3}')$$,
    '22023', 'operation_id was reused with a different payload', 'An accepted receipt cannot acknowledge different queued intent');
select throws_ok($$select public.stop_inventory_upload('00000000-0000-4000-8000-000000093003', pg_temp.upload_request('00000000-0000-4000-8000-000000093003', 'MOVE', '00000000-0000-4000-8000-000000093900'))$$,
    '22023', 'operation_id was reused with a different payload', 'An accepted receipt cannot acknowledge another wine');
select is((select quantity from public.holdings where id = '00000000-0000-4000-8000-000000000130'), 3, 'Already accepted stock is never undone');
select is(jsonb_array_length(public.get_stopped_inventory_uploads('00000000-0000-4000-8000-000000000100')), 2, 'Only genuinely stopped requests enter private history');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is(jsonb_array_length(public.get_stopped_inventory_uploads('00000000-0000-4000-8000-000000000100')), 0, 'Another account cannot read private stops');
select is(jsonb_array_length(public.get_stopped_inventory_uploads(null)), 0, 'Unfiltered private history still excludes another account');
select throws_ok($$select public.stop_inventory_upload('00000000-0000-4000-8000-000000093004', pg_temp.upload_request('00000000-0000-4000-8000-000000093004') || '{"user_id":"00000000-0000-4000-8000-000000000002"}')$$,
    '42501', 'Only the originating account can stop this upload', 'Another account cannot stop another device request');
select throws_ok($$select public.apply_inventory_operation('00000000-0000-4000-8000-000000093001', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'MOVE', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000122', 2, now(), null)$$,
    '42501', 'This inventory request belongs to another account or registration', 'Another user cannot steal a stopped receipt');

reset role;
update public.devices set revoked_at = now() where id = '00000000-0000-4000-8000-000000000101';
update public.household_members set role = 'member' where household_id = '00000000-0000-4000-8000-000000000100' and user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(public.stop_inventory_upload('00000000-0000-4000-8000-000000093005', pg_temp.upload_request('00000000-0000-4000-8000-000000093005'))->>'status', 'STOPPED', 'Demoted owner with revoked device can stop their own old queue');
select is(public.stop_inventory_upload('00000000-0000-4000-8000-000000093003', pg_temp.upload_request('00000000-0000-4000-8000-000000093003'))->>'status', 'ACCEPTED', 'A demoted author can recover their own accepted receipt');
select throws_ok($$select public.apply_inventory_operation('00000000-0000-4000-8000-000000093006', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', 'MOVE', '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000122', 1, now(), null)$$,
    '42501', 'Household owner permission is required', 'Recovery grants no stock-write permission');
reset role;
delete from public.household_members where household_id = '00000000-0000-4000-8000-000000000100' and user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.stop_inventory_upload('00000000-0000-4000-8000-000000093007', pg_temp.upload_request('00000000-0000-4000-8000-000000093007'))->>'status', 'STOPPED', 'Removed membership does not trap its own browser queue');
reset role;
select is((select count(*)::int from public.inventory_operations where id::text like '%09300%'), 1, 'Only the genuinely accepted operation is in the stock journal');
select is((select request->>'wine_label' from private.stopped_inventory_uploads where operation_id = '00000000-0000-4000-8000-000000093001'), 'Synthetic wine', 'First captured request is preserved');
select * from finish();
rollback;
