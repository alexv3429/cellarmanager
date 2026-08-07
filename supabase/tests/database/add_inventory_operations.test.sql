begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select operation_status
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009200',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            'ADD',
            '00000000-0000-4000-8000-000000000110',
            null,
            '00000000-0000-4000-8000-000000000122',
            2,
            '2026-08-07T12:00:00Z',
            null
        )
    ),
    'ACCEPTED',
    'Existing catalog wine ADD remains supported'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000110'
          and location_id =
            '00000000-0000-4000-8000-000000000122'
    ),
    2,
    'Existing catalog ADD increases destination stock'
);

select is(
    (
        select operation_status
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009201',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000111',
            '  New   Domaine  ',
            ' Première   Cuvée ',
            2022,
            '00000000-0000-4000-8000-000000000122',
            3,
            '2026-08-07T12:01:00Z'
        )
    ),
    'ACCEPTED',
    'New-wine ADD is accepted'
);

select is(
    (
        select producer
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000111'
    ),
    'New Domaine',
    'New wine producer whitespace is normalized'
);

select is(
    (
        select cuvee
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000111'
    ),
    'Première Cuvée',
    'New wine cuvée whitespace is normalized'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000111'
          and location_id =
            '00000000-0000-4000-8000-000000000122'
    ),
    3,
    'New-wine ADD creates its destination holding'
);

select is(
    (
        select operation_status
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009202',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000112',
            'new domaine',
            'Première Cuvée',
            2022,
            '00000000-0000-4000-8000-000000000121',
            1,
            '2026-08-07T12:02:00Z'
        )
    ),
    'ACCEPTED',
    'Duplicate semantic wine ADD is accepted'
);

select is(
    (
        select count(*)
        from public.wines
        where household_id =
            '00000000-0000-4000-8000-000000000100'
          and lower(producer) = lower('New Domaine')
          and lower(cuvee) = lower('Première Cuvée')
          and vintage = 2022
    ),
    1::bigint,
    'Duplicate semantic wine resolves to one catalog row'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000111'
          and location_id =
            '00000000-0000-4000-8000-000000000121'
    ),
    1,
    'Duplicate semantic ADD updates the canonical wine holding'
);

select is(
    (
        select count(*)
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000112'
    ),
    0::bigint,
    'Duplicate requested wine UUID is not persisted'
);

select is(
    (
        select operation_status
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009202',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000112',
            'new domaine',
            'Première Cuvée',
            2022,
            '00000000-0000-4000-8000-000000000121',
            1,
            '2026-08-07T12:02:00Z'
        )
    ),
    'ACCEPTED',
    'Retry returns the existing ADD result'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000111'
          and location_id =
            '00000000-0000-4000-8000-000000000121'
    ),
    1,
    'Retry does not add stock twice'
);

select is(
    (
        select wine_id
        from public.inventory_operations
        where id =
            '00000000-0000-4000-8000-000000009202'
    ),
    '00000000-0000-4000-8000-000000000111'::uuid,
    'Journal records the canonical wine UUID'
);

select is(
    (
        select wine_producer
        from public.inventory_operations
        where id =
            '00000000-0000-4000-8000-000000009202'
    ),
    'New Domaine',
    'Journal records the canonical wine identity'
);

select * from finish();

rollback;
