begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

select has_table(
    'public',
    'wine_reference_entities',
    'Shared references have stable root identities'
);

select has_table(
    'public',
    'wine_reference_producers',
    'Shared producers have a typed table'
);

select has_table(
    'public',
    'wine_reference_products',
    'Shared products have a typed table'
);

select has_table(
    'public',
    'wine_reference_releases',
    'Vintage and identified NV releases have a typed table'
);

select has_table(
    'public',
    'wine_reference_packages',
    'Bottle and case packages have a typed table'
);

select has_table(
    'public',
    'wine_reference_aliases',
    'Curated global aliases have a dedicated table'
);

select has_table(
    'public',
    'wine_reference_external_identifiers',
    'External identifiers have a dedicated table'
);

select has_table(
    'public',
    'wine_reference_supersessions',
    'Merges and successions have a dedicated table'
);

select has_column(
    'public',
    'wines',
    'wine_reference_id',
    'Household wines may link to a shared identity'
);

select has_column(
    'public',
    'wines',
    'wine_reference_type',
    'Household wine links retain their match specificity'
);

select is(
    (
        select count(*)
        from public.wines
        where wine_reference_id is null
          and wine_reference_type is null
    ),
    2::bigint,
    'The migration does not guess links for existing household wines'
);

select is(
    (
        select sum(quantity)
        from public.holdings
    ),
    7::bigint,
    'The migration preserves every existing bottle'
);

select ok(
    (
        select pg_catalog.bool_and(relrowsecurity)
        from pg_catalog.pg_class
        where oid in (
            'public.wine_reference_entities'::regclass,
            'public.wine_reference_producers'::regclass,
            'public.wine_reference_products'::regclass,
            'public.wine_reference_releases'::regclass,
            'public.wine_reference_packages'::regclass,
            'public.wine_reference_aliases'::regclass,
            'public.wine_reference_external_identifiers'::regclass,
            'public.wine_reference_supersessions'::regclass
        )
    ),
    'Every shared reference table has RLS enabled'
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
                'public.wine_reference_entities',
                'public.wine_reference_producers',
                'public.wine_reference_products',
                'public.wine_reference_releases',
                'public.wine_reference_packages',
                'public.wine_reference_aliases',
                'public.wine_reference_external_identifiers',
                'public.wine_reference_supersessions'
            ]
        ) as tables(table_name)
    ),
    'Browser users cannot read or mutate the shared library directly'
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
                'public.wine_reference_entities',
                'public.wine_reference_producers',
                'public.wine_reference_products',
                'public.wine_reference_releases',
                'public.wine_reference_packages',
                'public.wine_reference_aliases',
                'public.wine_reference_external_identifiers',
                'public.wine_reference_supersessions'
            ]
        ) as tables(table_name)
    ),
    'Anonymous users cannot read the shared library'
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
                'public.wine_reference_entities',
                'public.wine_reference_producers',
                'public.wine_reference_products',
                'public.wine_reference_releases',
                'public.wine_reference_packages',
                'public.wine_reference_aliases',
                'public.wine_reference_external_identifiers',
                'public.wine_reference_supersessions'
            ]
        ) as tables(table_name)
    ),
    'PowerSync cannot read the global reference library'
);

select ok(
    (
        select pg_catalog.bool_and(
            has_table_privilege(
                'service_role',
                table_name,
                'SELECT, INSERT, UPDATE, DELETE'
            )
        )
        from unnest(
            array[
                'public.wine_reference_entities',
                'public.wine_reference_producers',
                'public.wine_reference_products',
                'public.wine_reference_releases',
                'public.wine_reference_packages',
                'public.wine_reference_aliases',
                'public.wine_reference_external_identifiers',
                'public.wine_reference_supersessions'
            ]
        ) as tables(table_name)
    ),
    'Trusted service code can maintain the shared library'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_publication_tables
        where pubname = 'powersync'
          and schemaname = 'public'
          and tablename like 'wine_reference_%'
    ),
    0::bigint,
    'Global reference tables are not published through PowerSync'
);

select ok(
    not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'wine_reference_aliases'
          and column_name = 'household_id'
    ),
    'Global aliases are distinct from future household match decisions'
);

insert into public.wine_reference_entities (id, entity_type)
values
    ('00000000-0000-4000-8000-000000000500', 'producer'),
    ('00000000-0000-4000-8000-000000000501', 'producer'),
    ('00000000-0000-4000-8000-000000000510', 'product'),
    ('00000000-0000-4000-8000-000000000511', 'product'),
    ('00000000-0000-4000-8000-000000000520', 'release'),
    ('00000000-0000-4000-8000-000000000521', 'release'),
    ('00000000-0000-4000-8000-000000000530', 'package'),
    ('00000000-0000-4000-8000-000000000531', 'package');

insert into public.wine_reference_producers (
    id,
    canonical_name
)
values
    (
        '00000000-0000-4000-8000-000000000500',
        'Domaine Shared Name'
    ),
    (
        '00000000-0000-4000-8000-000000000501',
        'Domaine Shared Name'
    );

insert into public.wine_reference_products (
    id,
    producer_id,
    canonical_name
)
values
    (
        '00000000-0000-4000-8000-000000000510',
        '00000000-0000-4000-8000-000000000500',
        'Reference A'
    ),
    (
        '00000000-0000-4000-8000-000000000511',
        '00000000-0000-4000-8000-000000000501',
        'Reference B'
    );

insert into public.wine_reference_releases (
    id,
    product_id,
    vintage_year
)
values
    (
        '00000000-0000-4000-8000-000000000520',
        '00000000-0000-4000-8000-000000000510',
        2020
    ),
    (
        '00000000-0000-4000-8000-000000000521',
        '00000000-0000-4000-8000-000000000511',
        2021
    );

insert into public.wine_reference_packages (
    id,
    release_id,
    volume_ml,
    unit_count
)
values
    (
        '00000000-0000-4000-8000-000000000530',
        '00000000-0000-4000-8000-000000000520',
        750,
        1
    ),
    (
        '00000000-0000-4000-8000-000000000531',
        '00000000-0000-4000-8000-000000000521',
        750,
        6
    );

select is(
    (
        select count(*)
        from public.wine_reference_packages package
        join public.wine_reference_releases release
          on release.id = package.release_id
        join public.wine_reference_products product
          on product.id = release.product_id
        join public.wine_reference_producers producer
          on producer.id = product.producer_id
    ),
    2::bigint,
    'Producer, product, release, and package form a complete hierarchy'
);

select is(
    (
        select count(*)
        from public.wine_reference_producers
        where canonical_name = 'Domaine Shared Name'
    ),
    2::bigint,
    'Canonical producer names may collide without merging identities'
);

select throws_ok(
    $test$
        insert into public.wine_reference_entities (id, entity_type)
        values (
            '00000000-0000-4000-8000-000000000599',
            'producer'
        );
        set constraints wine_reference_entities_shape immediate;
    $test$,
    '23514',
    'Wine reference entity requires its matching typed row',
    'A stable identity cannot commit without its typed row'
);

select throws_ok(
    $test$
        insert into public.wine_reference_producers (
            id,
            canonical_name
        )
        values (
            '00000000-0000-4000-8000-000000000510',
            'Wrong typed row'
        )
    $test$,
    '23503',
    'insert or update on table "wine_reference_producers" violates foreign key constraint "wine_reference_producers_entity_fk"',
    'A root identity cannot receive a typed row of another kind'
);

select throws_ok(
    $test$
        insert into public.wine_reference_releases (
            id,
            product_id
        )
        values (
            '00000000-0000-4000-8000-000000000520',
            '00000000-0000-4000-8000-000000000510'
        )
    $test$,
    '23514',
    'new row for relation "wine_reference_releases" violates check constraint "wine_reference_releases_identity_check"',
    'A generic unidentified NV row cannot masquerade as a release'
);

select throws_ok(
    $test$
        insert into public.wine_reference_packages (
            id,
            release_id,
            volume_ml
        )
        values (
            '00000000-0000-4000-8000-000000000530',
            '00000000-0000-4000-8000-000000000520',
            0
        )
    $test$,
    '23514',
    'new row for relation "wine_reference_packages" violates check constraint "wine_reference_packages_volume_check"',
    'A package requires a positive unit volume'
);

insert into public.wine_reference_aliases (
    entity_id,
    entity_type,
    alias_value,
    normalized_value,
    locale,
    source_name
)
values (
    '00000000-0000-4000-8000-000000000500',
    'producer',
    'Domaine Shared',
    'domaine shared',
    'fr',
    'cellarmanager'
);

select throws_ok(
    $test$
        insert into public.wine_reference_aliases (
            entity_id,
            entity_type,
            alias_value,
            normalized_value,
            locale,
            source_name
        )
        values (
            '00000000-0000-4000-8000-000000000500',
            'producer',
            '  Domaine   Shared  ',
            'domaine shared',
            'fr',
            'CellarManager'
        )
    $test$,
    '23505',
    'duplicate key value violates unique constraint "wine_reference_aliases_source_unique"',
    'One source cannot add the same normalized alias twice'
);

insert into public.wine_reference_external_identifiers (
    entity_id,
    entity_type,
    authority,
    identifier_scheme,
    identifier_value
)
values
    (
        '00000000-0000-4000-8000-000000000510',
        'product',
        'liv-ex',
        'LWIN7',
        '1234567'
    ),
    (
        '00000000-0000-4000-8000-000000000520',
        'release',
        'liv-ex',
        'LWIN11',
        '12345672020'
    ),
    (
        '00000000-0000-4000-8000-000000000530',
        'package',
        'liv-ex',
        'LWIN16',
        '1234567202000750'
    ),
    (
        '00000000-0000-4000-8000-000000000531',
        'package',
        'liv-ex',
        'LWIN18',
        '123456720200600750'
    );

select is(
    (
        select count(*)
        from public.wine_reference_external_identifiers
        where authority = 'liv-ex'
    ),
    4::bigint,
    'LWIN7, LWIN11, LWIN16, and LWIN18 attach at their correct levels'
);

select throws_ok(
    $test$
        insert into public.wine_reference_external_identifiers (
            entity_id,
            entity_type,
            authority,
            identifier_scheme,
            identifier_value
        )
        values (
            '00000000-0000-4000-8000-000000000521',
            'release',
            'liv-ex',
            'LWIN7',
            '7654321'
        )
    $test$,
    '23514',
    'new row for relation "wine_reference_external_identifiers" violates check constraint "wine_reference_external_identifiers_lwin_scope_check"',
    'LWIN7 cannot attach to a release'
);

select throws_ok(
    $test$
        insert into public.wine_reference_external_identifiers (
            entity_id,
            entity_type,
            authority,
            identifier_scheme,
            identifier_value
        )
        values (
            '00000000-0000-4000-8000-000000000511',
            'product',
            'liv-ex',
            'LWIN7',
            'not-seven-digits'
        )
    $test$,
    '23514',
    'new row for relation "wine_reference_external_identifiers" violates check constraint "wine_reference_external_identifiers_lwin_scope_check"',
    'Malformed LWIN values are rejected'
);

select throws_ok(
    $test$
        insert into public.wine_reference_external_identifiers (
            entity_id,
            entity_type,
            authority,
            identifier_scheme,
            identifier_value
        )
        values (
            '00000000-0000-4000-8000-000000000511',
            'product',
            'liv-ex',
            'LWIN7',
            '1234567'
        )
    $test$,
    '23505',
    'duplicate key value violates unique constraint "wine_reference_external_identifiers_authority_unique"',
    'One external identifier cannot identify two shared references'
);

select throws_ok(
    $test$
        insert into public.wine_reference_supersessions (
            predecessor_entity_id,
            successor_entity_id,
            entity_type,
            relationship_type
        )
        values (
            '00000000-0000-4000-8000-000000000510',
            '00000000-0000-4000-8000-000000000510',
            'product',
            'merge'
        )
    $test$,
    '23514',
    'Wine reference supersession would create a cycle',
    'A shared reference cannot supersede itself'
);

select throws_ok(
    $test$
        insert into public.wine_reference_supersessions (
            predecessor_entity_id,
            successor_entity_id,
            entity_type,
            relationship_type
        )
        values (
            '00000000-0000-4000-8000-000000000500',
            '00000000-0000-4000-8000-000000000510',
            'producer',
            'successor'
        )
    $test$,
    '23503',
    'insert or update on table "wine_reference_supersessions" violates foreign key constraint "wine_reference_supersessions_successor_fk"',
    'Supersession cannot cross reference types'
);

insert into public.wine_reference_supersessions (
    predecessor_entity_id,
    successor_entity_id,
    entity_type,
    relationship_type
)
values (
    '00000000-0000-4000-8000-000000000510',
    '00000000-0000-4000-8000-000000000511',
    'product',
    'merge'
);

select throws_ok(
    $test$
        insert into public.wine_reference_supersessions (
            predecessor_entity_id,
            successor_entity_id,
            entity_type,
            relationship_type
        )
        values (
            '00000000-0000-4000-8000-000000000511',
            '00000000-0000-4000-8000-000000000510',
            'product',
            'merge'
        )
    $test$,
    '23514',
    'Wine reference supersession would create a cycle',
    'Supersession chains cannot contain cycles'
);

select throws_ok(
    $test$
        update public.wine_reference_supersessions
        set predecessor_entity_id =
                '00000000-0000-4000-8000-000000000511'
        where predecessor_entity_id =
                '00000000-0000-4000-8000-000000000510'
    $test$,
    '22023',
    'A wine reference predecessor cannot be changed',
    'A supersession predecessor remains stable'
);

select lives_ok(
    $test$
        update public.wines
        set wine_reference_id =
                '00000000-0000-4000-8000-000000000510',
            wine_reference_type = 'product'
        where id = '00000000-0000-4000-8000-000000000110'
    $test$,
    'A household wine may link at product specificity'
);

select is(
    (
        select count(*)
        from public.wines
        where id = '00000000-0000-4000-8000-000000000110'
          and producer = 'Domaine Test'
          and cuvee = 'Cuvée Offline'
          and vintage = 2020
          and wine_reference_id =
                '00000000-0000-4000-8000-000000000510'
          and wine_reference_type = 'product'
    ),
    1::bigint,
    'Linking does not replace household-maintained wine fields'
);

select throws_ok(
    $test$
        update public.wines
        set wine_reference_id =
                '00000000-0000-4000-8000-000000000500',
            wine_reference_type = 'producer'
        where id = '00000000-0000-4000-8000-000000000110'
    $test$,
    '23514',
    'new row for relation "wines" violates check constraint "wines_reference_shape_check"',
    'A household wine cannot link only to a producer'
);

select throws_ok(
    $test$
        update public.wines
        set wine_reference_id =
                '00000000-0000-4000-8000-000000000530',
            wine_reference_type = 'release'
        where id = '00000000-0000-4000-8000-000000000110'
    $test$,
    '23503',
    'insert or update on table "wines" violates foreign key constraint "wines_reference_entity_fk"',
    'A household link cannot claim the wrong reference specificity'
);

select * from finish();

rollback;
