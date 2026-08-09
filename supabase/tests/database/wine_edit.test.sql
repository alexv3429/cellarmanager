begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(
    has_table_privilege(
        'authenticated',
        'public.wines',
        'SELECT'
    ),
    'Authenticated users may select wines'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.wines',
        'UPDATE'
    ),
    'Authenticated users cannot directly update wines'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.update_wine_identity(uuid,text,text,integer,text)',
        'EXECUTE'
    ),
    'Authenticated users may execute wine editing'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.update_wine_identity(uuid,text,text,integer,text)',
        'EXECUTE'
    ),
    'Anonymous users cannot execute wine editing'
);

-- Explicit collision fixture. The schema intentionally permits
-- pre-existing ambiguous references, but an edit must not create
-- a new ambiguity.
insert into public.wines (
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    format_ml
)
values (
    '00000000-0000-4000-8000-000000000199',
    '00000000-0000-4000-8000-000000000100',
    'Collision Domaine',
    'Collision Cuvée',
    2020,
    'red',
    750
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.update_wine_identity(
        '00000000-0000-4000-8000-000000000110',
        '  Edited   Domaine  ',
        '  Edited   Cuvée  ',
        2024,
        '  RED  '
    ),
    '00000000-0000-4000-8000-000000000110'::uuid,
    'Owner can edit a catalog wine'
);

select is(
    (
        select producer
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Edited Domaine',
    'Producer whitespace is normalized'
);

select is(
    (
        select cuvee
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Edited Cuvée',
    'Cuvée whitespace is normalized'
);

select is(
    (
        select vintage
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    2024,
    'Vintage is updated'
);

select is(
    (
        select color
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'red',
    'Color is normalized to lowercase'
);

select lives_ok(
    $test$
        select public.update_wine_identity(
            '00000000-0000-4000-8000-000000000110',
            ' edited   domaine ',
            ' EDITED   CUVÉE ',
            2024,
            ' Red '
        )
    $test$,
    'Case and whitespace-only identity changes remain valid'
);

select throws_ok(
    $test$
        select public.update_wine_identity(
            '00000000-0000-4000-8000-000000000110',
            '   ',
            'Cuvée',
            2024,
            'red'
        )
    $test$,
    '22023',
    'Wine producer is required',
    'Blank producer is rejected'
);

select throws_ok(
    $test$
        select public.update_wine_identity(
            '00000000-0000-4000-8000-000000000110',
            'Domaine',
            'Cuvée',
            1700,
            'red'
        )
    $test$,
    '22023',
    'Wine vintage must be between 1800 and 2200',
    'Invalid vintage is rejected'
);

select throws_ok(
    $test$
        select public.update_wine_identity(
            '00000000-0000-4000-8000-000000000110',
            'Domaine',
            'Cuvée',
            2024,
            '   '
        )
    $test$,
    '22023',
    'Wine color is required',
    'Blank color is rejected'
);

select throws_ok(
    $test$
        select public.update_wine_identity(
            '00000000-0000-4000-8000-000000000210',
            'Unauthorized Domaine',
            'Private Cuvée',
            2022,
            'red'
        )
    $test$,
    '42501',
    'Only household owners can edit catalog wines',
    'Owner cannot edit another household wine'
);

select throws_ok(
    $test$
        select public.update_wine_identity(
            'ffffffff-ffff-4fff-8fff-ffffffffffff',
            'Missing Domaine',
            'Missing Cuvée',
            2022,
            'red'
        )
    $test$,
    '22023',
    'Wine was not found',
    'Missing wine is rejected'
);

select throws_ok(
    $test$
        select public.update_wine_identity(
            '00000000-0000-4000-8000-000000000110',
            ' collision   domaine ',
            ' COLLISION   CUVÉE ',
            2020,
            'RED'
        )
    $test$,
    '22023',
    'Another catalog wine already has this identity',
    'Editing cannot create a new ambiguous semantic identity'
);

select is(
    (
        select format_ml
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    750,
    'Editing identity preserves physical bottle format'
);

select is(
    (
        select count(*)
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000110'
    ),
    1::bigint,
    'Existing holdings remain attached to the same wine id'
);

select * from finish();

rollback;
