begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select ok(
    has_function_privilege(
        'authenticated',
        'public.update_wine_catalog(uuid,text,text,integer,text,text,text,integer)',
        'EXECUTE'
    ),
    'Authenticated users may execute format-aware catalog editing'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.update_wine_catalog(uuid,text,text,integer,text,text,text,integer)',
        'EXECUTE'
    ),
    'Anonymous users cannot execute format-aware catalog editing'
);

-- Same semantic reference as the target used below, except for format.
-- Editing the target from 1500 ml to 750 ml must therefore be rejected.
insert into public.wines (
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    format_ml
)
values (
    '00000000-0000-4000-8000-000000000198',
    '00000000-0000-4000-8000-000000000100',
    'Format Domaine',
    'Format Cuvée',
    2024,
    'red',
    'Collision Appellation',
    'Collision Area',
    750
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.update_wine_catalog(
        '00000000-0000-4000-8000-000000000110',
        '  Format   Domaine  ',
        '  Format   Cuvée  ',
        2024,
        ' RED ',
        ' Format Appellation ',
        ' Format Area ',
        1500
    ),
    '00000000-0000-4000-8000-000000000110'::uuid,
    'Owner can edit physical bottle format'
);

select is(
    (
        select format_ml
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    1500,
    'Physical bottle format is updated'
);

select is(
    (
        select appellation
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Format Appellation',
    'Format-aware editing preserves normalized appellation'
);

select is(
    (
        select area
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Format Area',
    'Format-aware editing preserves normalized area'
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

select lives_ok(
    $test$
        select public.update_wine_catalog(
            '00000000-0000-4000-8000-000000000110',
            'Format Domaine',
            'Format Cuvée',
            2024,
            'red',
            'Legacy Appellation',
            'Legacy Area'
        )
    $test$,
    'Seven-argument catalog editing remains compatible'
);

select is(
    (
        select format_ml
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    1500,
    'Seven-argument compatibility wrapper preserves format'
);

select throws_ok(
    $test$
        select public.update_wine_catalog(
            '00000000-0000-4000-8000-000000000110',
            'Format Domaine',
            'Format Cuvée',
            2024,
            'red',
            'Appellation',
            'Area',
            0
        )
    $test$,
    '22023',
    'Wine format must be a positive number of millilitres',
    'Non-positive format is rejected'
);

select throws_ok(
    $test$
        select public.update_wine_catalog(
            '00000000-0000-4000-8000-000000000110',
            'Format Domaine',
            'Format Cuvée',
            2024,
            'red',
            'Different Appellation',
            'Different Area',
            750
        )
    $test$,
    '22023',
    'Another catalog wine already has this identity',
    'Changing format cannot create a semantic identity collision'
);

select is(
    (
        select format_ml
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000110'
    ),
    1500,
    'Rejected collision leaves the original format unchanged'
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
            1500
        )
    $test$,
    '42501',
    'Only household owners can edit catalog wines',
    'Owner cannot change format in another household'
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
            null,
            750
        )
    $test$,
    '22023',
    'Wine was not found',
    'Missing wine is rejected'
);

select is(
    (
        select count(*)
        from public.wines
        where household_id =
            '00000000-0000-4000-8000-000000000100'
          and lower(producer) =
            lower('Format Domaine')
          and lower(cuvee) =
            lower('Format Cuvée')
          and vintage = 2024
          and color = 'red'
    ),
    2::bigint,
    'Different physical formats remain explicit catalog references'
);

select * from finish();

rollback;
