begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

select has_table(
    'private',
    'household_membership_events',
    'Membership changes have a private audit trail'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'private.household_membership_events',
        'SELECT'
    ),
    'Browser clients cannot read the private membership audit directly'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_household_members(uuid)',
        'EXECUTE'
    ),
    'Authenticated users may list members through the narrow RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.get_household_members(uuid)',
        'EXECUTE'
    ),
    'Anonymous users cannot list household members'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.update_household_member_role(uuid,uuid,text)',
        'EXECUTE'
    ),
    'Authenticated sessions may reach the server-authorized role RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.update_household_member_role(uuid,uuid,text)',
        'EXECUTE'
    ),
    'Anonymous users cannot change household roles'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.revoke_household_member(uuid,uuid)',
        'EXECUTE'
    ),
    'Authenticated sessions may reach the server-authorized revocation RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.revoke_household_member(uuid,uuid)',
        'EXECUTE'
    ),
    'Anonymous users cannot revoke household memberships'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.household_members',
        'UPDATE'
    ),
    'Browser clients still cannot update memberships directly'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.household_members',
        'DELETE'
    ),
    'Browser clients still cannot delete memberships directly'
);

select has_column(
    'public',
    'devices',
    'revoked_at',
    'Device registrations can be invalidated without erasing history'
);

insert into auth.users (
    id,
    email,
    raw_user_meta_data
)
values
    (
        '00000000-0000-4000-8000-000000000003',
        'member-a@example.test',
        '{"full_name":"Member Alpha"}'::jsonb
    ),
    (
        '00000000-0000-4000-8000-000000000004',
        'member-b@example.test',
        '{}'::jsonb
    );

insert into public.household_members (
    id,
    household_id,
    user_id,
    role
)
values
    (
        '00000000-0000-4000-8000-000000000401',
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000003',
        'member'
    ),
    (
        '00000000-0000-4000-8000-000000000402',
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000004',
        'member'
    );

insert into public.devices (
    id,
    household_id,
    user_id,
    name
)
values (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000003',
    'Member Alpha phone'
);

insert into public.household_wine_observations (
    id,
    household_id,
    wine_id,
    recorded_by,
    visibility,
    observation_type,
    observed_on,
    maturity_assessment,
    note
)
values
    (
        '00000000-0000-4000-8000-000000000501',
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000110',
        '00000000-0000-4000-8000-000000000003',
        'household',
        'maturity',
        date '2026-09-01',
        'ready',
        'Shared tasting evidence'
    ),
    (
        '00000000-0000-4000-8000-000000000502',
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000110',
        '00000000-0000-4000-8000-000000000003',
        'personal',
        'other',
        date '2026-09-01',
        null,
        'Private note'
    );

select throws_ok(
    $test$
        insert into public.wine_serving_overrides (
            household_id,
            wine_id,
            updated_by,
            temperature_min_c,
            temperature_max_c,
            aeration_min_minutes,
            aeration_max_minutes,
            method
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000002',
            15,
            17,
            20,
            40,
            'open-ahead'
        )
    $test$,
    '23503',
    'insert or update on table "wine_serving_overrides" violates foreign key constraint "wine_serving_overrides_member_fk"',
    'Shared serving guidance cannot be attributed outside the household'
);

insert into public.wine_serving_overrides (
    household_id,
    wine_id,
    updated_by,
    temperature_min_c,
    temperature_max_c,
    aeration_min_minutes,
    aeration_max_minutes,
    method,
    note
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000003',
    15,
    17,
    20,
    40,
    'open-ahead',
    'Shared serving guidance'
);

insert into public.wine_pairing_preferences (
    household_id,
    user_id,
    dish_key,
    preferred_colors,
    preferred_style
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000003',
    'lamb-stew',
    array['red']::text[],
    'rich'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select is(
    (
        select pg_catalog.count(*)
        from public.get_household_members(
            '00000000-0000-4000-8000-000000000100'
        )
    ),
    3::bigint,
    'A member can list every current collaborator'
);

select ok(
    exists (
        select 1
        from public.get_household_members(
            '00000000-0000-4000-8000-000000000100'
        ) member
        where member.member_user_id =
                '00000000-0000-4000-8000-000000000003'
          and member.member_email = 'member-a@example.test'
          and member.member_display_name = 'Member Alpha'
          and member.member_role = 'member'
          and member.is_current_user
    ),
    'The collaborator list exposes only a safe identity label and role'
);

select throws_ok(
    $test$
        select *
        from public.update_household_member_role(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000402',
            'owner'
        )
    $test$,
    '42501',
    'Household owner permission is required',
    'A member cannot promote another member'
);

select throws_ok(
    $test$
        select *
        from public.revoke_household_member(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000402'
        )
    $test$,
    '42501',
    'Household owner permission is required',
    'A member cannot revoke another member'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000002';

select throws_ok(
    $test$
        select *
        from public.get_household_members(
            '00000000-0000-4000-8000-000000000100'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'An unrelated account cannot enumerate household identities'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select pg_catalog.count(*)
        from public.get_household_members(
            '00000000-0000-4000-8000-000000000100'
        )
    ),
    3::bigint,
    'The owner sees the same current collaborator list'
);

select throws_ok(
    $test$
        select *
        from public.update_household_member_role(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000402',
            'administrator'
        )
    $test$,
    '22023',
    'Member role must be owner or member',
    'Unknown roles are rejected before any write'
);

select is(
    (
        select changed.member_role
        from public.update_household_member_role(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000402',
            ' OWNER '
        ) changed
    ),
    'owner',
    'An owner can promote another membership using a normalized role'
);

select is(
    (
        select member.role
        from public.household_members member
        where member.id =
            '00000000-0000-4000-8000-000000000402'
    ),
    'owner',
    'The promoted role is authoritative in household_members'
);

reset role;

select is(
    (
        select pg_catalog.count(*)
        from private.household_membership_events event
        where event.membership_id =
                '00000000-0000-4000-8000-000000000402'
          and event.event_type = 'role_changed'
          and event.previous_role = 'member'
          and event.new_role = 'owner'
          and event.actor_user_id =
                '00000000-0000-4000-8000-000000000001'
    ),
    1::bigint,
    'A real role change records actor, target, and before/after roles'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select changed.previous_role || ':' || changed.member_role
        from public.update_household_member_role(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000402',
            'owner'
        ) changed
    ),
    'owner:owner',
    'Repeating the same role is idempotent'
);

reset role;

select is(
    (
        select pg_catalog.count(*)
        from private.household_membership_events event
        where event.membership_id =
                '00000000-0000-4000-8000-000000000402'
          and event.event_type = 'role_changed'
    ),
    1::bigint,
    'An idempotent role request does not create a false audit event'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select changed.member_role
        from public.update_household_member_role(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000402',
            'member'
        ) changed
    ),
    'member',
    'An owner can demote another owner while one owner remains'
);

reset role;

select is(
    (
        select pg_catalog.count(*)
        from private.household_membership_events event
        where event.membership_id =
                '00000000-0000-4000-8000-000000000402'
          and event.event_type = 'role_changed'
    ),
    2::bigint,
    'The demotion is audited separately from the promotion'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select throws_ok(
    $test$
        select *
        from public.update_household_member_role(
            '00000000-0000-4000-8000-000000000100',
            (
                select member.id
                from public.household_members member
                where member.household_id =
                        '00000000-0000-4000-8000-000000000100'
                  and member.user_id =
                        '00000000-0000-4000-8000-000000000001'
            ),
            'member'
        )
    $test$,
    '42501',
    'Use the ownership transfer workflow to change your own owner role',
    'The generic role RPC cannot bypass the later ownership-transfer workflow'
);

select throws_ok(
    $test$
        select *
        from public.update_household_member_role(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000009999',
            'member'
        )
    $test$,
    '22023',
    'Household membership was not found',
    'A missing or cross-household membership ID reveals no account details'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select lives_ok(
    $test$
        select *
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009701',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000301',
            'MOVE',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000121',
            '00000000-0000-4000-8000-000000000122',
            1,
            '2026-09-01T08:00:00Z',
            null
        )
    $test$,
    'An active member device can still create ordinary inventory history'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select revoked.former_role
        from public.revoke_household_member(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000401'
        ) revoked
    ),
    'member',
    'An owner can revoke another current membership'
);

reset role;

select is(
    (
        select pg_catalog.count(*)
        from public.household_members member
        where member.id =
            '00000000-0000-4000-8000-000000000401'
    ),
    0::bigint,
    'Revocation removes the authorization row immediately'
);

select ok(
    exists (
        select 1
        from public.devices device
        where device.id =
                '00000000-0000-4000-8000-000000000301'
          and device.revoked_at is not null
    ),
    'Revocation invalidates but retains the device registration'
);

select is(
    (
        select pg_catalog.count(*)
        from public.inventory_operations operation
        where operation.id =
            '00000000-0000-4000-8000-000000009701'
    ),
    1::bigint,
    'Immutable inventory history survives membership revocation'
);

select is(
    (
        select pg_catalog.count(*)
        from public.household_wine_observations observation
        where observation.id =
            '00000000-0000-4000-8000-000000000501'
    ),
    1::bigint,
    'Household-visible contributed knowledge survives revocation'
);

select is(
    (
        select pg_catalog.count(*)
        from public.household_wine_observations observation
        where observation.id =
            '00000000-0000-4000-8000-000000000502'
    ),
    0::bigint,
    'The revoked account private household note is removed'
);

select is(
    (
        select pg_catalog.count(*)
        from public.wine_serving_overrides override_row
        where override_row.household_id =
                '00000000-0000-4000-8000-000000000100'
          and override_row.wine_id =
                '00000000-0000-4000-8000-000000000110'
    ),
    1::bigint,
    'Household-wide serving guidance survives its author revocation'
);

select is(
    (
        select pg_catalog.count(*)
        from public.wine_pairing_preferences preference
        where preference.household_id =
                '00000000-0000-4000-8000-000000000100'
          and preference.user_id =
                '00000000-0000-4000-8000-000000000003'
    ),
    0::bigint,
    'Private per-household pairing preferences are deleted on revocation'
);

reset role;

select is(
    (
        select pg_catalog.count(*)
        from private.household_membership_events event
        where event.membership_id =
                '00000000-0000-4000-8000-000000000401'
          and event.event_type = 'revoked'
          and event.previous_role = 'member'
          and event.new_role is null
    ),
    1::bigint,
    'Revocation creates a durable audit event'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select throws_ok(
    $test$
        select *
        from public.get_household_members(
            '00000000-0000-4000-8000-000000000100'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'The revoked account loses household access immediately'
);

reset role;

insert into public.household_members (
    id,
    household_id,
    user_id,
    role
)
values (
    '00000000-0000-4000-8000-000000000403',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000003',
    'member'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select throws_ok(
    $test$
        select *
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009702',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000301',
            'MOVE',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000122',
            '00000000-0000-4000-8000-000000000121',
            1,
            '2026-09-01T09:00:00Z',
            null
        )
    $test$,
    '42501',
    'Device registration is no longer active',
    'Rejoining cannot replay work through the old revoked device'
);

select throws_ok(
    $test$
        select *
        from public.register_device(
            '00000000-0000-4000-8000-000000000301',
            '00000000-0000-4000-8000-000000000100',
            'Old phone'
        )
    $test$,
    '55000',
    'Device registration was revoked; register a new device identifier',
    'A revoked device UUID cannot be silently reactivated'
);

select lives_ok(
    $test$
        select *
        from public.register_device(
            '00000000-0000-4000-8000-000000000302',
            '00000000-0000-4000-8000-000000000100',
            'Fresh phone registration'
        )
    $test$,
    'A rejoined member can register a fresh device identity'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select throws_ok(
    $test$
        select *
        from public.revoke_household_member(
            '00000000-0000-4000-8000-000000000100',
            (
                select member.id
                from public.household_members member
                where member.household_id =
                        '00000000-0000-4000-8000-000000000100'
                  and member.user_id =
                        '00000000-0000-4000-8000-000000000001'
            )
        )
    $test$,
    '42501',
    'Use the leaving or ownership transfer workflow to remove your own membership',
    'The generic revocation RPC cannot remove the acting owner'
);

select throws_ok(
    $test$
        select *
        from public.revoke_household_member(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000009999'
        )
    $test$,
    '22023',
    'Household membership was not found',
    'Revoking an unknown membership is a safe explicit failure'
);

select is(
    (
        select pg_catalog.count(*)
        from public.household_members member
        where member.household_id =
                '00000000-0000-4000-8000-000000000100'
          and member.role = 'owner'
    ),
    1::bigint,
    'Every tested management path leaves the household with an owner'
);

select * from finish();

rollback;
