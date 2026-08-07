begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(
    has_table_privilege(
        'authenticated',
        'public.cellars',
        'SELECT'
    ),
    'Authenticated users may select cellars'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.cellars',
        'INSERT'
    ),
    'Authenticated users cannot directly insert cellars'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.cellars',
        'UPDATE'
    ),
    'Authenticated users cannot directly update cellars'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.locations',
        'INSERT'
    ),
    'Authenticated users cannot directly insert locations'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.locations',
        'UPDATE'
    ),
    'Authenticated users cannot directly update locations'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select ok(
    public.create_cellar(
        '00000000-0000-4000-8000-000000000100',
        '  Wine   Room  '
    ) is not null,
    'Owner can create a cellar'
);

select is(
    (
        select name
        from public.cellars
        where household_id =
            '00000000-0000-4000-8000-000000000100'
          and lower(name) = lower('Wine Room')
    ),
    'Wine Room',
    'Cellar name whitespace is normalized'
);

select ok(
    public.create_location(
        '00000000-0000-4000-8000-000000000100',
        (
            select id
            from public.cellars
            where household_id =
                '00000000-0000-4000-8000-000000000100'
              and name = 'Wine Room'
        ),
        '  Rack   A  '
    ) is not null,
    'Owner can create a location'
);

select is(
    (
        select l.code
        from public.locations l
        join public.cellars c
          on c.id = l.cellar_id
        where c.household_id =
            '00000000-0000-4000-8000-000000000100'
          and c.name = 'Wine Room'
          and lower(l.code) = lower('Rack A')
    ),
    'Rack A',
    'Location code whitespace is normalized'
);

select ok(
    public.rename_cellar(
        (
            select id
            from public.cellars
            where household_id =
                '00000000-0000-4000-8000-000000000100'
              and name = 'Wine Room'
        ),
        '  Main   Room  '
    ) is not null,
    'Owner can rename a cellar'
);

select is(
    (
        select name
        from public.cellars
        where household_id =
            '00000000-0000-4000-8000-000000000100'
          and lower(name) = lower('Main Room')
    ),
    'Main Room',
    'Renamed cellar is normalized'
);

select ok(
    public.rename_location(
        (
            select l.id
            from public.locations l
            join public.cellars c
              on c.id = l.cellar_id
            where c.household_id =
                '00000000-0000-4000-8000-000000000100'
              and c.name = 'Main Room'
              and l.code = 'Rack A'
        ),
        '  Shelf   1  '
    ) is not null,
    'Owner can rename a location'
);

select is(
    (
        select l.code
        from public.locations l
        join public.cellars c
          on c.id = l.cellar_id
        where c.household_id =
            '00000000-0000-4000-8000-000000000100'
          and c.name = 'Main Room'
          and lower(l.code) = lower('Shelf 1')
    ),
    'Shelf 1',
    'Renamed location is normalized'
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
    'Owner cannot create a cellar for another household'
);

select throws_ok(
    $test$
        select public.rename_cellar(
            '00000000-0000-4000-8000-000000000220',
            'Unauthorized rename'
        )
    $test$,
    '42501',
    'Only household owners can manage cellar setup',
    'Owner cannot rename another household cellar'
);

select throws_ok(
    $test$
        select public.create_location(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000220',
            'Wrong cellar'
        )
    $test$,
    '22023',
    'Cellar does not belong to the household',
    'Location creation rejects a cellar from another household'
);

select throws_ok(
    $test$
        select public.create_cellar(
            '00000000-0000-4000-8000-000000000100',
            'main room'
        )
    $test$,
    '22023',
    'A cellar with this name already exists',
    'Cellar names are unique after normalization'
);

select throws_ok(
    $test$
        select public.create_location(
            '00000000-0000-4000-8000-000000000100',
            (
                select id
                from public.cellars
                where household_id =
                    '00000000-0000-4000-8000-000000000100'
                  and name = 'Main Room'
            ),
            'shelf 1'
        )
    $test$,
    '22023',
    'A location with this code already exists in the cellar',
    'Location codes are unique after normalization'
);

select * from finish();

rollback;
