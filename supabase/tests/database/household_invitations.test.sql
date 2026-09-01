begin;

create extension if not exists pgtap with schema extensions;

select plan(56);

select has_table(
    'private',
    'household_invitations',
    'Invitations have a private durable store'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'private.household_invitations',
        'SELECT'
    ),
    'Authenticated browsers cannot read invitation recipients or digests'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'private.household_invitations',
        'INSERT'
    ),
    'Authenticated browsers cannot insert invitation records directly'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'private.household_invitations',
        'UPDATE'
    ),
    'Authenticated browsers cannot update invitation records directly'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'private.household_invitations',
        'DELETE'
    ),
    'Authenticated browsers cannot delete invitation history'
);

select is(
    (
        select pg_catalog.count(*)
        from information_schema.tables table_row
        where table_row.table_schema = 'public'
          and table_row.table_name = 'household_invitations'
    ),
    0::bigint,
    'Invitation data is not exposed as a public API table'
);

select has_column(
    'private',
    'household_invitations',
    'invitee_email_normalized',
    'Invitation recipients have a canonical comparison identity'
);

select has_column(
    'private',
    'household_invitations',
    'token_digest',
    'Invitation bearer tokens are represented by a digest'
);

select is(
    (
        select pg_catalog.count(*)
        from information_schema.columns column_row
        where column_row.table_schema = 'private'
          and column_row.table_name = 'household_invitations'
          and column_row.column_name in (
              'token',
              'raw_token',
              'invitation_token'
          )
    ),
    0::bigint,
    'The durable model has no raw bearer-token column'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'private.normalize_household_invitation_email(text)',
        'EXECUTE'
    ),
    'Email normalization remains an internal implementation helper'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'private.hash_household_invitation_token(text)',
        'EXECUTE'
    ),
    'Token hashing remains an internal implementation helper'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'private.effective_household_invitation_status(text,timestamp with time zone)',
        'EXECUTE'
    ),
    'Effective invitation status remains behind future narrow RPCs'
);

select is(
    private.normalize_household_invitation_email(
        '  Invitee@Example.Test  '
    ),
    'invitee@example.test',
    'Recipient email comparison is trimmed and case-insensitive'
);

select is(
    pg_catalog.octet_length(
        private.hash_household_invitation_token('token-alpha')
    ),
    32,
    'Invitation secrets use a SHA-256 digest'
);

select is(
    private.hash_household_invitation_token('token-alpha'),
    private.hash_household_invitation_token('token-alpha'),
    'The same bearer token resolves to the same lookup digest'
);

select isnt(
    private.hash_household_invitation_token('token-alpha'),
    private.hash_household_invitation_token('token-beta'),
    'Different bearer tokens do not share a digest'
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
        'expired@example.test',
        '{}'::jsonb
    );

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select lives_ok(
    $test$
        insert into private.household_invitations (
            id,
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000601',
            '00000000-0000-4000-8000-000000000100',
            'Invitee@Example.Test',
            private.hash_household_invitation_token(
                'token-alpha'
            ),
            '00000000-0000-4000-8000-000000000001',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    'An owner can create one internal pending invitation record'
);

select is(
    (
        select invitation.invitee_email_normalized
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000601'
    ),
    'invitee@example.test',
    'The stored comparison identity is canonical'
);

select is(
    (
        select invitation.requested_role
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000601'
    ),
    'member',
    'Invitations grant only the least-privileged member role'
);

select is(
    (
        select invitation.status
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000601'
    ),
    'pending',
    'A new invitation begins pending'
);

select is(
    (
        select private.effective_household_invitation_status(
            invitation.status,
            invitation.expires_at
        )
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000601'
    ),
    'pending',
    'An unexpired pending invitation remains effective'
);

select ok(
    (
        select pg_catalog.octet_length(invitation.token_digest) = 32
           and pg_catalog.encode(
                invitation.token_digest,
                'escape'
           ) <> 'token-alpha'
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000601'
    ),
    'The durable row contains a digest rather than the bearer secret'
);

select throws_ok(
    $test$
        insert into private.household_invitations (
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            'INVITEE@example.test',
            private.hash_household_invitation_token(
                'duplicate-recipient-token'
            ),
            '00000000-0000-4000-8000-000000000001',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    '23505',
    null,
    'A household cannot have two pending invites for one email identity'
);

select throws_ok(
    $test$
        insert into private.household_invitations (
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            'other@example.test',
            private.hash_household_invitation_token(
                'token-alpha'
            ),
            '00000000-0000-4000-8000-000000000001',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    '23505',
    null,
    'A bearer-token digest cannot identify two invitation records'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000002';

select throws_ok(
    $test$
        insert into private.household_invitations (
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            'unauthorized@example.test',
            private.hash_household_invitation_token(
                'unauthorized-token'
            ),
            '00000000-0000-4000-8000-000000000002',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    '42501',
    'Household owner permission is required',
    'An owner of another household cannot create an invitation'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select throws_ok(
    $test$
        insert into private.household_invitations (
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            'wrong-actor@example.test',
            private.hash_household_invitation_token(
                'wrong-actor-token'
            ),
            '00000000-0000-4000-8000-000000000002',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    '42501',
    'Invitation creator must be the authenticated user',
    'Invitation provenance cannot name a different creator'
);

select throws_ok(
    $test$
        insert into private.household_invitations (
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            'owner-a@example.test',
            private.hash_household_invitation_token(
                'existing-member-token'
            ),
            '00000000-0000-4000-8000-000000000001',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    '23505',
    'The invited account is already a household member',
    'A current member cannot also receive a pending invitation'
);

select throws_ok(
    $test$
        insert into private.household_invitations (
            household_id,
            invitee_email,
            requested_role,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            'future-owner@example.test',
            'owner',
            private.hash_household_invitation_token(
                'future-owner-token'
            ),
            '00000000-0000-4000-8000-000000000001',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    '23514',
    null,
    'An invitation cannot bypass the explicit promotion workflow'
);

select throws_ok(
    $test$
        insert into private.household_invitations (
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            'too-long@example.test',
            private.hash_household_invitation_token(
                'too-long-token'
            ),
            '00000000-0000-4000-8000-000000000001',
            pg_catalog.now() + interval '31 days'
        )
    $test$,
    '23514',
    null,
    'Invitation validity cannot exceed the bounded 30-day maximum'
);

select throws_ok(
    $test$
        insert into private.household_invitations (
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            status,
            expires_at,
            resolved_at,
            resolved_by_user_id,
            accepted_by_user_id,
            accepted_membership_id
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            'preaccepted@example.test',
            private.hash_household_invitation_token(
                'preaccepted-token'
            ),
            '00000000-0000-4000-8000-000000000001',
            'accepted',
            pg_catalog.now() + interval '7 days',
            pg_catalog.now(),
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000001',
            gen_random_uuid()
        )
    $test$,
    '23514',
    'A household invitation must begin pending',
    'A terminal invitation cannot be fabricated on insert'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000004';

select throws_ok(
    $test$
        update private.household_invitations
        set status = 'accepted',
            resolved_at = pg_catalog.now(),
            resolved_by_user_id =
                '00000000-0000-4000-8000-000000000004',
            accepted_by_user_id =
                '00000000-0000-4000-8000-000000000004',
            accepted_membership_id =
                '00000000-0000-4000-8000-000000000604'
        where id = '00000000-0000-4000-8000-000000000601'
    $test$,
    '42501',
    'Invitation email does not match the authenticated account',
    'A different signed-in account cannot accept the bearer invitation'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select throws_ok(
    $test$
        update private.household_invitations
        set status = 'accepted',
            resolved_at = pg_catalog.now(),
            resolved_by_user_id =
                '00000000-0000-4000-8000-000000000003',
            accepted_by_user_id =
                '00000000-0000-4000-8000-000000000003',
            accepted_membership_id =
                '00000000-0000-4000-8000-000000000603'
        where id = '00000000-0000-4000-8000-000000000601'
    $test$,
    '23503',
    'Accepted invitation must reference its matching membership',
    'Acceptance cannot resolve before the membership exists'
);

select lives_ok(
    $test$
        insert into public.household_members (
            id,
            household_id,
            user_id,
            role
        )
        values (
            '00000000-0000-4000-8000-000000000603',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000003',
            'member'
        )
    $test$,
    'The acceptance transaction can create the requested membership'
);

select lives_ok(
    $test$
        update private.household_invitations
        set status = 'accepted',
            resolved_at = pg_catalog.now(),
            resolved_by_user_id =
                '00000000-0000-4000-8000-000000000003',
            accepted_by_user_id =
                '00000000-0000-4000-8000-000000000003',
            accepted_membership_id =
                '00000000-0000-4000-8000-000000000603'
        where id = '00000000-0000-4000-8000-000000000601'
    $test$,
    'The matching account can resolve the invitation after membership creation'
);

select is(
    (
        select invitation.status
            || ':'
            || invitation.accepted_by_user_id::text
            || ':'
            || invitation.accepted_membership_id::text
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000601'
    ),
    'accepted:00000000-0000-4000-8000-000000000003:00000000-0000-4000-8000-000000000603',
    'Accepted history retains the account and membership attribution'
);

select is(
    (
        select private.effective_household_invitation_status(
            invitation.status,
            invitation.expires_at
        )
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000601'
    ),
    'accepted',
    'A terminal accepted status is not changed by its former deadline'
);

select throws_ok(
    $test$
        update private.household_invitations
        set resolved_at = resolved_at + interval '1 minute'
        where id = '00000000-0000-4000-8000-000000000601'
    $test$,
    '55000',
    'A resolved invitation is immutable',
    'Accepted invitation history cannot be rewritten'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select lives_ok(
    $test$
        insert into private.household_invitations (
            id,
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            created_at,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000610',
            '00000000-0000-4000-8000-000000000100',
            'expired@example.test',
            private.hash_household_invitation_token(
                'expired-token'
            ),
            '00000000-0000-4000-8000-000000000001',
            pg_catalog.now() - interval '2 days',
            pg_catalog.now() - interval '1 day'
        )
    $test$,
    'A historical pending record can retain its original deadline'
);

select is(
    (
        select private.effective_household_invitation_status(
            invitation.status,
            invitation.expires_at
        )
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000610'
    ),
    'expired',
    'A passed deadline is treated as expired before cleanup runs'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000005';

select throws_ok(
    $test$
        update private.household_invitations
        set status = 'accepted',
            resolved_at = pg_catalog.now(),
            resolved_by_user_id =
                '00000000-0000-4000-8000-000000000005',
            accepted_by_user_id =
                '00000000-0000-4000-8000-000000000005',
            accepted_membership_id =
                '00000000-0000-4000-8000-000000000605'
        where id = '00000000-0000-4000-8000-000000000610'
    $test$,
    '22023',
    'Invitation has expired',
    'A matching account cannot accept after the deadline'
);

select lives_ok(
    $test$
        update private.household_invitations
        set status = 'expired',
            resolved_at = pg_catalog.now()
        where id = '00000000-0000-4000-8000-000000000610'
    $test$,
    'Cleanup can persist the effective expired terminal state'
);

select is(
    (
        select invitation.status
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000610'
    ),
    'expired',
    'The expired terminal state is durable'
);

select throws_ok(
    $test$
        update private.household_invitations
        set status = 'pending',
            resolved_at = null
        where id = '00000000-0000-4000-8000-000000000610'
    $test$,
    '55000',
    'A resolved invitation is immutable',
    'An expired invitation cannot be revived'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select lives_ok(
    $test$
        insert into private.household_invitations (
            id,
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000620',
            '00000000-0000-4000-8000-000000000100',
            'reissue@example.test',
            private.hash_household_invitation_token(
                'reissue-token-one'
            ),
            '00000000-0000-4000-8000-000000000001',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    'A separate recipient can have a pending invitation'
);

select lives_ok(
    $test$
        update private.household_invitations
        set status = 'superseded',
            resolved_at = pg_catalog.now(),
            resolved_by_user_id =
                '00000000-0000-4000-8000-000000000001'
        where id = '00000000-0000-4000-8000-000000000620'
    $test$,
    'An owner can close an invitation before issuing a replacement'
);

select lives_ok(
    $test$
        insert into private.household_invitations (
            id,
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            supersedes_invitation_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000621',
            '00000000-0000-4000-8000-000000000100',
            'REISSUE@example.test',
            private.hash_household_invitation_token(
                'reissue-token-two'
            ),
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000620',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    'Reissuing creates a fresh token row linked to the closed attempt'
);

select is(
    (
        select replacement.supersedes_invitation_id
        from private.household_invitations replacement
        where replacement.id =
            '00000000-0000-4000-8000-000000000621'
    ),
    '00000000-0000-4000-8000-000000000620'::uuid,
    'The replacement chain preserves invitation history'
);

select throws_ok(
    $test$
        insert into private.household_invitations (
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            supersedes_invitation_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            'different@example.test',
            private.hash_household_invitation_token(
                'invalid-replacement-token'
            ),
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000620',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    '23514',
    'A replacement must follow a superseded invitation for the same recipient',
    'A replacement cannot attach to another recipient history'
);

select lives_ok(
    $test$
        insert into private.household_invitations (
            id,
            household_id,
            invitee_email,
            token_digest,
            created_by_user_id,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000630',
            '00000000-0000-4000-8000-000000000100',
            'revoke@example.test',
            private.hash_household_invitation_token(
                'revoke-token'
            ),
            '00000000-0000-4000-8000-000000000001',
            pg_catalog.now() + interval '7 days'
        )
    $test$,
    'A revocable pending invitation is retained durably'
);

select throws_ok(
    $test$
        update private.household_invitations
        set token_digest = private.hash_household_invitation_token(
                'mutated-token'
            )
        where id = '00000000-0000-4000-8000-000000000630'
    $test$,
    '55000',
    'Invitation identity and token fields are immutable',
    'A pending bearer token cannot be rotated in place'
);

select throws_ok(
    $test$
        update private.household_invitations
        set invitee_email = 'changed@example.test'
        where id = '00000000-0000-4000-8000-000000000630'
    $test$,
    '55000',
    'Invitation identity and token fields are immutable',
    'A pending recipient cannot be rewritten in place'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000004';

select throws_ok(
    $test$
        update private.household_invitations
        set status = 'revoked',
            resolved_at = pg_catalog.now(),
            resolved_by_user_id =
                '00000000-0000-4000-8000-000000000004'
        where id = '00000000-0000-4000-8000-000000000630'
    $test$,
    '42501',
    'Household owner permission is required',
    'A non-owner cannot revoke a pending invitation'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select lives_ok(
    $test$
        update private.household_invitations
        set status = 'revoked',
            resolved_at = pg_catalog.now(),
            resolved_by_user_id =
                '00000000-0000-4000-8000-000000000001'
        where id = '00000000-0000-4000-8000-000000000630'
    $test$,
    'The household owner can revoke a pending invitation'
);

select is(
    (
        select invitation.status
        from private.household_invitations invitation
        where invitation.id =
            '00000000-0000-4000-8000-000000000630'
    ),
    'revoked',
    'Revocation remains in terminal invitation history'
);

select is(
    (
        select pg_catalog.count(*)
        from private.household_invitations invitation
        where invitation.household_id =
                '00000000-0000-4000-8000-000000000100'
          and invitation.invitee_email_normalized =
                'reissue@example.test'
          and invitation.status = 'pending'
    ),
    1::bigint,
    'Only the newest replacement remains pending for a recipient'
);

select is(
    (
        select pg_catalog.count(*)
        from private.household_invitations invitation
        where invitation.household_id =
                '00000000-0000-4000-8000-000000000100'
          and invitation.status in (
                'accepted',
                'expired',
                'superseded',
                'revoked'
          )
    ),
    4::bigint,
    'Accepted, expired, superseded, and revoked records all remain durable'
);

select * from finish();

rollback;
