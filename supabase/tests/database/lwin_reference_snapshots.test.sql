begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

select has_table(
    'public',
    'wine_reference_sources',
    'Identity-reference sources have durable attribution metadata'
);

select has_table(
    'public',
    'wine_reference_lwin_snapshots',
    'LWIN imports have auditable snapshot metadata'
);

select has_table(
    'public',
    'wine_reference_lwin_entries',
    'Normalized LWIN source rows are snapshot-scoped'
);

select has_table(
    'public',
    'wine_reference_identifier_demands',
    'Missing external identifiers have a durable service queue'
);

select has_view(
    'public',
    'wine_reference_active_lwin_entries',
    'Matching services have an active-snapshot projection'
);

select is(
    (
        select license_name
        from public.wine_reference_sources
        where source_key = 'liv-ex-lwin'
    ),
    'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    'The official LWIN licence is stored explicitly'
);

select ok(
    (
        select
            license_url = 'https://creativecommons.org/licenses/by/4.0/'
            and attribution_text like '%Liv-ex LWIN Database%'
            and attribution_text like '%does not imply Liv-ex endorsement%'
        from public.wine_reference_sources
        where source_key = 'liv-ex-lwin'
    ),
    'Stored attribution links the licence and avoids implied endorsement'
);

select ok(
    (
        select pg_catalog.bool_and(relrowsecurity)
        from pg_catalog.pg_class
        where oid in (
            'public.wine_reference_sources'::regclass,
            'public.wine_reference_lwin_snapshots'::regclass,
            'public.wine_reference_lwin_entries'::regclass,
            'public.wine_reference_identifier_demands'::regclass
        )
    ),
    'Every LWIN import table has RLS enabled'
);

select ok(
    (
        select pg_catalog.bool_and(
            not has_table_privilege(
                'authenticated',
                table_name,
                'SELECT, INSERT, UPDATE, DELETE'
            )
        )
        from unnest(
            array[
                'public.wine_reference_sources',
                'public.wine_reference_lwin_snapshots',
                'public.wine_reference_lwin_entries',
                'public.wine_reference_identifier_demands'
            ]
        ) as tables(table_name)
    ),
    'Authenticated browsers cannot read or mutate the LWIN source cache'
);

select ok(
    (
        select pg_catalog.bool_and(
            not has_table_privilege(
                'powersync_role',
                table_name,
                'SELECT'
            )
        )
        from unnest(
            array[
                'public.wine_reference_sources',
                'public.wine_reference_lwin_snapshots',
                'public.wine_reference_lwin_entries',
                'public.wine_reference_identifier_demands'
            ]
        ) as tables(table_name)
    ),
    'PowerSync cannot publish the global LWIN source cache'
);

select ok(
    (
        has_table_privilege(
            'service_role',
            'public.wine_reference_sources',
            'SELECT'
        )
        and not has_table_privilege(
            'service_role',
            'public.wine_reference_sources',
            'INSERT, UPDATE, DELETE'
        )
        and has_table_privilege(
            'service_role',
            'public.wine_reference_lwin_snapshots',
            'SELECT, INSERT'
        )
        and not has_table_privilege(
            'service_role',
            'public.wine_reference_lwin_snapshots',
            'UPDATE, DELETE'
        )
        and has_table_privilege(
            'service_role',
            'public.wine_reference_lwin_entries',
            'SELECT, INSERT'
        )
        and not has_table_privilege(
            'service_role',
            'public.wine_reference_lwin_entries',
            'UPDATE, DELETE'
        )
        and has_table_privilege(
            'service_role',
            'public.wine_reference_identifier_demands',
            'SELECT, INSERT, UPDATE, DELETE'
        )
    ),
    'Trusted services can stage immutable snapshots and maintain demands with least privilege'
);

select ok(
    has_table_privilege(
        'service_role',
        'public.wine_reference_active_lwin_entries',
        'SELECT'
    ),
    'Trusted services can query only the active snapshot projection'
);

select ok(
    has_function_privilege(
        'service_role',
        'public.finalize_wine_reference_lwin_snapshot(uuid)',
        'EXECUTE'
    ),
    'Trusted services can atomically finalize a snapshot'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'public.finalize_wine_reference_lwin_snapshot(uuid)',
        'EXECUTE'
    ),
    'Browser users cannot finalize a snapshot'
);

select ok(
    has_function_privilege(
        'service_role',
        'public.prune_wine_reference_lwin_snapshot_rows(integer)',
        'EXECUTE'
    ),
    'Trusted services can bound retained superseded row data'
);

select ok(
    has_function_privilege(
        'service_role',
        'public.fail_wine_reference_lwin_snapshot(uuid,text)',
        'EXECUTE'
    ),
    'Trusted services can cleanly fail an interrupted snapshot'
);

insert into public.wine_reference_lwin_snapshots (
    id,
    source_key,
    content_sha256,
    source_file_name,
    source_retrieved_at,
    expected_record_count
)
values (
    '00000000-0000-4000-8000-000000000600',
    'liv-ex-lwin',
    repeat('a', 64),
    'LWINdatabase.xlsx',
    '2026-08-20T10:00:00Z',
    2
);

insert into public.wine_reference_lwin_entries (
    snapshot_id,
    lwin7,
    source_row_number,
    source_status,
    display_name,
    producer_name,
    wine_name,
    vintage_configuration,
    source_updated_at,
    successor_lwin7
)
values
    (
        '00000000-0000-4000-8000-000000000600',
        '1000001',
        2,
        'live',
        'Example Estate, Example Wine',
        'Example Estate',
        'Example Wine',
        'sequential',
        '2026-08-19 16:15:06',
        null
    ),
    (
        '00000000-0000-4000-8000-000000000600',
        '1000002',
        3,
        'combined',
        'Old Example Name',
        'Example Estate',
        'Old Example Wine',
        'sequential',
        '2026-08-18 12:00:00',
        '1000001'
    );

select lives_ok(
    $test$
        select public.finalize_wine_reference_lwin_snapshot(
            '00000000-0000-4000-8000-000000000600'
        )
    $test$,
    'A complete internally consistent snapshot can be finalized'
);

select ok(
    (
        select
            import_status = 'active'
            and record_count = 2
            and live_record_count = 1
            and combined_record_count = 1
            and deleted_record_count = 0
            and source_updated_through = '2026-08-19 16:15:06'
        from public.wine_reference_lwin_snapshots
        where id = '00000000-0000-4000-8000-000000000600'
    ),
    'Finalization records verified counts and the latest source update'
);

select is(
    (
        select count(*)
        from public.wine_reference_active_lwin_entries
    ),
    2::bigint,
    'The first finalized snapshot becomes visible atomically'
);

insert into public.wine_reference_lwin_snapshots (
    id,
    source_key,
    content_sha256,
    source_file_name,
    source_retrieved_at,
    expected_record_count
)
values (
    '00000000-0000-4000-8000-000000000601',
    'liv-ex-lwin',
    repeat('b', 64),
    'LWINdatabase.xlsx',
    '2026-08-21T10:00:00Z',
    2
);

insert into public.wine_reference_lwin_entries (
    snapshot_id,
    lwin7,
    source_row_number,
    source_status,
    display_name,
    producer_name,
    wine_name,
    vintage_configuration,
    source_updated_at
)
values
    (
        '00000000-0000-4000-8000-000000000601',
        '1000001',
        2,
        'live',
        'Example Estate, Renamed Wine',
        'Example Estate',
        'Renamed Wine',
        'sequential',
        '2026-08-20 09:00:00'
    ),
    (
        '00000000-0000-4000-8000-000000000601',
        '1000003',
        3,
        'live',
        'Example Estate, New Wine',
        'Example Estate',
        'New Wine',
        'non_sequential',
        '2026-08-20 09:01:00'
    );

select lives_ok(
    $test$
        select public.finalize_wine_reference_lwin_snapshot(
            '00000000-0000-4000-8000-000000000601'
        )
    $test$,
    'A later complete snapshot can refresh the source cache'
);

select ok(
    (
        select
            count(*) filter (where import_status = 'active') = 1
            and count(*) filter (where import_status = 'superseded') = 1
        from public.wine_reference_lwin_snapshots
        where source_key = 'liv-ex-lwin'
    ),
    'Refresh supersedes exactly one prior snapshot and activates one replacement'
);

select ok(
    (
        select
            count(*) = 2
            and bool_and(snapshot_id =
                '00000000-0000-4000-8000-000000000601')
            and count(*) filter (where lwin7 = '1000003') = 1
            and count(*) filter (where lwin7 = '1000002') = 0
        from public.wine_reference_active_lwin_entries
    ),
    'Readers see only the replacement snapshot after refresh'
);

select throws_ok(
    $test$
        insert into public.wine_reference_lwin_snapshots (
            source_key,
            content_sha256,
            source_file_name,
            source_retrieved_at,
            expected_record_count
        )
        values (
            'liv-ex-lwin',
            repeat('b', 64),
            'duplicate.xlsx',
            now(),
            1
        )
    $test$,
    '23505',
    'duplicate key value violates unique constraint "wine_reference_lwin_snapshots_source_hash_idx"',
    'A successful source hash cannot be imported twice'
);

insert into public.wine_reference_lwin_snapshots (
    id,
    source_key,
    content_sha256,
    source_file_name,
    source_retrieved_at,
    expected_record_count
)
values (
    '00000000-0000-4000-8000-000000000602',
    'liv-ex-lwin',
    repeat('c', 64),
    'incomplete.xlsx',
    now(),
    2
);

insert into public.wine_reference_lwin_entries (
    snapshot_id,
    lwin7,
    source_row_number,
    source_status,
    vintage_configuration
)
values (
    '00000000-0000-4000-8000-000000000602',
    '2000001',
    2,
    'live',
    'sequential'
);

select throws_ok(
    $test$
        select public.finalize_wine_reference_lwin_snapshot(
            '00000000-0000-4000-8000-000000000602'
        )
    $test$,
    '23514',
    'LWIN snapshot expected 2 rows but received 1',
    'An incomplete upload cannot replace the active snapshot'
);

select is(
    public.fail_wine_reference_lwin_snapshot(
        '00000000-0000-4000-8000-000000000602',
        'simulated interrupted upload'
    ),
    1,
    'Failing an interrupted snapshot reports its removed staged row count'
);

select ok(
    (
        select
            import_status = 'failed'
            and not rows_retained
            and failure_reason = 'simulated interrupted upload'
            and completed_at is not null
            and not exists (
                select 1
                from public.wine_reference_lwin_entries entry
                where entry.snapshot_id = snapshot.id
            )
        from public.wine_reference_lwin_snapshots snapshot
        where snapshot.id = '00000000-0000-4000-8000-000000000602'
    ),
    'A failed snapshot remains auditable without retaining partial source rows'
);

insert into public.wine_reference_lwin_snapshots (
    id,
    source_key,
    content_sha256,
    source_file_name,
    source_retrieved_at,
    expected_record_count
)
values (
    '00000000-0000-4000-8000-000000000603',
    'liv-ex-lwin',
    repeat('d', 64),
    'dangling.xlsx',
    now(),
    1
);

insert into public.wine_reference_lwin_entries (
    snapshot_id,
    lwin7,
    source_row_number,
    source_status,
    vintage_configuration,
    successor_lwin7
)
values (
    '00000000-0000-4000-8000-000000000603',
    '3000001',
    2,
    'deleted',
    'sequential',
    '3000002'
);

select throws_ok(
    $test$
        select public.finalize_wine_reference_lwin_snapshot(
            '00000000-0000-4000-8000-000000000603'
        )
    $test$,
    '23503',
    'LWIN snapshot contains a missing successor reference',
    'A dangling provider successor cannot become active'
);

insert into public.wine_reference_lwin_snapshots (
    id,
    source_key,
    content_sha256,
    source_file_name,
    source_retrieved_at,
    expected_record_count
)
values (
    '00000000-0000-4000-8000-000000000604',
    'liv-ex-lwin',
    repeat('e', 64),
    'cycle.xlsx',
    now(),
    2
);

insert into public.wine_reference_lwin_entries (
    snapshot_id,
    lwin7,
    source_row_number,
    source_status,
    vintage_configuration,
    successor_lwin7
)
values
    (
        '00000000-0000-4000-8000-000000000604',
        '4000001',
        2,
        'combined',
        'sequential',
        '4000002'
    ),
    (
        '00000000-0000-4000-8000-000000000604',
        '4000002',
        3,
        'combined',
        'sequential',
        '4000001'
    );

select throws_ok(
    $test$
        select public.finalize_wine_reference_lwin_snapshot(
            '00000000-0000-4000-8000-000000000604'
        )
    $test$,
    '23514',
    'LWIN snapshot contains a successor cycle',
    'A provider successor cycle cannot become active'
);

select is(
    public.prune_wine_reference_lwin_snapshot_rows(0),
    1,
    'Superseded row retention can be pruned explicitly'
);

select ok(
    (
        select
            not rows_retained
            and not exists (
                select 1
                from public.wine_reference_lwin_entries entry
                where entry.snapshot_id = snapshot.id
            )
            and record_count = 2
            and content_sha256 = repeat('a', 64)
        from public.wine_reference_lwin_snapshots snapshot
        where snapshot.id = '00000000-0000-4000-8000-000000000600'
    ),
    'Pruning preserves snapshot audit metadata while removing old row copies'
);

insert into public.wine_reference_entities (id, entity_type)
values
    ('00000000-0000-4000-8000-000000000700', 'producer'),
    ('00000000-0000-4000-8000-000000000710', 'product'),
    ('00000000-0000-4000-8000-000000000711', 'product'),
    ('00000000-0000-4000-8000-000000000712', 'release'),
    ('00000000-0000-4000-8000-000000000713', 'package');

insert into public.wine_reference_producers (id, canonical_name)
values (
    '00000000-0000-4000-8000-000000000700',
    'Missing Reference Estate'
);

insert into public.wine_reference_products (
    id,
    producer_id,
    canonical_name
)
values
    (
        '00000000-0000-4000-8000-000000000710',
        '00000000-0000-4000-8000-000000000700',
        'Missing LWIN Wine'
    ),
    (
        '00000000-0000-4000-8000-000000000711',
        '00000000-0000-4000-8000-000000000700',
        'Known LWIN Wine'
    );

insert into public.wine_reference_releases (
    id,
    product_id,
    vintage_year
)
values (
    '00000000-0000-4000-8000-000000000712',
    '00000000-0000-4000-8000-000000000710',
    2020
);

insert into public.wine_reference_packages (
    id,
    release_id,
    volume_ml,
    unit_count
)
values (
    '00000000-0000-4000-8000-000000000713',
    '00000000-0000-4000-8000-000000000712',
    750,
    6
);

insert into public.wine_reference_identifier_demands (
    id,
    entity_id,
    entity_type,
    authority,
    identifier_scheme
)
values (
    '00000000-0000-4000-8000-000000000720',
    '00000000-0000-4000-8000-000000000710',
    'product',
    'liv-ex',
    'LWIN7'
);

select is(
    (
        select demand_status
        from public.wine_reference_identifier_demands
        where id = '00000000-0000-4000-8000-000000000720'
    ),
    'pending',
    'A product remains usable while its LWIN demand waits offline'
);

insert into public.wine_reference_identifier_demands (
    id,
    entity_id,
    entity_type,
    authority,
    identifier_scheme
)
values (
    '00000000-0000-4000-8000-000000000722',
    '00000000-0000-4000-8000-000000000713',
    'package',
    'liv-ex',
    'LWIN18'
);

select is(
    (
        select demand_status
        from public.wine_reference_identifier_demands
        where id = '00000000-0000-4000-8000-000000000722'
    ),
    'pending',
    'A package may durably request its pack-aware LWIN18'
);

select throws_ok(
    $test$
        insert into public.wine_reference_identifier_demands (
            entity_id,
            entity_type,
            authority,
            identifier_scheme
        )
        values (
            '00000000-0000-4000-8000-000000000710',
            'product',
            'liv-ex',
            'LWIN11'
        )
    $test$,
    '23514',
    'new row for relation "wine_reference_identifier_demands" violates check constraint "wine_reference_identifier_demands_scope_check"',
    'A missing-identifier demand must target the correct identity level'
);

insert into public.wine_reference_external_identifiers (
    id,
    entity_id,
    entity_type,
    authority,
    identifier_scheme,
    identifier_value
)
values (
    '00000000-0000-4000-8000-000000000730',
    '00000000-0000-4000-8000-000000000710',
    'product',
    'liv-ex',
    'LWIN7',
    '7654321'
);

select ok(
    (
        select
            demand_status = 'resolved'
            and resolved_identifier_id =
                '00000000-0000-4000-8000-000000000730'
            and resolved_at is not null
        from public.wine_reference_identifier_demands
        where id = '00000000-0000-4000-8000-000000000720'
    ),
    'Adding the external identifier resolves its durable demand automatically'
);

insert into public.wine_reference_external_identifiers (
    id,
    entity_id,
    entity_type,
    authority,
    identifier_scheme,
    identifier_value
)
values (
    '00000000-0000-4000-8000-000000000731',
    '00000000-0000-4000-8000-000000000711',
    'product',
    'liv-ex',
    'LWIN7',
    '7654322'
);

insert into public.wine_reference_identifier_demands (
    id,
    entity_id,
    entity_type,
    authority,
    identifier_scheme
)
values (
    '00000000-0000-4000-8000-000000000721',
    '00000000-0000-4000-8000-000000000711',
    'product',
    'liv-ex',
    'LWIN7'
);

select is(
    (
        select demand_status
        from public.wine_reference_identifier_demands
        where id = '00000000-0000-4000-8000-000000000721'
    ),
    'resolved',
    'A demand created after its identifier resolves immediately'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_publication_tables
        where pubname = 'powersync'
          and schemaname = 'public'
          and tablename in (
              'wine_reference_sources',
              'wine_reference_lwin_snapshots',
              'wine_reference_lwin_entries',
              'wine_reference_identifier_demands'
          )
    ),
    0::bigint,
    'LWIN snapshots and demands are not published through PowerSync'
);

select * from finish();

rollback;
