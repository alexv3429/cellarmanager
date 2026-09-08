begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

select ok(
    has_function_privilege(
        'authenticated',
        'public.create_household_invitation(uuid,text)',
        'EXECUTE'
    ),
    'Authenticated sessions may reach the owner-authorized create RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.create_household_invitation(uuid,text)',
        'EXECUTE'
    ),
    'Anonymous sessions cannot create invitations'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_household_invitations(uuid)',
        'EXECUTE'
    ),
    'Authenticated sessions may reach the owner-authorized list RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.get_household_invitations(uuid)',
        'EXECUTE'
    ),
    'Anonymous sessions cannot list household invitations'
);

select ok(
    has_function_privilege(
        'anon',
        'public.preview_household_invitation(text)',
        'EXECUTE'
    ),
    'Anonymous recipients can preview an invitation from its bearer token'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.preview_household_invitation(text)',
        'EXECUTE'
    ),
    'Authenticated recipients can preview an invitation'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.accept_household_invitation(text)',
        'EXECUTE'
    ),
    'Authenticated recipients may reach the accept RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.accept_household_invitation(text)',
        'EXECUTE'
    ),
    'Anonymous recipients cannot accept an invitation'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.reissue_household_invitation(uuid,uuid)',
        'EXECUTE'
    ),
    'Authenticated sessions may reach the owner-authorized reissue RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.reissue_household_invitation(uuid,uuid)',
        'EXECUTE'
    ),
    'Anonymous sessions cannot reissue invitations'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.revoke_household_invitation(uuid,uuid)',
        'EXECUTE'
    ),
    'Authenticated sessions may reach the owner-authorized revoke RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.revoke_household_invitation(uuid,uuid)',
        'EXECUTE'
    ),
    'Anonymous sessions cannot revoke invitations'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'private.generate_household_invitation_token()',
        'EXECUTE'
    ),
    'Browser clients cannot call the raw-token generator'
);

insert into auth.users (
    id,
    email,
    raw_user_meta_data
)
values
    (
        '00000000-0000-4000-8000-000000000003',
        'invitee@example.test',
        '{}'::jsonb
    ),
    (
        '00000000-0000-4000-8000-000000000004',
        'wrong@example.test',
        '{}'::jsonb
    ),
    (
        '00000000-0000-4000-8000-000000000005',
        'reissue@example.test',
        '{}'::jsonb
    ),
    (
        '00000000-0000-4000-8000-000000000006',
        'revoke@example.test',
        '{}'::jsonb
    ),
    (
        '00000000-0000-4000-8000-000000000007',
        'member@example.test',
        '{}'::jsonb
    );

insert into public.household_members (
    household_id,
    user_id,
    role
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000007',
    'member'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

create temporary table primary_invitation as
select *
from public.create_household_invitation(
    '00000000-0000-4000-8000-000000000100',
    '  Invitee@Example.Test  '
);

grant select on primary_invitation to anon;

select ok(
    (select invitation_token ~ '^[0-9a-f]{64}$'
     from primary_invitation),
    'A new invitation returns a 256-bit lowercase hexadecimal bearer token'
);

select is(
    (select invitee_email from primary_invitation),
    'invitee@example.test',
    'The create RPC returns the normalized recipient email'
);

select ok(
    (select invitation_expires_at between
        pg_catalog.now() + interval '6 days 23 hours'
        and pg_catalog.now() + interval '7 days 1 minute'
     from primary_invitation),
    'A new invitation is valid for seven days'
);

reset role;

select ok(
    exists (
        select 1
        from private.household_invitations invitation
        join primary_invitation created
          on created.invitation_id = invitation.id
        where invitation.token_digest =
                private.hash_household_invitation_token(
                    created.invitation_token
                )
          and pg_catalog.encode(invitation.token_digest, 'hex') <>
                created.invitation_token
    ),
    'Only the invitation-token digest is stored durably'
);

select is(
    (
        select pg_catalog.count(*)
        from private.household_membership_events event
        join primary_invitation created
          on created.invitation_id = event.invitation_id
        where event.event_type = 'invited'
          and event.actor_user_id =
                '00000000-0000-4000-8000-000000000001'
    ),
    1::bigint,
    'Creating an invitation writes one attributed audit event'
);

set local role authenticated;

select ok(
    exists (
        select 1
        from public.get_household_invitations(
            '00000000-0000-4000-8000-000000000100'
        ) invitation
        join primary_invitation created
          on created.invitation_id = invitation.invitation_id
        where invitation.invitee_email = 'invitee@example.test'
          and invitation.requested_role = 'member'
          and invitation.invitation_status = 'pending'
          and invitation.can_reissue
          and invitation.can_revoke
    ),
    'The owner invitation list exposes pending actions but no bearer secret'
);

select throws_ok(
    $test$
        select *
        from public.create_household_invitation(
            '00000000-0000-4000-8000-000000000100',
            'INVITEE@example.test'
        )
    $test$,
    '23505',
    'A pending invitation already exists; reissue or revoke it',
    'A duplicate pending invitation must be explicitly reissued'
);

select throws_ok(
    $test$
        select *
        from public.create_household_invitation(
            '00000000-0000-4000-8000-000000000100',
            'member@example.test'
        )
    $test$,
    '23505',
    'The invited account is already a household member',
    'An existing household member cannot receive a redundant invitation'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000007';

select throws_ok(
    $test$
        select *
        from public.create_household_invitation(
            '00000000-0000-4000-8000-000000000100',
            'unauthorized@example.test'
        )
    $test$,
    '42501',
    'Household owner permission is required',
    'A regular member cannot create invitations'
);

select throws_ok(
    $test$
        select *
        from public.get_household_invitations(
            '00000000-0000-4000-8000-000000000100'
        )
    $test$,
    '42501',
    'Household owner permission is required',
    'A regular member cannot list invitation recipients'
);

reset role;
reset request.jwt.claim.sub;
set local role anon;

select is(
    (
        select household_name
        from public.preview_household_invitation(
            (select invitation_token from primary_invitation)
        )
    ),
    'Test household A',
    'An anonymous invitation preview names the household'
);

select is(
    (
        select invitee_email_hint
        from public.preview_household_invitation(
            (select invitation_token from primary_invitation)
        )
    ),
    'i***@example.test',
    'An anonymous invitation preview masks the recipient email'
);

select is(
    (
        select invitee_email
        from public.preview_household_invitation(
            (select invitation_token from primary_invitation)
        )
    ),
    'invitee@example.test',
    'A valid private link returns its recipient for authentication prefill'
);

select is(
    (
        select account_exists
        from public.preview_household_invitation(
            (select invitation_token from primary_invitation)
        )
    ),
    true,
    'A valid private link selects sign-in for an existing recipient account'
);

select is(
    (
        select invitation_status
        from public.preview_household_invitation(
            (select invitation_token from primary_invitation)
        )
    ),
    'pending',
    'An unused invitation previews as pending'
);

select is(
    (
        select account_matches
        from public.preview_household_invitation(
            (select invitation_token from primary_invitation)
        )
    ),
    null::boolean,
    'An anonymous preview does not infer an account match'
);

select is(
    (
        select pg_catalog.count(*)
        from public.preview_household_invitation(
            pg_catalog.repeat('z', 64)
        )
    ),
    0::bigint,
    'An invalid bearer token reveals no invitation metadata'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000004';

select is(
    (
        select account_matches
        from public.preview_household_invitation(
            (select invitation_token from primary_invitation)
        )
    ),
    false,
    'The preview identifies a signed-in account with the wrong email'
);

select throws_ok(
    $test$
        select *
        from public.accept_household_invitation(
            (select invitation_token from primary_invitation)
        )
    $test$,
    '42501',
    'Sign in with the invited email address',
    'The bearer secret alone cannot add an account with another email'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select is(
    (
        select account_matches
        from public.preview_household_invitation(
            (select invitation_token from primary_invitation)
        )
    ),
    true,
    'The preview confirms the invited authenticated account'
);

create temporary table accepted_invitation as
select *
from public.accept_household_invitation(
    (select invitation_token from primary_invitation)
);

select is(
    (select membership_role from accepted_invitation),
    'member',
    'Accepting an invitation grants only the member role'
);

select ok(
    exists (
        select 1
        from public.household_members member
        join accepted_invitation accepted
          on accepted.membership_id = member.id
        where member.household_id =
                '00000000-0000-4000-8000-000000000100'
          and member.user_id =
                '00000000-0000-4000-8000-000000000003'
          and member.role = 'member'
    ),
    'Acceptance creates the durable household membership atomically'
);

reset role;

select is(
    (
        select invitation.status
        from private.household_invitations invitation
        join primary_invitation created
          on created.invitation_id = invitation.id
    ),
    'accepted',
    'Acceptance resolves the invitation as accepted'
);

select is(
    (
        select pg_catalog.count(*)
        from private.household_membership_events event
        join primary_invitation created
          on created.invitation_id = event.invitation_id
        where event.event_type = 'accepted'
          and event.member_user_id =
                '00000000-0000-4000-8000-000000000003'
    ),
    1::bigint,
    'Acceptance writes one attributed audit event'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select is(
    (
        select membership_id
        from public.accept_household_invitation(
            (select invitation_token from primary_invitation)
        )
    ),
    (select membership_id from accepted_invitation),
    'Retrying acceptance for the same account is idempotent'
);

reset role;

select is(
    (
        select pg_catalog.count(*)
        from private.household_membership_events event
        join primary_invitation created
          on created.invitation_id = event.invitation_id
        where event.event_type = 'accepted'
    ),
    1::bigint,
    'An idempotent acceptance retry does not duplicate the audit event'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

create temporary table reissue_original as
select *
from public.create_household_invitation(
    '00000000-0000-4000-8000-000000000100',
    'reissue@example.test'
);

create temporary table reissue_replacement as
select *
from public.reissue_household_invitation(
    '00000000-0000-4000-8000-000000000100',
    (select invitation_id from reissue_original)
);

select isnt(
    (select invitation_token from reissue_replacement),
    (select invitation_token from reissue_original),
    'Reissuing returns a fresh bearer token'
);

reset role;

select is(
    (
        select invitation.status
        from private.household_invitations invitation
        join reissue_original original
          on original.invitation_id = invitation.id
    ),
    'superseded',
    'Reissuing makes the previous invitation terminal'
);

select is(
    (
        select invitation.supersedes_invitation_id
        from private.household_invitations invitation
        join reissue_replacement replacement
          on replacement.invitation_id = invitation.id
    ),
    (select invitation_id from reissue_original),
    'The replacement retains the invitation lineage'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select invitation_status
        from public.preview_household_invitation(
            (select invitation_token from reissue_original)
        )
    ),
    'superseded',
    'The previous invitation link previews as superseded'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000005';

select throws_ok(
    $test$
        select *
        from public.accept_household_invitation(
            (select invitation_token from reissue_original)
        )
    $test$,
    '22023',
    'Invitation link is invalid or no longer available',
    'The superseded bearer token can no longer be accepted'
);

select is(
    (
        select account_matches
        from public.preview_household_invitation(
            (select invitation_token from reissue_replacement)
        )
    ),
    true,
    'The replacement invitation is ready for the intended account'
);

reset role;

select is(
    (
        select pg_catalog.count(*)
        from private.household_membership_events event
        where event.invitation_id in (
            (select invitation_id from reissue_original),
            (select invitation_id from reissue_replacement)
        )
          and event.event_type in ('invited', 'invitation_superseded')
    ),
    3::bigint,
    'Reissuing preserves the original invite, supersession, and replacement audit events'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

create temporary table revoked_invitation as
select *
from public.create_household_invitation(
    '00000000-0000-4000-8000-000000000100',
    'revoke@example.test'
);

select is(
    (
        select invitation_status
        from public.revoke_household_invitation(
            '00000000-0000-4000-8000-000000000100',
            (select invitation_id from revoked_invitation)
        )
    ),
    'revoked',
    'An owner can cancel an unexpired pending invitation'
);

select is(
    (
        select invitation_status
        from public.preview_household_invitation(
            (select invitation_token from revoked_invitation)
        )
    ),
    'revoked',
    'A cancelled invitation link previews as revoked'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000006';

select throws_ok(
    $test$
        select *
        from public.accept_household_invitation(
            (select invitation_token from revoked_invitation)
        )
    $test$,
    '22023',
    'Invitation link is invalid or no longer available',
    'A revoked invitation cannot be accepted'
);

reset role;

select is(
    (
        select pg_catalog.count(*)
        from private.household_membership_events event
        join revoked_invitation revoked
          on revoked.invitation_id = event.invitation_id
        where event.event_type = 'invitation_revoked'
    ),
    1::bigint,
    'Revoking an invitation writes one audit event'
);

select * from finish();

rollback;
