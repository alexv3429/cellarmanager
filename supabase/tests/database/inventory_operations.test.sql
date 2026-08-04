begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';


-- 1: Accepted MOVE.
select is(
    (
        select operation_status
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009001',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            'MOVE',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000121',
            '00000000-0000-4000-8000-000000000122',
            2,
            '2026-08-04T12:00:00Z'
        )
    ),
    'ACCEPTED',
    'MOVE is accepted'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000110'
          and location_id =
            '00000000-0000-4000-8000-000000000121'
    ),
    3,
    'MOVE decreases the source holding'
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
    'MOVE creates or increases the destination holding'
);

select is(
    (
        select count(*)
        from public.inventory_operations
        where id =
            '00000000-0000-4000-8000-000000009001'
    ),
    1::bigint,
    'MOVE is recorded exactly once'
);


-- 2: Accepted CONSUME.
select is(
    (
        select operation_status
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009002',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            'CONSUME',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000122',
            null,
            1,
            '2026-08-04T12:01:00Z'
        )
    ),
    'ACCEPTED',
    'CONSUME is accepted'
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
    1,
    'CONSUME decreases the selected holding'
);

select is(
    (
        select count(*)
        from public.inventory_operations
        where id =
            '00000000-0000-4000-8000-000000009002'
    ),
    1::bigint,
    'CONSUME is recorded exactly once'
);


-- 3: Insufficient stock is a recorded rejection, not a queue-blocking error.
select is(
    (
        select operation_status
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009003',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            'CONSUME',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000121',
            null,
            99,
            '2026-08-04T12:02:00Z'
        )
    ),
    'REJECTED',
    'Insufficient stock is rejected'
);

select is(
    (
        select error_code
        from public.inventory_operations
        where id =
            '00000000-0000-4000-8000-000000009003'
    ),
    'INSUFFICIENT_STOCK',
    'Rejected operation stores its error code'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000110'
          and location_id =
            '00000000-0000-4000-8000-000000000121'
    ),
    3,
    'Rejected operation does not alter stock'
);

select is(
    (
        select count(*)
        from public.inventory_operations
        where id =
            '00000000-0000-4000-8000-000000009003'
    ),
    1::bigint,
    'Rejected operation is recorded exactly once'
);


-- 4: Retrying the original MOVE is idempotent.
select is(
    (
        select operation_status
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009001',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            'MOVE',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000121',
            '00000000-0000-4000-8000-000000000122',
            2,
            '2026-08-04T12:00:00Z'
        )
    ),
    'ACCEPTED',
    'Duplicate delivery returns the existing result'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000110'
          and location_id =
            '00000000-0000-4000-8000-000000000121'
    ),
    3,
    'Duplicate delivery does not reduce source stock twice'
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
    1,
    'Duplicate delivery does not increase destination stock twice'
);

select is(
    (
        select count(*)
        from public.inventory_operations
        where id =
            '00000000-0000-4000-8000-000000009001'
    ),
    1::bigint,
    'Duplicate delivery retains one journal entry'
);


-- 5: Reusing an operation UUID for another payload is rejected.
select throws_ok(
    $test$
        select *
        from public.apply_inventory_operation(
            '00000000-0000-4000-8000-000000009001',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            'MOVE',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000121',
            '00000000-0000-4000-8000-000000000122',
            1,
            '2026-08-04T12:00:00Z'
        )
    $test$,
    '22023',
    'operation_id was reused with a different payload',
    'An operation UUID cannot be reused with another payload'
);

select * from finish();

rollback;
