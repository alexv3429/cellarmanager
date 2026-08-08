begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.households',
        'INSERT'
    ),
    'Authenticated users cannot directly insert households'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.household_members',
        'INSERT'
    ),
    'Authenticated users cannot directly insert memberships'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.create_first_household(text,text,text)',
        'EXECUTE'
    ),
    'Authenticated users may execute first-household onboarding'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.create_first_household(text,text,text)',
        'EXECUTE'
    ),
    'Anonymous users cannot execute first-household onboarding'
);

-- Make seeded user 2 an unprovisioned authenticated user for this
-- transaction. Rollback restores the seed after the test.
delete from public.inventory_operations
where user_id = '00000000-0000-4000-8000-000000000002';

delete from public.household_members
where user_id = '00000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000002';

select lives_ok(
    $test$
        select public.create_first_household(
            '  Test   household  ',
            '  Main   cellar  ',
            '  A1  '
        )
    $test$,
    'Unprovisioned authenticated user can create a first household'
);

select is(
    (
        select count(*)
        from public.households
        where name = 'Test household'
    ),
    1::bigint,
    'Onboarding creates and normalizes the household'
);

select is(
    (
        select count(*)
        from public.household_members hm
        join public.households h
          on h.id = hm.household_id
        where hm.user_id =
                '00000000-0000-4000-8000-000000000002'
          and hm.role = 'owner'
          and h.name = 'Test household'
    ),
    1::bigint,
    'Onboarding creates the owner membership'
);

select is(
    (
        select count(*)
        from public.cellars c
        join public.households h
          on h.id = c.household_id
        where h.name = 'Test household'
          and c.name = 'Main cellar'
    ),
    1::bigint,
    'Onboarding creates and normalizes the first cellar'
);

select is(
    (
        select count(*)
        from public.locations l
        join public.cellars c
          on c.id = l.cellar_id
         and c.household_id = l.household_id
        join public.households h
          on h.id = l.household_id
        where h.name = 'Test household'
          and c.name = 'Main cellar'
          and l.code = 'A1'
    ),
    1::bigint,
    'Onboarding creates the first location'
);

select throws_ok(
    $test$
        select public.create_first_household(
            'Second household',
            'Second cellar',
            'B1'
        )
    $test$,
    '23505',
    'User already belongs to a household',
    'First-household onboarding cannot create duplicates'
);

select * from finish();

rollback;
