begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

select has_column(
    'public',
    'wines',
    'country',
    'Wines expose typed country metadata'
);

select has_column(
    'public',
    'wines',
    'drink_until_year',
    'Wines expose a drinking-window end year'
);

select has_table(
    'public',
    'wine_notes',
    'Personal wine notes have a dedicated table'
);

select has_table(
    'public',
    'wine_grape_components',
    'Grape composition has a normalized table'
);

select has_table(
    'public',
    'wine_food_pairings',
    'Food pairings have a normalized table'
);

select has_table(
    'public',
    'wine_certifications',
    'Certifications have a normalized table'
);

select has_table(
    'public',
    'wine_external_identifiers',
    'External identifiers have a normalized table'
);

select has_table(
    'public',
    'wine_field_provenance',
    'Wine field provenance has a dedicated table'
);

select ok(
    (
        select count(*) = 3
        from pg_catalog.pg_constraint
        where conrelid = 'public.wines'::regclass
          and conname in (
              'wines_drinking_window_check',
              'wines_serving_temperature_range_check',
              'wines_alcohol_abv_check'
          )
    ),
    'Typed wine ranges are protected by database constraints'
);

select ok(
    (
        select pg_catalog.bool_and(
            has_table_privilege(
                'authenticated',
                table_name,
                'SELECT'
            )
        )
        from unnest(
            array[
                'public.wine_notes',
                'public.wine_grape_components',
                'public.wine_food_pairings',
                'public.wine_certifications',
                'public.wine_external_identifiers',
                'public.wine_field_provenance'
            ]
        ) as tables(table_name)
    ),
    'Authenticated users may select every rich-detail table'
);

select ok(
    (
        select pg_catalog.bool_and(
            not has_table_privilege(
                'authenticated',
                table_name,
                'INSERT, UPDATE, DELETE'
            )
        )
        from unnest(
            array[
                'public.wine_notes',
                'public.wine_grape_components',
                'public.wine_food_pairings',
                'public.wine_certifications',
                'public.wine_external_identifiers',
                'public.wine_field_provenance'
            ]
        ) as tables(table_name)
    ),
    'Authenticated users cannot write rich details directly'
);

select ok(
    (
        select pg_catalog.bool_and(
            not has_table_privilege(
                'anon',
                table_name,
                'SELECT'
            )
        )
        from unnest(
            array[
                'public.wine_notes',
                'public.wine_grape_components',
                'public.wine_food_pairings',
                'public.wine_certifications',
                'public.wine_external_identifiers',
                'public.wine_field_provenance'
            ]
        ) as tables(table_name)
    ),
    'Anonymous users cannot read rich details'
);

select ok(
    (
        select pg_catalog.bool_and(
            has_table_privilege(
                'powersync_role',
                table_name,
                'SELECT'
            )
        )
        from unnest(
            array[
                'public.wine_notes',
                'public.wine_grape_components',
                'public.wine_food_pairings',
                'public.wine_certifications',
                'public.wine_external_identifiers',
                'public.wine_field_provenance'
            ]
        ) as tables(table_name)
    ),
    'PowerSync may replicate every rich-detail table'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_publication_tables
        where pubname = 'powersync'
          and schemaname = 'public'
          and tablename in (
              'wine_notes',
              'wine_grape_components',
              'wine_food_pairings',
              'wine_certifications',
              'wine_external_identifiers',
              'wine_field_provenance'
          )
    ),
    6::bigint,
    'Every rich-detail table belongs to the PowerSync publication'
);

select throws_ok(
    $test$
        update public.wines
        set drink_from_year = 2030,
            drink_until_year = 2020
        where id = '00000000-0000-4000-8000-000000000110'
    $test$,
    '23514',
    'new row for relation "wines" violates check constraint "wines_drinking_window_check"',
    'An inverted drinking window is rejected'
);

select lives_ok(
    $test$
        update public.wines
        set alcohol_abv = 0
        where id = '00000000-0000-4000-8000-000000000110'
    $test$,
    'A non-alcoholic wine may record 0% alcohol'
);

select throws_ok(
    $test$
        insert into public.wine_grape_components (
            household_id,
            wine_id,
            grape_name,
            percentage
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000110',
            'Syrah',
            101
        )
    $test$,
    '23514',
    'new row for relation "wine_grape_components" violates check constraint "wine_grape_components_percentage_check"',
    'A grape percentage above 100 is rejected'
);

select throws_ok(
    $test$
        insert into public.wine_food_pairings (
            household_id,
            wine_id,
            pairing
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000210',
            'Cross-household pairing'
        )
    $test$,
    '23503',
    'insert or update on table "wine_food_pairings" violates foreign key constraint "wine_food_pairings_wine_fk"',
    'A child row cannot cross the wine household boundary'
);

select throws_ok(
    $test$
        insert into public.wine_field_provenance (
            household_id,
            wine_id,
            field_name,
            source_kind,
            source_name,
            value_snapshot
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000110',
            'country',
            'provider',
            'Provider without retrieval time',
            '"France"'::jsonb
        )
    $test$,
    '23514',
    'new row for relation "wine_field_provenance" violates check constraint "wine_field_provenance_provider_shape_check"',
    'Provider provenance requires a retrieval time'
);

select is(
    (
        select count(*)
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and is_current
    ),
    5::bigint,
    'A newly created wine protects all populated core fields'
);

select is(
    (
        select count(*)
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and source_kind = 'unattributed'
          and is_current
    ),
    5::bigint,
    'Initial core provenance is honestly marked unattributed'
);

select is(
    (
        select value_snapshot
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'vintage'
          and is_current
    ),
    '2020'::jsonb,
    'Initial provenance retains a typed value snapshot'
);

select ok(
    private.replace_wine_field_provenance(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000110',
        'country',
        '"France"'::jsonb,
        'provider',
        'Reference provider',
        'provider-wine-110',
        'https://provider.example/wines/110',
        0.9000,
        '2026-08-16T08:00:00Z',
        '00000000-0000-4000-8000-000000000001'
    ) is not null,
    'A guarded mutation can record provider provenance'
);

select ok(
    private.replace_wine_field_provenance(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000110',
        'country',
        '"Italie"'::jsonb,
        'manual',
        null,
        null,
        null,
        null,
        null,
        '00000000-0000-4000-8000-000000000001'
    ) is not null,
    'A later reviewed value appends new provenance'
);

select is(
    (
        select count(*)
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'country'
    ),
    2::bigint,
    'Provenance replacement preserves field history'
);

select is(
    (
        select count(*)
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'country'
          and is_current
    ),
    1::bigint,
    'Exactly one provenance row remains current'
);

select is(
    (
        select source_kind
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'country'
          and is_current
    ),
    'manual',
    'The latest applied source becomes current'
);

select is(
    (
        select count(*)
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'country'
          and source_kind = 'provider'
          and not is_current
    ),
    1::bigint,
    'Previous provider evidence remains non-current history'
);

insert into public.household_members (
    household_id,
    user_id,
    role
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000002',
    'member'
);

insert into public.wine_notes (
    household_id,
    wine_id,
    user_id,
    notes
)
values
(
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000001',
    'My private note'
),
(
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000002',
    'Another member private note'
);

insert into public.wine_grape_components (
    household_id,
    wine_id,
    grape_name,
    percentage
)
values
(
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    'Grenache',
    70
),
(
    '00000000-0000-4000-8000-000000000200',
    '00000000-0000-4000-8000-000000000210',
    'Private grape',
    null
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.update_wine_catalog(
        '00000000-0000-4000-8000-000000000110',
        'Edited provenance domaine',
        'Cuvée Offline',
        2020,
        'red',
        null,
        null
    ),
    '00000000-0000-4000-8000-000000000110'::uuid,
    'Existing catalog editing remains compatible'
);

select is(
    (
        select source_kind
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'producer'
          and is_current
    ),
    'manual',
    'An existing catalog edit records manual provenance'
);

select is(
    (
        select applied_by
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'producer'
          and is_current
    ),
    '00000000-0000-4000-8000-000000000001'::uuid,
    'Manual provenance records the acting user'
);

select is(
    (
        select count(*)
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'producer'
          and source_kind = 'unattributed'
          and not is_current
    ),
    1::bigint,
    'Core editing preserves the previous source as history'
);

select is(
    (
        select value_snapshot
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'producer'
          and is_current
    ),
    '"Edited provenance domaine"'::jsonb,
    'Core editing snapshots the canonical normalized value'
);

select is(
    (select count(*) from public.wine_notes),
    1::bigint,
    'A member sees only their own personal wine note'
);

select is(
    (select notes from public.wine_notes),
    'My private note',
    'The visible personal note belongs to the current user'
);

select is(
    (select count(*) from public.wine_grape_components),
    1::bigint,
    'Shared grape composition remains household-scoped'
);

select is(
    (
        select count(*)
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000210'
    ),
    0::bigint,
    'Provenance from another household is hidden'
);

select is(
    (
        select count(*)
        from public.wine_field_provenance
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and field_name = 'country'
    ),
    2::bigint,
    'A member may read provenance history for their household wine'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'private.replace_wine_field_provenance(uuid,uuid,text,jsonb,text,text,text,text,numeric,timestamp with time zone,uuid)',
        'EXECUTE'
    ),
    'Browser users cannot call the internal provenance helper'
);

select * from finish();

rollback;
