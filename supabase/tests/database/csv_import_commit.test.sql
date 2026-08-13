begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

create temporary table csv_import_result as
select *
from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009300',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101',
    jsonb_build_array(
        jsonb_build_object(
            'record_number', 2,
            'operation_id',
                '00000000-0000-4000-8000-000000009301',
            'requested_wine_id',
                '00000000-0000-4000-8000-000000000110',
            'destination_location_id',
                '00000000-0000-4000-8000-000000000122',
            'quantity', 2,
            'wine_action', 'reuse',
            'wine_producer', 'Domaine Test',
            'wine_cuvee', 'Cuvée Offline',
            'wine_vintage', 2020,
            'wine_color', 'red',
            'wine_appellation', null,
            'wine_area', null,
            'wine_format_ml', 750
        ),
        jsonb_build_object(
            'record_number', 3,
            'operation_id',
                '00000000-0000-4000-8000-000000009302',
            'requested_wine_id',
                '00000000-0000-4000-8000-000000000113',
            'destination_location_id',
                '00000000-0000-4000-8000-000000000121',
            'quantity', 3,
            'wine_action', 'create',
            'wine_producer', ' Import Domaine ',
            'wine_cuvee', ' New Cuvée ',
            'wine_vintage', 2023,
            'wine_color', 'RED',
            'wine_appellation', 'Morgon',
            'wine_area', 'Beaujolais',
            'wine_format_ml', 750
        ),
        jsonb_build_object(
            'record_number', 4,
            'operation_id',
                '00000000-0000-4000-8000-000000009303',
            'requested_wine_id',
                '00000000-0000-4000-8000-000000000113',
            'destination_location_id',
                '00000000-0000-4000-8000-000000000122',
            'quantity', 4,
            'wine_action', 'create',
            'wine_producer', 'Import Domaine',
            'wine_cuvee', 'New Cuvée',
            'wine_vintage', 2023,
            'wine_color', 'red',
            'wine_appellation', 'Morgon',
            'wine_area', 'Beaujolais',
            'wine_format_ml', 750
        )
    ),
    '2026-08-14T10:00:00Z'
);

select is(
    (select imported_row_count from csv_import_result),
    3,
    'Mixed CSV imports every source row'
);

select is(
    (select imported_bottle_count from csv_import_result),
    9::bigint,
    'Mixed CSV imports every bottle'
);

select is(
    (select created_wine_count from csv_import_result),
    1,
    'Repeated new-wine rows create one catalog reference'
);

select is(
    (select reused_wine_count from csv_import_result),
    1,
    'Receipt counts one reused catalog reference'
);

select is(
    (
        select count(*)
        from public.wines
        where id = '00000000-0000-4000-8000-000000000113'
          and household_id =
              '00000000-0000-4000-8000-000000000100'
          and producer = 'Import Domaine'
          and cuvee = 'New Cuvée'
          and color = 'red'
    ),
    1::bigint,
    'New catalog wine is normalized and created once'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000113'
          and location_id =
            '00000000-0000-4000-8000-000000000121'
    ),
    3,
    'First new-wine row adds its holding'
);

select is(
    (
        select quantity
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000113'
          and location_id =
            '00000000-0000-4000-8000-000000000122'
    ),
    4,
    'Repeated new-wine row reuses the created catalog reference'
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
    'Existing wine receives imported stock'
);

select is(
    (
        select count(*)
        from public.inventory_operations
        where id in (
            '00000000-0000-4000-8000-000000009301',
            '00000000-0000-4000-8000-000000009302',
            '00000000-0000-4000-8000-000000009303'
        )
          and status = 'ACCEPTED'
    ),
    3::bigint,
    'Every imported row uses the normal accepted ADD journal'
);

create temporary table csv_import_retry_result as
select *
from public.commit_csv_import(
    '00000000-0000-4000-8000-000000009300',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101',
    jsonb_build_array(
        jsonb_build_object(
            'record_number', 2,
            'operation_id',
                '00000000-0000-4000-8000-000000009301',
            'requested_wine_id',
                '00000000-0000-4000-8000-000000000110',
            'destination_location_id',
                '00000000-0000-4000-8000-000000000122',
            'quantity', 2,
            'wine_action', 'reuse',
            'wine_producer', 'Domaine Test',
            'wine_cuvee', 'Cuvée Offline',
            'wine_vintage', 2020,
            'wine_color', 'red',
            'wine_appellation', null,
            'wine_area', null,
            'wine_format_ml', 750
        ),
        jsonb_build_object(
            'record_number', 3,
            'operation_id',
                '00000000-0000-4000-8000-000000009302',
            'requested_wine_id',
                '00000000-0000-4000-8000-000000000113',
            'destination_location_id',
                '00000000-0000-4000-8000-000000000121',
            'quantity', 3,
            'wine_action', 'create',
            'wine_producer', ' Import Domaine ',
            'wine_cuvee', ' New Cuvée ',
            'wine_vintage', 2023,
            'wine_color', 'RED',
            'wine_appellation', 'Morgon',
            'wine_area', 'Beaujolais',
            'wine_format_ml', 750
        ),
        jsonb_build_object(
            'record_number', 4,
            'operation_id',
                '00000000-0000-4000-8000-000000009303',
            'requested_wine_id',
                '00000000-0000-4000-8000-000000000113',
            'destination_location_id',
                '00000000-0000-4000-8000-000000000122',
            'quantity', 4,
            'wine_action', 'create',
            'wine_producer', 'Import Domaine',
            'wine_cuvee', 'New Cuvée',
            'wine_vintage', 2023,
            'wine_color', 'red',
            'wine_appellation', 'Morgon',
            'wine_area', 'Beaujolais',
            'wine_format_ml', 750
        )
    ),
    '2026-08-14T10:00:00Z'
);

select is(
    (select imported_bottle_count from csv_import_retry_result),
    9::bigint,
    'Exact retry returns the original receipt'
);

select is(
    (
        select imported_bottle_count
        from public.get_csv_import_receipt(
            '00000000-0000-4000-8000-000000009300',
            '00000000-0000-4000-8000-000000000100'
        )
    ),
    9::bigint,
    'Committed receipt can be verified after an uncertain response'
);

select is(
    (
        select count(*)
        from public.get_csv_import_receipt(
            '00000000-0000-4000-8000-000000009399',
            '00000000-0000-4000-8000-000000000100'
        )
    ),
    0::bigint,
    'A rolled-back or unknown import has no receipt'
);

select is(
    (
        select count(*)
        from public.inventory_operations
        where id in (
            '00000000-0000-4000-8000-000000009301',
            '00000000-0000-4000-8000-000000009302',
            '00000000-0000-4000-8000-000000009303'
        )
    ),
    3::bigint,
    'Exact retry does not create more operations'
);

select is(
    (
        select sum(quantity)
        from public.holdings
        where wine_id =
            '00000000-0000-4000-8000-000000000113'
    ),
    7::bigint,
    'Exact retry does not add bottles twice'
);

select throws_ok(
    $test$
        select *
        from public.commit_csv_import(
            '00000000-0000-4000-8000-000000009300',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            jsonb_build_array(
                jsonb_build_object(
                    'record_number', 2,
                    'operation_id',
                        '00000000-0000-4000-8000-000000009301',
                    'requested_wine_id',
                        '00000000-0000-4000-8000-000000000110',
                    'destination_location_id',
                        '00000000-0000-4000-8000-000000000122',
                    'quantity', 999,
                    'wine_action', 'reuse',
                    'wine_producer', 'Domaine Test',
                    'wine_cuvee', 'Cuvée Offline',
                    'wine_vintage', 2020,
                    'wine_color', 'red',
                    'wine_appellation', null,
                    'wine_area', null,
                    'wine_format_ml', 750
                )
            ),
            '2026-08-14T10:00:00Z'
        )
    $test$,
    '22023',
    'import_id was reused with a different payload',
    'Receipt ID cannot be reused for a changed payload'
);

select throws_ok(
    $test$
        select *
        from public.commit_csv_import(
            '00000000-0000-4000-8000-000000009310',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            jsonb_build_array(
                jsonb_build_object(
                    'record_number', 10,
                    'operation_id',
                        '00000000-0000-4000-8000-000000009311',
                    'requested_wine_id',
                        '00000000-0000-4000-8000-000000000114',
                    'destination_location_id',
                        '00000000-0000-4000-8000-000000000121',
                    'quantity', 1,
                    'wine_action', 'create',
                    'wine_producer', 'Rollback Domaine',
                    'wine_cuvee', 'First Row',
                    'wine_vintage', 2024,
                    'wine_color', 'white',
                    'wine_appellation', null,
                    'wine_area', null,
                    'wine_format_ml', 750
                ),
                jsonb_build_object(
                    'record_number', 11,
                    'operation_id',
                        '00000000-0000-4000-8000-000000009312',
                    'requested_wine_id',
                        '00000000-0000-4000-8000-000000000115',
                    'destination_location_id',
                        '00000000-0000-4000-8000-000000000999',
                    'quantity', 1,
                    'wine_action', 'create',
                    'wine_producer', 'Rollback Domaine',
                    'wine_cuvee', 'Bad Row',
                    'wine_vintage', 2024,
                    'wine_color', 'white',
                    'wine_appellation', null,
                    'wine_area', null,
                    'wine_format_ml', 750
                )
            ),
            '2026-08-14T10:10:00Z'
        )
    $test$,
    '22023',
    'Destination location does not belong to the household',
    'A bad later row rejects the whole import'
);

select is(
    (
        select count(*)
        from public.wines
        where id in (
            '00000000-0000-4000-8000-000000000114',
            '00000000-0000-4000-8000-000000000115'
        )
    ),
    0::bigint,
    'Failed import rolls back wine creation'
);

select is(
    (
        select count(*)
        from public.inventory_operations
        where id in (
            '00000000-0000-4000-8000-000000009311',
            '00000000-0000-4000-8000-000000009312'
        )
    ),
    0::bigint,
    'Failed import rolls back every inventory operation'
);

reset role;

select is(
    (
        select count(*)
        from private.csv_import_receipts
        where id = '00000000-0000-4000-8000-000000009310'
    ),
    0::bigint,
    'Failed import does not create a receipt'
);

update public.locations
set is_active = false
where id = '00000000-0000-4000-8000-000000000122';

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select throws_ok(
    $test$
        select *
        from public.commit_csv_import(
            '00000000-0000-4000-8000-000000009320',
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000101',
            jsonb_build_array(
                jsonb_build_object(
                    'record_number', 20,
                    'operation_id',
                        '00000000-0000-4000-8000-000000009321',
                    'requested_wine_id',
                        '00000000-0000-4000-8000-000000000116',
                    'destination_location_id',
                        '00000000-0000-4000-8000-000000000122',
                    'quantity', 1,
                    'wine_action', 'create',
                    'wine_producer', 'Archived Destination',
                    'wine_cuvee', 'Blocked',
                    'wine_vintage', 2024,
                    'wine_color', 'red',
                    'wine_appellation', null,
                    'wine_area', null,
                    'wine_format_ml', 750
                )
            ),
            '2026-08-14T10:20:00Z'
        )
    $test$,
    '22023',
    'Import row 20 was rejected: A cellar location used by this operation is archived',
    'Archived destination blocks the complete import'
);

select is(
    (
        select count(*)
        from public.wines
        where id = '00000000-0000-4000-8000-000000000116'
    ),
    0::bigint,
    'Archived destination rejection rolls back its wine'
);

select throws_ok(
    $test$
        select *
        from public.commit_csv_import(
            '00000000-0000-4000-8000-000000009330',
            '00000000-0000-4000-8000-000000000200',
            '00000000-0000-4000-8000-000000000201',
            jsonb_build_array(
                jsonb_build_object(
                    'record_number', 30,
                    'operation_id',
                        '00000000-0000-4000-8000-000000009331',
                    'requested_wine_id',
                        '00000000-0000-4000-8000-000000000210',
                    'destination_location_id',
                        '00000000-0000-4000-8000-000000000221',
                    'quantity', 1,
                    'wine_action', 'reuse',
                    'wine_producer', 'Other Domaine',
                    'wine_cuvee', 'Private Cuvée',
                    'wine_vintage', 2021,
                    'wine_color', 'other',
                    'wine_appellation', null,
                    'wine_area', null,
                    'wine_format_ml', 750
                )
            ),
            '2026-08-14T10:30:00Z'
        )
    $test$,
    '42501',
    'User is not a member of this household',
    'User cannot import into another household'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.commit_csv_import(uuid, uuid, uuid, jsonb, timestamptz)',
        'EXECUTE'
    ),
    'Authenticated browser may execute the import RPC'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_csv_import_receipt(uuid, uuid)',
        'EXECUTE'
    ),
    'Authenticated browser may verify its import receipt'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.commit_csv_import(uuid, uuid, uuid, jsonb, timestamptz)',
        'EXECUTE'
    ),
    'Anonymous browser cannot execute the import RPC'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.get_csv_import_receipt(uuid, uuid)',
        'EXECUTE'
    ),
    'Anonymous browser cannot verify an import receipt'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'private.csv_import_receipts',
        'SELECT'
    ),
    'Browser cannot read private import receipts directly'
);

select * from finish();

rollback;
