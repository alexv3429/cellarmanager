begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.claim_household_invitation_email(uuid,uuid,text)', 'EXECUTE'), 'Anonymous sessions cannot claim email delivery');
select ok(not has_function_privilege('authenticated', 'public.claim_household_invitation_email(uuid,uuid,text)', 'EXECUTE'), 'Clients cannot impersonate the actor passed to the trusted delivery claim');
select ok(has_function_privilege('service_role', 'public.claim_household_invitation_email(uuid,uuid,text)', 'EXECUTE'), 'Worker can claim a delivery');
select ok(not has_function_privilege('authenticated', 'public.complete_household_invitation_email(uuid,text)', 'EXECUTE'), 'Clients cannot mark emails sent');
select ok(not has_table_privilege('authenticated', 'private.household_invitation_deliveries', 'SELECT'), 'Clients cannot read the private delivery ledger');
select ok(not has_function_privilege('anon', 'public.get_household_invitation_deliveries(uuid)', 'EXECUTE'), 'Anonymous users cannot read delivery status');

insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-4000-8000-000000000007','member@example.test','{}');
insert into public.household_members(household_id,user_id,role) values ('00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000007','member');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
create temporary table email_invitation as select * from public.create_household_invitation('00000000-0000-4000-8000-000000000100','email@example.test');
grant select on email_invitation to service_role;
select is((select count(*) from public.get_household_invitation_deliveries('00000000-0000-4000-8000-000000000100')), 0::bigint, 'Link creation does not send email');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000007';
select throws_ok($$select * from public.get_household_invitation_deliveries('00000000-0000-4000-8000-000000000100')$$, '42501', 'Household owner permission is required', 'Members cannot list delivery history');
reset role;

set local role service_role;
select throws_ok($$select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000002',(select invitation_id from email_invitation),(select invitation_token from email_invitation))$$, '42501', 'Invitation cannot be emailed', 'Unrelated owner cannot send another household invitation');
select throws_ok($$select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000007',(select invitation_id from email_invitation),(select invitation_token from email_invitation))$$, '42501', 'Invitation cannot be emailed', 'A member cannot send invitations');
select throws_ok($$select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000001',(select invitation_id from email_invitation),repeat('b',64))$$, '42501', 'Invitation cannot be emailed', 'Wrong token cannot send email');
create temporary table email_claim as select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000001',(select invitation_id from email_invitation),(select invitation_token from email_invitation));
select is((select invitee_email from email_claim), 'email@example.test', 'Recipient comes from the durable invitation');
select is((select household_name from email_claim), 'Test household A', 'Household comes from the durable invitation');
select throws_ok($$select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000001',(select invitation_id from email_invitation),(select invitation_token from email_invitation))$$, 'P0001', 'Invitation email rate limit reached', 'Repeated requests cannot spam the recipient');
select lives_ok($$select public.complete_household_invitation_email((select delivery_id from email_claim),'sent')$$, 'Worker records successful SMTP acceptance');
select throws_ok($$select public.complete_household_invitation_email((select delivery_id from email_claim),'delivered')$$, '22023', 'Invalid delivery outcome', 'Delivery claims cannot invent inbox confirmation');
reset role;
select is((select status from private.household_invitation_deliveries where invitation_id = (select invitation_id from email_invitation)), 'sent', 'Delivery result is recorded privately');
select public.complete_household_invitation_email((select delivery_id from email_claim), 'failed');
select is((select status from private.household_invitation_deliveries where invitation_id = (select invitation_id from email_invitation)), 'sent', 'Completion cannot rewrite a terminal delivery outcome');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is((select delivery_status from public.get_household_invitation_deliveries('00000000-0000-4000-8000-000000000100')), 'sent', 'Owner sees email result separately from invitation state');
select is((select invitation_status from public.get_household_invitations('00000000-0000-4000-8000-000000000100')), 'pending', 'Email sending never grants membership or accepts invitations');
create temporary table replacement as select * from public.reissue_household_invitation('00000000-0000-4000-8000-000000000100',(select invitation_id from email_invitation));
reset role;
select throws_ok($$select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000001',(select invitation_id from replacement),(select invitation_token from replacement))$$, 'P0001', 'Invitation email rate limit reached', 'Replacement links cannot bypass recipient throttle');
select throws_ok($$select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000001',(select invitation_id from email_invitation),(select invitation_token from email_invitation))$$, '42501', 'Invitation cannot be emailed', 'Superseded invitations cannot be emailed');

-- Simulate a Worker interrupted after sending. Only synthetic fixtures change.
update private.household_invitation_deliveries set created_at = now() - interval '3 minutes', status = 'sending', completed_at = null;
set local role authenticated;
select is((select delivery_status from public.get_household_invitation_deliveries('00000000-0000-4000-8000-000000000100')), 'unconfirmed', 'Interrupted sending cannot appear stuck indefinitely');
select public.revoke_household_invitation('00000000-0000-4000-8000-000000000100',(select invitation_id from replacement));
reset role;
select throws_ok($$select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000001',(select invitation_id from replacement),(select invitation_token from replacement))$$, '42501', 'Invitation cannot be emailed', 'Cancelled invitations cannot be emailed');

set local role authenticated;
create temporary table budget_invitation as select * from public.create_household_invitation('00000000-0000-4000-8000-000000000100','budget@example.test');
reset role;
insert into private.household_invitation_deliveries(invitation_id,actor_user_id,created_at,status)
select (select invitation_id from email_invitation),'00000000-0000-4000-8000-000000000001',now()-interval '10 minutes','failed' from generate_series(1,19);
select throws_ok($$select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000001',(select invitation_id from budget_invitation),(select invitation_token from budget_invitation))$$, 'P0001', 'Invitation email rate limit reached', 'Household budget counts failed attempts across different recipients');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
create temporary table other_invitation as select * from public.create_household_invitation('00000000-0000-4000-8000-000000000200','other@example.test');
reset role;
insert into private.household_invitation_deliveries(invitation_id,actor_user_id,created_at,status)
select (select invitation_id from email_invitation),'00000000-0000-4000-8000-000000000001',now()-interval '10 minutes','failed' from generate_series(1,30);
select throws_ok($$select * from public.claim_household_invitation_email('00000000-0000-4000-8000-000000000002',(select invitation_id from other_invitation),(select invitation_token from other_invitation))$$, 'P0001', 'Invitation email rate limit reached', 'Global budget is shared across households');

select * from finish();
rollback;
