begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select ok(
    has_table_privilege(
        'authenticated',
        'public.holdings',
        'SELECT'
    ),
    'Authenticated users may select holdings'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.holdings',
        'UPDATE'
    ),
    'Authenticated users cannot directly update holdings'
);

select ok(
    not has_table_privilege(
        'anon',
        'public.holdings',
        'SELECT'
    ),
    'Anonymous users cannot read holdings'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.wines',
        'INSERT'
    ),
    'Authenticated users cannot directly insert catalog wines'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (select count(*) from public.households),
    1::bigint,
    'RLS exposes only the user household'
);

select is(
    (select count(*) from public.wines),
    1::bigint,
    'RLS hides wines from unrelated households'
);

select throws_ok(
    $test$
        select *
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009101',
            '00000000-0000-4000-8000-000000000200',
            '00000000-0000-4000-8000-000000000201',
            'REMOVE',
            '00000000-0000-4000-8000-000000000210',
            '00000000-0000-4000-8000-000000000221',
            null,
            1,
            '2026-08-04T12:10:00Z',
            'DRANK'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'RPC rejects operations against another household'
);

select throws_ok(
    $test$
        select *
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009102',
            '00000000-0000-4000-8000-000000000200',
            '00000000-0000-4000-8000-000000000201',
            '00000000-0000-4000-8000-000000000211',
            'Unauthorized Domaine',
            'Private Cuvée',
            2022,
            '00000000-0000-4000-8000-000000000221',
            1,
            '2026-08-07T12:10:00Z'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'ADD RPC rejects catalog creation for another household'
);

select * from finish();

rollback;
