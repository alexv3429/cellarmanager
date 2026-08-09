begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

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
        'public.update_wine_catalog(uuid,text,text,integer,text,text,text)',
        'EXECUTE'
    ),
    'Authenticated users may execute full catalog editing'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.update_wine_catalog(uuid,text,text,integer,text,text,text)',
        'EXECUTE'
    ),
    'Anonymous users cannot execute full catalog editing'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.update_wine_identity(uuid,text,text,integer,text)',
        'EXECUTE'
    ),
    'Authenticated users retain legacy identity editing'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.update_wine_identity(uuid,text,text,integer,text)',
        'EXECUTE'
    ),
    'Anonymous users cannot execute legacy identity editing'
);

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
    public.update_wine_catalog(
        '00000000-0000-4000-8000-000000000110',
        '  Edited   Domaine  ',
        '  Edited   Cuvée  ',
        2024,
        '  RED  ',
        '  Côte   de   Nuits  ',
        '  Burgundy   North  '
    ),
    '00000000-0000-4000-8000-000000000110'::uuid,
    'Owner can edit a full catalog wine'
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

select is(
    (
        select appellation
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Côte de Nuits',
    'Appellation whitespace is normalized'
);

select is(
    (
        select area
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Burgundy North',
    'Area whitespace is normalized'
);

select is(
    public.update_wine_catalog(
        '00000000-0000-4000-8000-000000000110',
        'Edited Domaine',
        'Edited Cuvée',
        2024,
        'red',
        ' ',
        ''
    ),
    '00000000-0000-4000-8000-000000000110'::uuid,
    'Owner can clear optional metadata'
);

select ok(
    (
        select appellation is null
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Blank appellation is stored as null'
);

select ok(
    (
        select area is null
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Blank area is stored as null'
);

select is(
    public.update_wine_catalog(
        '00000000-0000-4000-8000-000000000110',
        'Edited Domaine',
        'Edited Cuvée',
        2024,
        'red',
        'Morgon',
        'Beaujolais'
    ),
    '00000000-0000-4000-8000-000000000110'::uuid,
    'Metadata can be restored before compatibility testing'
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
    'Legacy identity editing remains compatible'
);

select is(
    (
        select appellation
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Morgon',
    'Legacy identity editing preserves appellation'
);

select is(
    (
        select area
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Beaujolais',
    'Legacy identity editing preserves area'
);

select throws_ok(
    $test$
        select public.update_wine_catalog(
            '00000000-0000-4000-8000-000000000110',
            '   ',
            'Cuvée',
            2024,
            'red',
            null,
            null
        )
    $test$,
    '22023',
    'Wine producer is required',
    'Blank producer is rejected'
);

select throws_ok(
    $test$
        select public.update_wine_catalog(
            '00000000-0000-4000-8000-000000000110',
            'Domaine',
            'Cuvée',
            1700,
            'red',
            null,
            null
        )
    $test$,
    '22023',
    'Wine vintage must be between 1800 and 2200',
    'Invalid vintage is rejected'
);

select throws_ok(
    $test$
        select public.update_wine_catalog(
            '00000000-0000-4000-8000-000000000110',
            'Domaine',
            'Cuvée',
            2024,
            '   ',
            null,
            null
        )
    $test$,
    '22023',
    'Wine color is required',
    'Blank color is rejected'
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
            'Private Area'
        )
    $test$,
    '42501',
    'Only household owners can edit catalog wines',
    'Owner cannot edit another household wine'
);

select throws_ok(
    $test$
        select public.update_wine_catalog(
            'ffffffff-ffff-4fff-8fff-ffffffffffff',
            'Missing Domaine',
            'Missing Cuvée',
            2022,
            'red',
            null,
            null
        )
    $test$,
    '22023',
    'Wine was not found',
    'Missing wine is rejected'
);

select throws_ok(
    $test$
        select public.update_wine_catalog(
            '00000000-0000-4000-8000-000000000110',
            ' collision   domaine ',
            ' COLLISION   CUVÉE ',
            2020,
            'RED',
            'Different Appellation',
            'Different Area'
        )
    $test$,
    '22023',
    'Another catalog wine already has this identity',
    'Metadata cannot bypass semantic identity collision protection'
);

select is(
    (
        select format_ml
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    750,
    'Catalog editing preserves physical bottle format'
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
