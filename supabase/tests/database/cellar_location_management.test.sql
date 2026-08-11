begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select ok(
    (
        select is_active
        from public.cellars
        where id = '00000000-0000-4000-8000-000000000120'
    ),
    'Existing cellars remain active after migration'
);

select ok(
    (
        select is_active
        from public.locations
        where id = '00000000-0000-4000-8000-000000000121'
    ),
    'Existing locations remain active after migration'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'public.apply_inventory_operation_without_location_state(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot bypass active-location checks'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select ok(
    public.create_location(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000120',
        '  Managed   shelf  ',
        20
    ) is not null,
    'Owner can create a location with capacity'
);

select is(
    (
        select capacity
        from public.locations
        where cellar_id =
            '00000000-0000-4000-8000-000000000120'
          and code = 'Managed shelf'
    ),
    20,
    'Created location capacity is stored'
);

select ok(
    public.update_location(
        (
            select id
            from public.locations
            where cellar_id =
                '00000000-0000-4000-8000-000000000120'
              and code = 'Managed shelf'
        ),
        '  Managed   position  ',
        24
    ) is not null,
    'Owner can update a location code and capacity together'
);

select results_eq(
    $test$
        select code, capacity
        from public.locations
        where cellar_id =
            '00000000-0000-4000-8000-000000000120'
          and code = 'Managed position'
    $test$,
    $expected$
        values ('Managed position'::text, 24::integer)
    $expected$,
    'Location updates normalize the code and store capacity'
);

select throws_ok(
    $test$
        select public.create_location(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000120',
            'Invalid capacity',
            0
        )
    $test$,
    '22023',
    'Location capacity must be greater than zero',
    'Location creation rejects zero capacity'
);

select lives_ok(
    $test$
        select public.set_location_order(
            '00000000-0000-4000-8000-000000000120',
            array[
                '00000000-0000-4000-8000-000000000122'::uuid,
                (
                    select id
                    from public.locations
                    where cellar_id =
                        '00000000-0000-4000-8000-000000000120'
                      and code = 'Managed position'
                ),
                '00000000-0000-4000-8000-000000000121'::uuid
            ]
        )
    $test$,
    'Owner can set an explicit location order'
);

select results_eq(
    $test$
        select code
        from public.locations
        where cellar_id =
            '00000000-0000-4000-8000-000000000120'
          and is_active
        order by display_order
    $test$,
    $expected$
        values ('B'::text),
               ('Managed position'::text),
               ('A'::text)
    $expected$,
    'Explicit display order is persisted'
);

select throws_ok(
    $test$
        select public.set_location_order(
            '00000000-0000-4000-8000-000000000120',
            array[
                '00000000-0000-4000-8000-000000000121'::uuid
            ]
        )
    $test$,
    '22023',
    'Location order must include every active location exactly once',
    'Ordering rejects an incomplete location list'
);

select throws_ok(
    $test$
        select public.archive_location(
            '00000000-0000-4000-8000-000000000121'
        )
    $test$,
    '22023',
    'Move or remove every bottle before archiving this location',
    'A stocked location cannot be archived'
);

select ok(
    public.archive_location(
        '00000000-0000-4000-8000-000000000122'
    ) is not null,
    'An empty location can be archived'
);

select ok(
    not (
        select is_active
        from public.locations
        where id = '00000000-0000-4000-8000-000000000122'
    ),
    'Archived location is inactive'
);

select is(
    (
        select operation_status
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009401',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            'ADD',
            '00000000-0000-4000-8000-000000000110',
            null,
            '00000000-0000-4000-8000-000000000122',
            1,
            '2026-08-11T21:50:00Z',
            null
        )
    ),
    'REJECTED',
    'Offline operations targeting an archived location are rejected'
);

select is(
    (
        select error_code
        from public.inventory_operations
        where id = '00000000-0000-4000-8000-000000009401'
    ),
    'LOCATION_ARCHIVED',
    'Archived-location rejection is recorded for synchronization'
);

select ok(
    public.restore_location(
        '00000000-0000-4000-8000-000000000122'
    ) is not null,
    'Owner can restore an archived location'
);

select ok(
    (
        select is_active
        from public.locations
        where id = '00000000-0000-4000-8000-000000000122'
    ),
    'Restored location is active'
);

select ok(
    public.create_cellar(
        '00000000-0000-4000-8000-000000000100',
        'Archive test'
    ) is not null,
    'Owner can create a cellar for archive testing'
);

select ok(
    public.create_location(
        '00000000-0000-4000-8000-000000000100',
        (
            select id
            from public.cellars
            where household_id =
                '00000000-0000-4000-8000-000000000100'
              and name = 'Archive test'
        ),
        'Only shelf',
        null
    ) is not null,
    'Archive test cellar can contain an empty location'
);

select throws_ok(
    $test$
        select public.archive_cellar(
            (
                select id
                from public.cellars
                where household_id =
                    '00000000-0000-4000-8000-000000000100'
                  and name = 'Archive test'
            )
        )
    $test$,
    '22023',
    'Archive every active location before archiving this cellar',
    'Cellar archival requires every location to be archived first'
);

select lives_ok(
    $test$
        select public.archive_location(
            (
                select l.id
                from public.locations l
                join public.cellars c on c.id = l.cellar_id
                where c.name = 'Archive test'
                  and l.code = 'Only shelf'
            )
        );
        select public.archive_cellar(
            (
                select id
                from public.cellars
                where household_id =
                    '00000000-0000-4000-8000-000000000100'
                  and name = 'Archive test'
            )
        )
    $test$,
    'An empty cellar can be archived after its locations'
);

select lives_ok(
    $test$
        select public.restore_cellar(
            (
                select id
                from public.cellars
                where household_id =
                    '00000000-0000-4000-8000-000000000100'
                  and name = 'Archive test'
            )
        );
        select public.restore_location(
            (
                select l.id
                from public.locations l
                join public.cellars c on c.id = l.cellar_id
                where c.name = 'Archive test'
                  and l.code = 'Only shelf'
            )
        )
    $test$,
    'Archived cellar and location can be restored safely'
);

select throws_ok(
    $test$
        select public.archive_location(
            '00000000-0000-4000-8000-000000000221'
        )
    $test$,
    '42501',
    'Only household owners can manage cellar setup',
    'Owner cannot archive another household location'
);

select * from finish();

rollback;
