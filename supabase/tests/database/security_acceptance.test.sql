begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

-- Browser clients may read synchronized state, but authoritative writes stay
-- behind RPCs.
select ok(
    (
        select pg_catalog.bool_and(
            has_table_privilege(
                'authenticated',
                'public.' || table_name,
                'SELECT'
            )
        )
        from (
            values
                ('households'),
                ('household_members'),
                ('devices'),
                ('wines'),
                ('cellars'),
                ('locations'),
                ('holdings'),
                ('inventory_operations')
        ) as synced(table_name)
    ),
    'Authenticated users may select every synchronized table'
);

select ok(
    (
        select pg_catalog.bool_and(
            not has_table_privilege(
                'authenticated',
                'public.' || table_name,
                'INSERT'
            )
            and not has_table_privilege(
                'authenticated',
                'public.' || table_name,
                'UPDATE'
            )
            and not has_table_privilege(
                'authenticated',
                'public.' || table_name,
                'DELETE'
            )
        )
        from (
            values
                ('households'),
                ('household_members'),
                ('devices'),
                ('wines'),
                ('cellars'),
                ('locations'),
                ('holdings'),
                ('inventory_operations')
        ) as synced(table_name)
    ),
    'Authenticated users cannot directly mutate synchronized tables'
);

select ok(
    (
        select pg_catalog.bool_and(
            not has_table_privilege(
                'anon',
                'public.' || table_name,
                'SELECT'
            )
        )
        from (
            values
                ('households'),
                ('household_members'),
                ('devices'),
                ('wines'),
                ('cellars'),
                ('locations'),
                ('holdings'),
                ('inventory_operations')
        ) as synced(table_name)
    ),
    'Anonymous users cannot read synchronized tables'
);

-- Seed one journal row per household without changing holdings. The whole
-- acceptance test rolls back.
insert into public.inventory_operations (
    id,
    household_id,
    device_id,
    user_id,
    operation_type,
    wine_id,
    source_location_id,
    destination_location_id,
    quantity,
    remove_reason,
    status,
    error_code,
    error_message,
    created_at_client
)
values
    (
        '00000000-0000-4000-8000-000000009901',
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000101',
        '00000000-0000-4000-8000-000000000001',
        'REMOVE',
        '00000000-0000-4000-8000-000000000110',
        '00000000-0000-4000-8000-000000000121',
        null,
        1,
        'OTHER',
        'REJECTED',
        'SECURITY_TEST',
        'RLS fixture',
        '2026-08-10T12:00:00Z'
    ),
    (
        '00000000-0000-4000-8000-000000009902',
        '00000000-0000-4000-8000-000000000200',
        '00000000-0000-4000-8000-000000000201',
        '00000000-0000-4000-8000-000000000002',
        'REMOVE',
        '00000000-0000-4000-8000-000000000210',
        '00000000-0000-4000-8000-000000000221',
        null,
        1,
        'OTHER',
        'REJECTED',
        'SECURITY_TEST',
        'RLS fixture',
        '2026-08-10T12:00:00Z'
    );

set local role authenticated;

-- Bob sees Bob and cannot see Alice across every synchronized table.
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000002';

select ok(
    exists (
        select 1
        from public.households
        where id = '00000000-0000-4000-8000-000000000200'
    )
    and not exists (
        select 1
        from public.households
        where id = '00000000-0000-4000-8000-000000000100'
    ),
    'Bob sees only his household'
);

select ok(
    exists (
        select 1
        from public.household_members
        where household_id =
            '00000000-0000-4000-8000-000000000200'
          and user_id =
            '00000000-0000-4000-8000-000000000002'
    )
    and not exists (
        select 1
        from public.household_members
        where household_id =
            '00000000-0000-4000-8000-000000000100'
    ),
    'Bob cannot see Alice household membership'
);

select ok(
    exists (
        select 1
        from public.devices
        where id = '00000000-0000-4000-8000-000000000201'
    )
    and not exists (
        select 1
        from public.devices
        where id = '00000000-0000-4000-8000-000000000101'
    ),
    'Bob cannot see Alice device'
);

select ok(
    exists (
        select 1
        from public.wines
        where household_id =
            '00000000-0000-4000-8000-000000000200'
    )
    and not exists (
        select 1
        from public.wines
        where household_id =
            '00000000-0000-4000-8000-000000000100'
    ),
    'Bob cannot see Alice wines'
);

select ok(
    exists (
        select 1
        from public.cellars
        where household_id =
            '00000000-0000-4000-8000-000000000200'
    )
    and not exists (
        select 1
        from public.cellars
        where household_id =
            '00000000-0000-4000-8000-000000000100'
    ),
    'Bob cannot see Alice cellars'
);

select ok(
    exists (
        select 1
        from public.locations
        where household_id =
            '00000000-0000-4000-8000-000000000200'
    )
    and not exists (
        select 1
        from public.locations
        where household_id =
            '00000000-0000-4000-8000-000000000100'
    ),
    'Bob cannot see Alice locations'
);

select ok(
    exists (
        select 1
        from public.holdings
        where household_id =
            '00000000-0000-4000-8000-000000000200'
    )
    and not exists (
        select 1
        from public.holdings
        where household_id =
            '00000000-0000-4000-8000-000000000100'
    ),
    'Bob cannot see Alice holdings'
);

select ok(
    exists (
        select 1
        from public.inventory_operations
        where id = '00000000-0000-4000-8000-000000009902'
    )
    and not exists (
        select 1
        from public.inventory_operations
        where id = '00000000-0000-4000-8000-000000009901'
    ),
    'Bob cannot see Alice inventory journal'
);

-- Alice sees Alice and cannot see Bob across every synchronized table.
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select ok(
    exists (
        select 1
        from public.households
        where id = '00000000-0000-4000-8000-000000000100'
    )
    and not exists (
        select 1
        from public.households
        where id = '00000000-0000-4000-8000-000000000200'
    ),
    'Alice sees only her household'
);

select ok(
    exists (
        select 1
        from public.household_members
        where household_id =
            '00000000-0000-4000-8000-000000000100'
          and user_id =
            '00000000-0000-4000-8000-000000000001'
    )
    and not exists (
        select 1
        from public.household_members
        where household_id =
            '00000000-0000-4000-8000-000000000200'
    ),
    'Alice cannot see Bob household membership'
);

select ok(
    exists (
        select 1
        from public.devices
        where id = '00000000-0000-4000-8000-000000000101'
    )
    and not exists (
        select 1
        from public.devices
        where id = '00000000-0000-4000-8000-000000000201'
    ),
    'Alice cannot see Bob device'
);

select ok(
    exists (
        select 1
        from public.wines
        where household_id =
            '00000000-0000-4000-8000-000000000100'
    )
    and not exists (
        select 1
        from public.wines
        where household_id =
            '00000000-0000-4000-8000-000000000200'
    ),
    'Alice cannot see Bob wines'
);

select ok(
    exists (
        select 1
        from public.cellars
        where household_id =
            '00000000-0000-4000-8000-000000000100'
    )
    and not exists (
        select 1
        from public.cellars
        where household_id =
            '00000000-0000-4000-8000-000000000200'
    ),
    'Alice cannot see Bob cellars'
);

select ok(
    exists (
        select 1
        from public.locations
        where household_id =
            '00000000-0000-4000-8000-000000000100'
    )
    and not exists (
        select 1
        from public.locations
        where household_id =
            '00000000-0000-4000-8000-000000000200'
    ),
    'Alice cannot see Bob locations'
);

select ok(
    exists (
        select 1
        from public.holdings
        where household_id =
            '00000000-0000-4000-8000-000000000100'
    )
    and not exists (
        select 1
        from public.holdings
        where household_id =
            '00000000-0000-4000-8000-000000000200'
    ),
    'Alice cannot see Bob holdings'
);

select ok(
    exists (
        select 1
        from public.inventory_operations
        where id = '00000000-0000-4000-8000-000000009901'
    )
    and not exists (
        select 1
        from public.inventory_operations
        where id = '00000000-0000-4000-8000-000000009902'
    ),
    'Alice cannot see Bob inventory journal'
);

-- Final canonical mutation paths must reject Alice before any Bob-owned
-- object can be changed.

select throws_ok(
    $test$
        select *
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009911',
            '00000000-0000-4000-8000-000000000200',
            '00000000-0000-4000-8000-000000000201',
            '00000000-0000-4000-8000-000000000211',
            'Unauthorized Domaine',
            'Private Cuvée',
            2022,
            'red',
            'Private Appellation',
            'Private Area',
            750,
            '00000000-0000-4000-8000-000000000221',
            1,
            '2026-08-10T12:10:00Z'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'Alice cannot ADD to Bob household'
);

select throws_ok(
    $test$
        select *
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009912',
            '00000000-0000-4000-8000-000000000200',
            '00000000-0000-4000-8000-000000000201',
            'MOVE',
            '00000000-0000-4000-8000-000000000210',
            '00000000-0000-4000-8000-000000000221',
            '00000000-0000-4000-8000-000000000222',
            1,
            '2026-08-10T12:11:00Z',
            null
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'Alice cannot MOVE Bob stock'
);

select throws_ok(
    $test$
        select *
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009913',
            '00000000-0000-4000-8000-000000000200',
            '00000000-0000-4000-8000-000000000201',
            'REMOVE',
            '00000000-0000-4000-8000-000000000210',
            '00000000-0000-4000-8000-000000000221',
            null,
            1,
            '2026-08-10T12:12:00Z',
            'DRANK'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'Alice cannot REMOVE Bob stock'
);

select throws_ok(
    $test$
        select public.update_wine_catalog(
            '00000000-0000-4000-8000-000000000210',
            'Unauthorized Domaine',
            'Private Cuvée',
            2022,
            'red',
            'Private Appellation',
            'Private Area',
            750
        )
    $test$,
    '42501',
    'Only household owners can edit catalog wines',
    'Alice cannot edit Bob wine'
);

select throws_ok(
    $test$
        select public.create_cellar(
            '00000000-0000-4000-8000-000000000200',
            'Unauthorized cellar'
        )
    $test$,
    '42501',
    'Only household owners can manage cellar setup',
    'Alice cannot change Bob cellar setup'
);

select throws_ok(
    $test$
        select public.register_device(
            '00000000-0000-4000-8000-000000000399',
            '00000000-0000-4000-8000-000000000200',
            'Unauthorized browser'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'Alice cannot register a device in Bob household'
);

select throws_ok(
    $test$
        select public.create_first_household(
            'Second household',
            'Second cellar',
            'B1'
        )
    $test$,
    '23505',
    'User already belongs to a household',
    'Alice cannot bypass onboarding membership uniqueness'
);

select * from finish();

rollback;
