begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select ok(
    has_function_privilege(
        'authenticated',
        'public.register_device(uuid,uuid,text)',
        'EXECUTE'
    ),
    'Authenticated users may register a device'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.register_device(uuid,uuid,text)',
        'EXECUTE'
    ),
    'Anonymous users may not register a device'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select device_id
        from public.register_device(
            '00000000-0000-4000-8000-000000000301',
            '00000000-0000-4000-8000-000000000100',
            'Test browser'
        )
    ),
    '00000000-0000-4000-8000-000000000301'::uuid,
    'A household member can register a new device'
);

select is(
    (
        select user_id
        from public.devices
        where id = '00000000-0000-4000-8000-000000000301'
    ),
    '00000000-0000-4000-8000-000000000001'::uuid,
    'The device is assigned to the authenticated user'
);

select is(
    (
        select device_name
        from public.register_device(
            '00000000-0000-4000-8000-000000000301',
            '00000000-0000-4000-8000-000000000100',
            'Renamed browser'
        )
    ),
    'Renamed browser',
    'Repeated registration updates the device name'
);

select is(
    (
        select count(*)
        from public.devices
        where id = '00000000-0000-4000-8000-000000000301'
    ),
    1::bigint,
    'Repeated registration remains idempotent'
);

select throws_ok(
    $test$
        select *
        from public.register_device(
            '00000000-0000-4000-8000-000000000302',
            '00000000-0000-4000-8000-000000000200',
            'Unauthorized browser'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'A user cannot register a device in another household'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000002';

select throws_ok(
    $test$
        select *
        from public.register_device(
            '00000000-0000-4000-8000-000000000301',
            '00000000-0000-4000-8000-000000000200',
            'Claimed browser'
        )
    $test$,
    '42501',
    'Device identifier is already registered to another user or household',
    'Another user cannot claim an existing device UUID'
);

select * from finish();

rollback;
