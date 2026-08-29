begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

select has_table(
    'public',
    'wine_merge_events',
    'Wine merges have an immutable audit table'
);

select has_column(
    'public',
    'wines',
    'merged_into_wine_id',
    'Retired catalog rows retain their active target'
);

select has_column(
    'public',
    'wine_merge_events',
    'resolved_values',
    'Merge audit records the owner-selected final catalogue values'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.merge_wines(uuid,uuid)',
        'EXECUTE'
    ),
    'Authenticated owners may call the guarded merge RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.merge_wines(uuid,uuid)',
        'EXECUTE'
    ),
    'Anonymous users cannot call the merge RPC'
);

insert into public.locations (
    id,
    household_id,
    cellar_id,
    code
)
values (
    '00000000-0000-4000-8000-000000000123',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000120',
    'C'
);

insert into public.wines (
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    country,
    grape_composition,
    format_ml
)
values
(
    '00000000-0000-4000-8000-000000000180',
    '00000000-0000-4000-8000-000000000100',
    ' Merge   Domaine ',
    'Twin Cuvée',
    2020,
    'red',
    'Morgon',
    'Beaujolais',
    'France',
    '[{"name":"Gamay","percentage":100}]'::jsonb,
    750
),
(
    '00000000-0000-4000-8000-000000000181',
    '00000000-0000-4000-8000-000000000100',
    'merge domaine',
    ' TWIN   CUVÉE ',
    2020,
    'RED',
    null::text,
    null,
    null,
    '[]'::jsonb,
    750
),
(
    '00000000-0000-4000-8000-000000000182',
    '00000000-0000-4000-8000-000000000100',
    'Different Domaine',
    'Different Wine',
    2021,
    'white',
    null,
    null,
    null,
    '[]'::jsonb,
    750
);

insert into public.holdings (
    id,
    household_id,
    wine_id,
    location_id,
    quantity
)
values
(
    '00000000-0000-4000-8000-000000000183',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000180',
    '00000000-0000-4000-8000-000000000121',
    3
),
(
    '00000000-0000-4000-8000-000000000184',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000180',
    '00000000-0000-4000-8000-000000000122',
    4
),
(
    '00000000-0000-4000-8000-000000000185',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000181',
    '00000000-0000-4000-8000-000000000121',
    2
);

insert into public.household_wine_observations (
    id,
    household_id,
    wine_id,
    recorded_by,
    observation_type,
    observed_on,
    maturity_assessment,
    note
)
values (
    '00000000-0000-4000-8000-000000000186',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000180',
    '00000000-0000-4000-8000-000000000001',
    'tasting',
    '2026-08-20',
    'ready',
    'Keep this private observation'
);

insert into public.wine_serving_overrides (
    household_id,
    wine_id,
    updated_by,
    temperature_min_c,
    temperature_max_c,
    aeration_min_minutes,
    aeration_max_minutes,
    method
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000180',
    '00000000-0000-4000-8000-000000000001',
    15,
    17,
    15,
    30,
    'open-ahead'
);

insert into public.wine_maturity_overrides (
    household_id,
    wine_id,
    first_trial_year,
    best_start_year,
    best_end_year,
    drink_by_year,
    created_by
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000180',
    2026,
    2027,
    2030,
    2032,
    '00000000-0000-4000-8000-000000000001'
);

insert into public.inventory_operations (
    id,
    household_id,
    device_id,
    user_id,
    operation_type,
    wine_id,
    destination_location_id,
    quantity,
    status,
    created_at_client
)
values (
    '00000000-0000-4000-8000-000000000187',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'ADD',
    '00000000-0000-4000-8000-000000000180',
    '00000000-0000-4000-8000-000000000121',
    1,
    'ACCEPTED',
    '2026-08-20T10:00:00Z'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.merge_wines(
        '00000000-0000-4000-8000-000000000180',
        '00000000-0000-4000-8000-000000000181'
    ) #>> '{detection_basis}',
    'catalog-identity',
    'Owner explicitly merges a conservative normalized identity match'
);

select is(
    (
        select merged_into_wine_id
        from public.wines
        where id = '00000000-0000-4000-8000-000000000180'
    ),
    '00000000-0000-4000-8000-000000000181'::uuid,
    'The source row is retired into the selected target'
);

select is(
    (
        select count(*)
        from public.wines
        where id = '00000000-0000-4000-8000-000000000180'
    ),
    1::bigint,
    'The retired UUID remains available for immutable history'
);

select is(
    (
        select appellation
        from public.wines
        where id = '00000000-0000-4000-8000-000000000181'
    ),
    'Morgon',
    'A missing target fact is filled from the retired entry'
);

select is(
    (
        select grape_composition
        from public.wines
        where id = '00000000-0000-4000-8000-000000000181'
    ),
    '[{"name":"Gamay","percentage":100}]'::jsonb,
    'A missing structured fact is preserved on the target'
);

select is(
    (
        select sum(quantity)::integer
        from public.holdings
        where wine_id = '00000000-0000-4000-8000-000000000181'
    ),
    9,
    'All target and source bottles are conserved'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id = '00000000-0000-4000-8000-000000000181'
          and location_id = '00000000-0000-4000-8000-000000000121'
    ),
    5,
    'Overlapping physical positions are consolidated'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id = '00000000-0000-4000-8000-000000000181'
          and location_id = '00000000-0000-4000-8000-000000000122'
    ),
    4,
    'A source-only physical position is transferred'
);

select is(
    (
        select count(*)
        from public.holdings
        where wine_id = '00000000-0000-4000-8000-000000000180'
    ),
    0::bigint,
    'No current holding remains on the retired entry'
);

select is(
    (
        select wine_id
        from public.household_wine_observations
        where id = '00000000-0000-4000-8000-000000000186'
    ),
    '00000000-0000-4000-8000-000000000181'::uuid,
    'Private observations follow the active wine'
);

select ok(
    exists (
        select 1
        from public.wine_serving_overrides
        where household_id = '00000000-0000-4000-8000-000000000100'
          and wine_id = '00000000-0000-4000-8000-000000000181'
    ),
    'A non-conflicting serving override follows the active wine'
);

select ok(
    exists (
        select 1
        from public.wine_maturity_overrides
        where household_id = '00000000-0000-4000-8000-000000000100'
          and wine_id = '00000000-0000-4000-8000-000000000181'
    ),
    'A non-conflicting maturity override follows the active wine'
);

select is(
    (
        select wine_id
        from public.inventory_operations
        where id = '00000000-0000-4000-8000-000000000187'
    ),
    '00000000-0000-4000-8000-000000000180'::uuid,
    'The immutable inventory journal keeps its original wine UUID'
);

select is(
    (
        select bottles_transferred
        from public.wine_merge_events
        where source_wine_id = '00000000-0000-4000-8000-000000000180'
    ),
    7,
    'The audit event records the transferred bottle count'
);

select is(
    (
        select observations_transferred
        from public.wine_merge_events
        where source_wine_id = '00000000-0000-4000-8000-000000000180'
    ),
    1,
    'The audit event records private-data transfer counts'
);

reset role;

select throws_ok(
    $test$
        update public.wines
        set producer = 'Rewritten history'
        where id = '00000000-0000-4000-8000-000000000180'
    $test$,
    '23514',
    'A merged catalog entry is immutable',
    'Retired catalogue history cannot be rewritten'
);

insert into public.holdings (
    id,
    household_id,
    wine_id,
    location_id,
    quantity
)
values (
    '00000000-0000-4000-8000-000000000188',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000180',
    '00000000-0000-4000-8000-000000000123',
    1
);

select is(
    (
        select wine_id
        from public.holdings
        where id = '00000000-0000-4000-8000-000000000188'
    ),
    '00000000-0000-4000-8000-000000000181'::uuid,
    'A stale ADD is canonicalized to the active wine'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select operation_status
        from public.apply_add_inventory_operation(
            '00000000-0000-4000-8000-000000000189',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000190',
            'merge domaine',
            'Twin Cuvée',
            2020,
            'red',
            'Morgon',
            'Beaujolais',
            750,
            '00000000-0000-4000-8000-000000000123',
            1,
            '2026-08-29T10:00:00Z'
        )
    ),
    'ACCEPTED',
    'A later ADD resolves against the one active duplicate target'
);

select is(
    (
        select wine_id
        from public.inventory_operations
        where id = '00000000-0000-4000-8000-000000000189'
    ),
    '00000000-0000-4000-8000-000000000181'::uuid,
    'The later ADD records the active target instead of recreating a duplicate'
);

select throws_ok(
    $test$
        select public.merge_wines(
            '00000000-0000-4000-8000-000000000182',
            '00000000-0000-4000-8000-000000000181'
        )
    $test$,
    '22023',
    'These entries are not a conservative duplicate match',
    'Different wines cannot be merged manually through the guarded RPC'
);

select throws_ok(
    $test$
        select public.merge_wines(
            '00000000-0000-4000-8000-000000000180',
            '00000000-0000-4000-8000-000000000181'
        )
    $test$,
    '22023',
    'These entries are not a conservative duplicate match',
    'An already retired row cannot be merged twice'
);

select throws_ok(
    $test$
        select public.merge_wines(
            '00000000-0000-4000-8000-000000000210',
            '00000000-0000-4000-8000-000000000181'
        )
    $test$,
    '42501',
    'Only a household owner can merge its catalog entries',
    'An owner cannot merge another household into their catalogue'
);

select is(
    (
        select count(*)
        from public.wine_merge_events
        where household_id = '00000000-0000-4000-8000-000000000200'
    ),
    0::bigint,
    'Cross-household attempts create no audit event'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.wine_merge_events',
        'INSERT'
    ),
    'Browser users cannot forge merge audit rows'
);

reset role;

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
    '00000000-0000-4000-8000-000000000193',
    '00000000-0000-4000-8000-000000000100',
    'Resolution Domaine',
    'One Wine',
    2019,
    'red',
    'Broad appellation',
    'Area A',
    750
),
(
    '00000000-0000-4000-8000-000000000194',
    '00000000-0000-4000-8000-000000000100',
    'Resolution Domaine',
    'One Wine',
    2019,
    'red',
    'Narrow appellation',
    'Area A',
    750
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.merge_wines(
        '00000000-0000-4000-8000-000000000193',
        '00000000-0000-4000-8000-000000000194',
        '{"appellation":"Reviewed appellation","area":null}'::jsonb
    ) #>> '{detection_basis}',
    'catalog-identity',
    'The resolution overload retains the conservative server-side merge check'
);

select is(
    (
        select appellation
        from public.wines
        where id = '00000000-0000-4000-8000-000000000194'
    ),
    'Reviewed appellation',
    'A manually reviewed text value becomes the active catalogue value'
);

select is(
    (
        select area
        from public.wines
        where id = '00000000-0000-4000-8000-000000000194'
    ),
    null,
    'A reviewed optional value can deliberately remain unset'
);

select is(
    (
        select resolved_values ->> 'appellation'
        from public.wine_merge_events
        where source_wine_id = '00000000-0000-4000-8000-000000000193'
    ),
    'Reviewed appellation',
    'The audit event stores the explicit resolution'
);

select is(
    (
        select target_snapshot_after ->> 'appellation'
        from public.wine_merge_events
        where source_wine_id = '00000000-0000-4000-8000-000000000193'
    ),
    'Reviewed appellation',
    'The final audit snapshot includes the resolved value'
);

select * from finish();

rollback;
