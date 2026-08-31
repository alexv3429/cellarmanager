begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

select has_table(
    'private',
    'member_maturity_calibrations',
    'Private member maturity calibration has dedicated storage'
);

select ok(
    to_regprocedure('public.get_member_maturity_calibration()') is not null
    and to_regprocedure('public.set_member_maturity_calibration(integer)') is not null
    and to_regprocedure('public.clear_member_maturity_calibration()') is not null,
    'Calibration has narrow authenticated read, save, and reset APIs'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_member_maturity_calibration()',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.set_member_maturity_calibration(integer)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.clear_member_maturity_calibration()',
        'EXECUTE'
    ),
    'Authenticated members can manage only their own calibration through RPCs'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'private.member_maturity_calibrations',
        'SELECT, INSERT, UPDATE, DELETE'
    ),
    'Browser roles cannot inspect or mutate private calibration rows directly'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_publication_tables
        where pubname = 'powersync'
          and schemaname = 'private'
          and tablename = 'member_maturity_calibrations'
    ),
    0::bigint,
    'Private calibration does not enter the household PowerSync dataset'
);

update public.wines
set
    appellation = 'Pic Saint Loup',
    area = 'Languedoc',
    vintage = 2018
where id = '00000000-0000-4000-8000-000000000110';

select is(
    public.install_initial_maturity_knowledge() ->> 'status',
    'active',
    'Reviewed canonical knowledge is available for the calibration test'
);

select is(
    (public.process_maturity_enrichment_jobs('calibration-test', 10) ->> 'completed')::integer,
    1,
    'Canonical maturity guidance is calculated before personal taste is applied'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.get_member_maturity_calibration(),
    null::jsonb,
    'A member starts with canonical timing'
);

select throws_ok(
    $test$
        select public.set_member_maturity_calibration(4)
    $test$,
    '22023',
    'Personal maturity timing must be between 3 years younger and 3 years later',
    'A personal shift cannot exceed the bounded range'
);

select is(
    public.set_member_maturity_calibration(3) ->> 'year_shift',
    '3',
    'A member can prefer later drinking by three years'
);

select is(
    public.get_member_maturity_calibration() ->> 'year_shift',
    '3',
    'The private preference is durable for that account'
);

select is(
    public.get_wine_maturity(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{projection,maturity,first_trial_year}',
    '2022',
    'Wine detail preserves the canonical first-assessment year'
);

select is(
    public.get_wine_maturity(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{calibration,maturity,first_trial_year}',
    '2025',
    'Wine detail returns the uniformly shifted personal year separately'
);

select is(
    public.get_wine_maturity(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{calibration,active}',
    'true',
    'The personal calibration is active when no per-wine override exists'
);

select is(
    public.get_wine_maturity(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{calibration,maturity,state}',
    case
        when extract(year from current_date)::integer < 2025 then 'hold'
        when extract(year from current_date)::integer < 2028 then 'assess'
        when extract(year from current_date)::integer <= 2034 then 'ready'
        when extract(year from current_date)::integer <= 2040 then 'priority'
        else 'assess-now'
    end,
    'Personal state is recomputed from the shifted window'
);

select ok(
    (
        select
            (item ->> 'is_personalized')::boolean
            and not (item ->> 'is_override')::boolean
        from jsonb_array_elements(
            public.get_household_maturity_overview(
                '00000000-0000-4000-8000-000000000100'
            )
        ) item
        where item ->> 'wine_id' =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Catalog guidance identifies personal calibration without calling it an override'
);

select is(
    (
        select (item ->> 'drink_by_year')::integer
        from jsonb_array_elements(
            public.get_household_maturity_overview(
                '00000000-0000-4000-8000-000000000100'
            )
        ) item
        where item ->> 'wine_id' =
            '00000000-0000-4000-8000-000000000110'
    ),
    2040,
    'Catalog guidance uses the signed-in member personal window'
);

select is(
    (
        select (recommendation ->> 'drink_by_year')::integer
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    ),
    2037,
    'Personal calibration never mutates the canonical projection'
);

select is(
    public.set_wine_maturity_override(
        '00000000-0000-4000-8000-000000000110',
        2028,
        2030,
        2034,
        2042,
        null,
        'Exact bottle advice'
    ) #>> '{override,drink_by_year}',
    '2042',
    'A per-wine manual window can still be saved'
);

select ok(
    (
        select
            (item ->> 'is_override')::boolean
            and not (item ->> 'is_personalized')::boolean
            and (item ->> 'drink_by_year')::integer = 2042
        from jsonb_array_elements(
            public.get_household_maturity_overview(
                '00000000-0000-4000-8000-000000000100'
            )
        ) item
        where item ->> 'wine_id' =
            '00000000-0000-4000-8000-000000000110'
    ),
    'A per-wine manual window has higher priority than member calibration'
);

select is(
    public.get_wine_maturity(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{calibration,active}',
    'false',
    'Wine detail explains that calibration is inactive under a manual window'
);

reset role;

insert into auth.users (id, email, raw_user_meta_data)
values (
    '00000000-0000-4000-8000-000000000003',
    'member-a@example.test',
    '{}'::jsonb
);

insert into public.household_members (household_id, user_id, role)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000003',
    'member'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select is(
    public.get_member_maturity_calibration(),
    null::jsonb,
    'Another member cannot see the first member preference'
);

select is(
    public.get_wine_maturity(
        '00000000-0000-4000-8000-000000000110'
    ) ->> 'calibration',
    null::text,
    'Another household member receives no leaked calibration in wine detail'
);

select is(
    public.set_member_maturity_calibration(-2) ->> 'year_shift',
    '-2',
    'The second member can choose an independent younger preference'
);

select is(
    (
        select (item ->> 'personal_year_shift')::integer
        from jsonb_array_elements(
            public.get_household_maturity_overview(
                '00000000-0000-4000-8000-000000000100'
            )
        ) item
        where item ->> 'wine_id' =
            '00000000-0000-4000-8000-000000000110'
    ),
    -2,
    'The same household receives member-specific calibrated catalog guidance'
);

select is(
    (
        select (item ->> 'drink_by_year')::integer
        from jsonb_array_elements(
            public.get_household_maturity_overview(
                '00000000-0000-4000-8000-000000000100'
            )
        ) item
        where item ->> 'wine_id' =
            '00000000-0000-4000-8000-000000000110'
    ),
    2042,
    'The household-level manual wine override still wins for every member'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.get_member_maturity_calibration() ->> 'year_shift',
    '3',
    'The first member preference remains unchanged by another account'
);

select is(
    public.clear_member_maturity_calibration(),
    null::jsonb,
    'A member can explicitly reset to canonical timing'
);

select is(
    public.get_member_maturity_calibration(),
    null::jsonb,
    'Reset removes the private preference'
);

select is(
    public.clear_wine_maturity_override(
        '00000000-0000-4000-8000-000000000110'
    ) ->> 'override',
    null::text,
    'The test can clear the independent per-wine override'
);

select ok(
    (
        select
            not (item ->> 'is_personalized')::boolean
            and (item ->> 'personal_year_shift')::integer = 0
            and (item ->> 'drink_by_year')::integer = 2037
        from jsonb_array_elements(
            public.get_household_maturity_overview(
                '00000000-0000-4000-8000-000000000100'
            )
        ) item
        where item ->> 'wine_id' =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Reset restores canonical catalog guidance for that member'
);

select * from finish();

rollback;
