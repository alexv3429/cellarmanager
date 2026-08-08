begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- Deliberately seed two rows with the same conservative core identity.
-- The new model permits this so imports can preserve ambiguity explicitly.
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
values
(
    '00000000-0000-4000-8000-000000000180',
    '00000000-0000-4000-8000-000000000100',
    'Ambiguous Domaine',
    'Twin Reference',
    2020,
    'red',
    'Appellation A',
    'Area',
    750
),
(
    '00000000-0000-4000-8000-000000000181',
    '00000000-0000-4000-8000-000000000100',
    'Ambiguous Domaine',
    'Twin Reference',
    2020,
    'red',
    'Appellation B',
    'Area',
    750
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select operation_status
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009301',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000130',
            '  New   Identity Domaine ',
            ' Reference ',
            2023,
            'RED',
            '  Morgon ',
            ' Beaujolais ',
            1500,
            '00000000-0000-4000-8000-000000000122',
            2,
            '2026-08-08T12:00:00Z'
        )
    ),
    'ACCEPTED',
    'Expanded new-wine ADD is accepted'
);

select is(
    (
        select producer
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000130'
    ),
    'New Identity Domaine',
    'Producer whitespace is normalized'
);

select is(
    (
        select color
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000130'
    ),
    'red',
    'Color is normalized and stored'
);

select is(
    (
        select format_ml
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000130'
    ),
    1500,
    'Physical bottle format is stored'
);

select is(
    (
        select appellation
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000130'
    ),
    'Morgon',
    'Appellation is preserved as metadata'
);

select is(
    (
        select area
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000130'
    ),
    'Beaujolais',
    'Area is preserved as metadata'
);

select is(
    (
        select wine_format_ml
        from public.inventory_operations
        where id =
            '00000000-0000-4000-8000-000000009301'
    ),
    1500,
    'Journal preserves canonical bottle format metadata'
);

select is(
    (
        select operation_status
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009302',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000131',
            'new identity domaine',
            'Reference',
            2023,
            'red',
            'Different metadata does not redefine identity',
            'Different area',
            1500,
            '00000000-0000-4000-8000-000000000121',
            1,
            '2026-08-08T12:01:00Z'
        )
    ),
    'ACCEPTED',
    'Single semantic match resolves to the canonical wine'
);

select is(
    (
        select count(*)
        from public.wines
        where household_id =
            '00000000-0000-4000-8000-000000000100'
          and lower(producer) =
              lower('New Identity Domaine')
          and lower(cuvee) = lower('Reference')
          and vintage = 2023
          and color = 'red'
          and format_ml = 1500
    ),
    1::bigint,
    'Appellation and area do not create a duplicate identity'
);

select is(
    (
        select count(*)
        from public.wines
        where id =
            '00000000-0000-4000-8000-000000000131'
    ),
    0::bigint,
    'Duplicate requested UUID is not persisted'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000130'
          and location_id =
            '00000000-0000-4000-8000-000000000121'
    ),
    1,
    'Semantic duplicate ADD updates the canonical holding'
);

select is(
    (
        select operation_status
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009303',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000132',
            'New Identity Domaine',
            'Reference',
            2023,
            'white',
            'Morgon',
            'Beaujolais',
            1500,
            '00000000-0000-4000-8000-000000000122',
            1,
            '2026-08-08T12:02:00Z'
        )
    ),
    'ACCEPTED',
    'Different color creates a distinct wine reference'
);

select is(
    (
        select count(*)
        from public.wines
        where household_id =
            '00000000-0000-4000-8000-000000000100'
          and lower(producer) =
              lower('New Identity Domaine')
          and lower(cuvee) = lower('Reference')
          and vintage = 2023
          and format_ml = 1500
    ),
    2::bigint,
    'Red and white references coexist'
);

select is(
    (
        select operation_status
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009304',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000133',
            'New Identity Domaine',
            'Reference',
            2023,
            'red',
            'Morgon',
            'Beaujolais',
            750,
            '00000000-0000-4000-8000-000000000122',
            1,
            '2026-08-08T12:03:00Z'
        )
    ),
    'ACCEPTED',
    'Different bottle format creates a distinct wine reference'
);

select is(
    (
        select count(*)
        from public.wines
        where household_id =
            '00000000-0000-4000-8000-000000000100'
          and lower(producer) =
              lower('New Identity Domaine')
          and lower(cuvee) = lower('Reference')
          and vintage = 2023
    ),
    3::bigint,
    'Color and format distinctions are both preserved'
);

select throws_ok(
    $test$
        select *
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009305',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000134',
            'Ambiguous Domaine',
            'Twin Reference',
            2020,
            'red',
            null,
            null,
            750,
            '00000000-0000-4000-8000-000000000122',
            1,
            '2026-08-08T12:04:00Z'
        )
    $test$,
    '22023',
    'Wine identity is ambiguous; select an existing catalog wine explicitly',
    'Ambiguous semantic identity is rejected instead of silently merged'
);

select throws_ok(
    $test$
        select *
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000009306',
            '00000000-0000-4000-8000-000000000200',
            '00000000-0000-4000-8000-000000000201',
            '00000000-0000-4000-8000-000000000135',
            'Unauthorized Domaine',
            'Private Cuvée',
            2022,
            'red',
            null,
            null,
            750,
            '00000000-0000-4000-8000-000000000221',
            1,
            '2026-08-08T12:05:00Z'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'Expanded ADD RPC preserves household authorization'
);

select * from finish();

rollback;
