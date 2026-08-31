begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_household_permissions(uuid)',
        'EXECUTE'
    ),
    'Authenticated users may resolve their household permissions'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.get_household_permissions(uuid)',
        'EXECUTE'
    ),
    'Anonymous users cannot resolve household permissions'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'private.current_household_role(uuid)',
        'EXECUTE'
    ),
    'Browser clients cannot bypass the public permission facade'
);

select ok(
    (
        select bool_and(
            not has_function_privilege(
                'authenticated',
                implementation.signature,
                'EXECUTE'
            )
        )
        from (
            values
                ('private.commit_csv_import_unchecked(uuid,uuid,uuid,jsonb,timestamptz)'),
                ('private.set_wine_maturity_override_unchecked(uuid,integer,integer,integer,integer,text,text)'),
                ('private.clear_wine_maturity_override_unchecked(uuid)'),
                ('private.set_wine_serving_override_unchecked(uuid,numeric,numeric,integer,integer,text,text)'),
                ('private.clear_wine_serving_override_unchecked(uuid)')
        ) implementation(signature)
    ),
    'Browser clients cannot execute owner-gated implementations directly'
);

insert into auth.users (
    id,
    email,
    raw_user_meta_data
)
values (
    '00000000-0000-4000-8000-000000000003',
    'member-a@example.test',
    '{}'::jsonb
);

insert into public.household_members (
    household_id,
    user_id,
    role
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000003',
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
    'Member phone'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select is(
    (
        select permissions.household_role
        from public.get_household_permissions(
            '00000000-0000-4000-8000-000000000100'
        ) permissions
    ),
    'member',
    'A member resolves the member role'
);

select ok(
    (
        select
            permissions.can_manage_inventory
            and permissions.can_manage_own_devices
            and not permissions.can_import_inventory
            and not permissions.can_manage_catalog
            and not permissions.can_manage_cellar_setup
            and not permissions.can_manage_household_guidance
            and not permissions.can_manage_shared_knowledge
            and not permissions.can_manage_members
            and not permissions.can_manage_household_devices
        from public.get_household_permissions(
            '00000000-0000-4000-8000-000000000100'
        ) permissions
    ),
    'Member capabilities match the final collaboration contract'
);

select ok(
    exists (
        select 1
        from public.households household
        where household.id =
            '00000000-0000-4000-8000-000000000100'
    )
    and exists (
        select 1
        from public.wines wine
        where wine.id =
            '00000000-0000-4000-8000-000000000110'
    )
    and not exists (
        select 1
        from public.wines wine
        where wine.id =
            '00000000-0000-4000-8000-000000000210'
    ),
    'A member reads the shared cellar but not another household'
);

select is(
    (
        select count(*)
        from public.household_members member
        where member.household_id =
            '00000000-0000-4000-8000-000000000100'
    ),
    2::bigint,
    'A member can see fellow members of the same household'
);

select lives_ok(
    $test$
        select public.register_device(
            '00000000-0000-4000-8000-000000000302',
            '00000000-0000-4000-8000-000000000100',
            'Member browser'
        )
    $test$,
    'A member can register their own device'
);

select lives_ok(
    $test$
        select *
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009701',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000301',
            '00000000-0000-4000-8000-000000000310',
            'Member Domaine',
            'Daily Add',
            2024,
            'red',
            'Test Appellation',
            'Test Area',
            750,
            '00000000-0000-4000-8000-000000000121',
            1,
            '2026-08-31T12:00:00Z'
        )
    $test$,
    'A member can add a bottle and create its catalog row through daily inventory'
);

select is(
    (
        select count(*)
        from public.wines wine
        where wine.id =
            '00000000-0000-4000-8000-000000000310'
          and wine.household_id =
            '00000000-0000-4000-8000-000000000100'
    ),
    1::bigint,
    'The member ADD created exactly one household wine'
);

select lives_ok(
    $test$
        select public.set_member_maturity_calibration(-1)
    $test$,
    'A member can save an account-private maturity preference'
);

select throws_ok(
    $test$
        select public.update_wine_catalog(
            '00000000-0000-4000-8000-000000000110',
            'Member edit',
            'Cuvée',
            2020,
            'red',
            'Appellation',
            'Area',
            750
        )
    $test$,
    '42501',
    'Only household owners can edit catalog wines',
    'A member cannot edit shared catalog metadata'
);

select throws_ok(
    $test$
        select public.create_cellar(
            '00000000-0000-4000-8000-000000000100',
            'Member cellar'
        )
    $test$,
    '42501',
    'Only household owners can manage cellar setup',
    'A member cannot change cellar structure'
);

select throws_ok(
    $test$
        select *
        from public.commit_csv_import(
            '00000000-0000-4000-8000-000000009702',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000301',
            '[]'::jsonb,
            '2026-08-31T12:00:00Z'
        )
    $test$,
    '42501',
    'Household owner permission is required',
    'A member cannot run a bulk cellar import'
);

select throws_ok(
    $test$
        select public.set_wine_maturity_override(
            '00000000-0000-4000-8000-000000000110',
            2025,
            2027,
            2031,
            2034,
            'aging',
            'Member override'
        )
    $test$,
    '42501',
    'Household owner permission is required',
    'A member cannot replace shared maturity guidance'
);

select throws_ok(
    $test$
        select public.set_wine_serving_override(
            '00000000-0000-4000-8000-000000000110',
            15,
            17,
            15,
            30,
            'open-ahead',
            'Member override'
        )
    $test$,
    '42501',
    'Household owner permission is required',
    'A member cannot replace shared serving guidance'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select permissions.household_role
        from public.get_household_permissions(
            '00000000-0000-4000-8000-000000000100'
        ) permissions
    ),
    'owner',
    'An owner resolves the owner role'
);

select ok(
    (
        select
            permissions.can_manage_inventory
            and permissions.can_import_inventory
            and permissions.can_manage_catalog
            and permissions.can_manage_cellar_setup
            and permissions.can_manage_household_guidance
            and permissions.can_manage_shared_knowledge
            and permissions.can_manage_members
            and permissions.can_manage_own_devices
            and permissions.can_manage_household_devices
        from public.get_household_permissions(
            '00000000-0000-4000-8000-000000000100'
        ) permissions
    ),
    'Owner capabilities include every household management action'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000002';

select throws_ok(
    $test$
        select *
        from public.get_household_permissions(
            '00000000-0000-4000-8000-000000000100'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'An unrelated account cannot inspect household permissions'
);

select * from finish();

rollback;
