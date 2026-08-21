begin;

create extension if not exists pgtap with schema extensions;

select plan(43);

select has_table('public', 'enrichment_sources', 'Enrichment sources are durable');
select has_table('public', 'enrichment_source_policies', 'Source rights are versioned');
select has_table('public', 'enrichment_places', 'Geographic identities are hierarchical');
select has_table('public', 'enrichment_knowledge_versions', 'Knowledge publications are versioned');
select has_table('public', 'enrichment_profiles', 'Profiles have reviewed roots');
select has_table('public', 'enrichment_place_profiles', 'Place baselines are typed');
select has_table('public', 'enrichment_vintage_profiles', 'Vintage adjustments are typed');
select has_table('public', 'enrichment_producer_era_profiles', 'Producer eras are typed');
select has_table('public', 'enrichment_cuvee_profiles', 'Cuvee adjustments are typed');
select has_table('public', 'enrichment_evidence', 'Evidence is plural and provenance-aware');
select has_table('public', 'enrichment_profile_evidence', 'Profiles retain supporting and contradicting evidence');
select has_table('public', 'household_wine_observations', 'Owner observations remain household-scoped');
select has_table('public', 'wine_enrichment_projections', 'Recommendations are stored as derived projections');
select has_table('public', 'wine_enrichment_projection_profiles', 'Projections retain contributing profiles');
select has_table('public', 'wine_enrichment_projection_evidence', 'Projections retain contributing evidence');
select has_table('public', 'wine_enrichment_projection_observations', 'Projections retain contributing observations');

select ok(
    (
        select pg_catalog.bool_and(relrowsecurity)
        from pg_catalog.pg_class
        where oid in (
            'public.enrichment_sources'::regclass,
            'public.enrichment_source_policies'::regclass,
            'public.enrichment_places'::regclass,
            'public.enrichment_knowledge_versions'::regclass,
            'public.enrichment_profiles'::regclass,
            'public.enrichment_place_profiles'::regclass,
            'public.enrichment_vintage_profiles'::regclass,
            'public.enrichment_producer_era_profiles'::regclass,
            'public.enrichment_cuvee_profiles'::regclass,
            'public.enrichment_evidence'::regclass,
            'public.enrichment_profile_evidence'::regclass,
            'public.household_wine_observations'::regclass,
            'public.wine_enrichment_projections'::regclass,
            'public.wine_enrichment_projection_profiles'::regclass,
            'public.wine_enrichment_projection_evidence'::regclass,
            'public.wine_enrichment_projection_observations'::regclass
        )
    ),
    'Every enrichment table has RLS enabled'
);

select ok(
    (
        select pg_catalog.bool_and(
            not has_table_privilege('authenticated', table_name, 'SELECT, INSERT, UPDATE, DELETE')
        )
        from unnest(array[
            'public.enrichment_sources',
            'public.enrichment_source_policies',
            'public.enrichment_places',
            'public.enrichment_knowledge_versions',
            'public.enrichment_profiles',
            'public.enrichment_place_profiles',
            'public.enrichment_vintage_profiles',
            'public.enrichment_producer_era_profiles',
            'public.enrichment_cuvee_profiles',
            'public.enrichment_evidence',
            'public.enrichment_profile_evidence'
        ]) as tables(table_name)
    ),
    'Authenticated browsers cannot read or mutate the shared knowledge library'
);

select ok(
    (
        select pg_catalog.bool_and(
            not has_table_privilege('powersync_role', table_name, 'SELECT')
        )
        from unnest(array[
            'public.enrichment_sources',
            'public.enrichment_source_policies',
            'public.enrichment_places',
            'public.enrichment_knowledge_versions',
            'public.enrichment_profiles',
            'public.enrichment_place_profiles',
            'public.enrichment_vintage_profiles',
            'public.enrichment_producer_era_profiles',
            'public.enrichment_cuvee_profiles',
            'public.enrichment_evidence',
            'public.enrichment_profile_evidence',
            'public.household_wine_observations',
            'public.wine_enrichment_projections'
        ]) as tables(table_name)
    ),
    'PowerSync cannot publish shared knowledge or unlicensed projection data'
);

select ok(
    (
        select pg_catalog.bool_and(
            has_table_privilege('service_role', table_name, 'SELECT, INSERT, UPDATE, DELETE')
        )
        from unnest(array[
            'public.enrichment_sources',
            'public.enrichment_source_policies',
            'public.enrichment_places',
            'public.enrichment_knowledge_versions',
            'public.enrichment_profiles',
            'public.enrichment_place_profiles',
            'public.enrichment_vintage_profiles',
            'public.enrichment_producer_era_profiles',
            'public.enrichment_cuvee_profiles',
            'public.enrichment_evidence',
            'public.enrichment_profile_evidence',
            'public.household_wine_observations',
            'public.wine_enrichment_projections',
            'public.wine_enrichment_projection_profiles',
            'public.wine_enrichment_projection_evidence',
            'public.wine_enrichment_projection_observations'
        ]) as tables(table_name)
    ),
    'Trusted services can maintain knowledge, evidence, observations, and projections'
);

select ok(
    has_table_privilege('authenticated', 'public.household_wine_observations', 'SELECT')
    and not has_table_privilege('authenticated', 'public.household_wine_observations', 'INSERT, UPDATE, DELETE')
    and has_table_privilege('authenticated', 'public.wine_enrichment_projections', 'SELECT')
    and not has_table_privilege('authenticated', 'public.wine_enrichment_projections', 'INSERT, UPDATE, DELETE'),
    'Household enrichment output is online-readable but not directly browser-writable'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_publication_tables
        where pubname = 'powersync'
          and schemaname = 'public'
          and (
              tablename like 'enrichment_%'
              or tablename like 'wine_enrichment_%'
              or tablename = 'household_wine_observations'
          )
    ),
    0::bigint,
    'The migration adds no enrichment table to the PowerSync publication'
);

select is(
    (
        (select count(*) from public.enrichment_knowledge_versions)
        + (select count(*) from public.household_wine_observations)
        + (select count(*) from public.wine_enrichment_projections)
    ),
    0::bigint,
    'The schema migration does not invent knowledge, observations, or projections'
);

select is(
    (select sum(quantity) from public.holdings),
    7::bigint,
    'The additive migration preserves every existing bottle'
);

insert into public.enrichment_sources (
    id,
    source_key,
    source_name,
    source_kind,
    homepage_url
)
values
    (
        '00000000-0000-4000-8000-000000000700',
        'blocked-provider',
        'Blocked provider',
        'provider',
        'https://blocked.example.test/'
    ),
    (
        '00000000-0000-4000-8000-000000000710',
        'open-regulator',
        'Open regulator',
        'regulatory',
        'https://regulator.example.test/'
    );

insert into public.enrichment_source_policies (
    id,
    source_id,
    policy_version,
    status,
    effective_from,
    terms_checked_on,
    evidence_url,
    display_right,
    normalized_storage_right,
    raw_payload_storage_right,
    offline_sync_right,
    retention_right,
    cross_household_reuse_right
)
values
    (
        '00000000-0000-4000-8000-000000000701',
        '00000000-0000-4000-8000-000000000700',
        1,
        'reviewed',
        '2026-08-21',
        '2026-08-21',
        'https://blocked.example.test/terms',
        'prohibited',
        'prohibited',
        'prohibited',
        'prohibited',
        'prohibited',
        'prohibited'
    ),
    (
        '00000000-0000-4000-8000-000000000711',
        '00000000-0000-4000-8000-000000000710',
        1,
        'reviewed',
        '2026-08-21',
        '2026-08-21',
        'https://regulator.example.test/licence',
        'allowed',
        'allowed',
        'prohibited',
        'allowed',
        'allowed',
        'allowed'
    );

select throws_ok(
    $test$
        insert into public.enrichment_evidence (
            source_id,
            source_policy_id,
            source_record_url,
            content_mode,
            claim_type,
            scope_level,
            claim_value
        )
        values (
            '00000000-0000-4000-8000-000000000700',
            '00000000-0000-4000-8000-000000000701',
            'https://blocked.example.test/wine/1',
            'normalized-claim',
            'methodology',
            'methodology',
            '{"window":"2028-2032"}'::jsonb
        )
    $test$,
    '23514',
    'A reviewed source policy must permit normalized claim storage',
    'A provider prohibition blocks normalized content before it reaches the library'
);

insert into public.enrichment_evidence (
    id,
    source_id,
    source_policy_id,
    source_record_url,
    content_mode,
    claim_type,
    scope_level
)
values (
    '00000000-0000-4000-8000-000000000760',
    '00000000-0000-4000-8000-000000000700',
    '00000000-0000-4000-8000-000000000701',
    'https://blocked.example.test/wine/1',
    'pointer-only',
    'methodology',
    'methodology'
);

select is(
    (select content_mode from public.enrichment_evidence where id = '00000000-0000-4000-8000-000000000760'),
    'pointer-only',
    'A prohibited source can retain a citation without copying its content'
);

insert into public.enrichment_places (
    id,
    parent_id,
    place_type,
    canonical_name,
    country_code
)
values
    (
        '00000000-0000-4000-8000-000000000720',
        null,
        'country',
        'France',
        'FR'
    ),
    (
        '00000000-0000-4000-8000-000000000721',
        '00000000-0000-4000-8000-000000000720',
        'appellation',
        'Volnay Premier Cru',
        'FR'
    );

select is(
    (select normalized_name from public.enrichment_places where id = '00000000-0000-4000-8000-000000000721'),
    'volnay premier cru',
    'Place lookup names are normalized without losing canonical display text'
);

select throws_ok(
    $test$
        update public.enrichment_places
        set parent_id = '00000000-0000-4000-8000-000000000721'
        where id = '00000000-0000-4000-8000-000000000720'
    $test$,
    '23514',
    'Enrichment place hierarchy would create a cycle',
    'A geographic hierarchy cannot contain a cycle'
);

insert into public.wine_reference_entities (id, entity_type)
values
    ('00000000-0000-4000-8000-000000000740', 'producer'),
    ('00000000-0000-4000-8000-000000000741', 'product');

insert into public.wine_reference_producers (id, canonical_name)
values ('00000000-0000-4000-8000-000000000740', 'Domaine Profile');

insert into public.wine_reference_products (id, producer_id, canonical_name)
values (
    '00000000-0000-4000-8000-000000000741',
    '00000000-0000-4000-8000-000000000740',
    'Les Testes'
);

insert into public.enrichment_knowledge_versions (
    id,
    version_number,
    label,
    model_key,
    model_version
)
values (
    '00000000-0000-4000-8000-000000000730',
    1,
    'Acceptance knowledge',
    'curated-inference',
    '1.0.0'
);

insert into public.enrichment_profiles (
    id,
    knowledge_version_id,
    profile_type,
    review_status,
    confidence,
    rationale,
    reviewed_at
)
values
    ('00000000-0000-4000-8000-000000000750', '00000000-0000-4000-8000-000000000730', 'place', 'reviewed', 0.8, 'Place baseline', '2026-08-21T12:00:00Z'),
    ('00000000-0000-4000-8000-000000000751', '00000000-0000-4000-8000-000000000730', 'vintage', 'reviewed', 0.7, 'Vintage conditions', '2026-08-21T12:00:00Z'),
    ('00000000-0000-4000-8000-000000000752', '00000000-0000-4000-8000-000000000730', 'producer-era', 'reviewed', 0.75, 'Producer era', '2026-08-21T12:00:00Z'),
    ('00000000-0000-4000-8000-000000000753', '00000000-0000-4000-8000-000000000730', 'cuvee', 'reviewed', 0.85, 'Cuvee site', '2026-08-21T12:00:00Z');

insert into public.enrichment_place_profiles (
    profile_id,
    knowledge_version_id,
    place_id,
    wine_color,
    first_trial_age,
    best_start_age,
    best_end_age,
    outer_horizon_age,
    body,
    acidity,
    tannin,
    sweetness,
    alcohol,
    freshness,
    savory
)
values (
    '00000000-0000-4000-8000-000000000750',
    '00000000-0000-4000-8000-000000000730',
    '00000000-0000-4000-8000-000000000721',
    'red',
    6,
    9,
    16,
    24,
    3.5,
    4,
    3.5,
    0,
    3,
    4,
    3
);

insert into public.enrichment_vintage_profiles (
    profile_id,
    knowledge_version_id,
    place_id,
    vintage_year,
    wine_color,
    best_start_age_adjustment,
    outer_horizon_age_adjustment
)
values (
    '00000000-0000-4000-8000-000000000751',
    '00000000-0000-4000-8000-000000000730',
    '00000000-0000-4000-8000-000000000721',
    2020,
    'red',
    2,
    3
);

insert into public.enrichment_producer_era_profiles (
    profile_id,
    knowledge_version_id,
    producer_id,
    first_vintage_year,
    final_vintage_year,
    wine_color,
    acidity_adjustment
)
values (
    '00000000-0000-4000-8000-000000000752',
    '00000000-0000-4000-8000-000000000730',
    '00000000-0000-4000-8000-000000000740',
    2000,
    2030,
    'red',
    0.25
);

insert into public.enrichment_cuvee_profiles (
    profile_id,
    knowledge_version_id,
    product_id,
    place_id,
    wine_color,
    outer_horizon_age_adjustment
)
values (
    '00000000-0000-4000-8000-000000000753',
    '00000000-0000-4000-8000-000000000730',
    '00000000-0000-4000-8000-000000000741',
    '00000000-0000-4000-8000-000000000721',
    'red',
    2
);

set constraints wine_reference_entities_shape immediate;
set constraints enrichment_profiles_shape immediate;

select is(
    (select count(*) from public.enrichment_profiles),
    4::bigint,
    'Place, vintage, producer-era, and cuvee layers coexist in one version'
);

set constraints enrichment_profiles_shape deferred;

select throws_ok(
    $test$
        insert into public.enrichment_profiles (
            id,
            knowledge_version_id,
            profile_type,
            confidence,
            rationale
        )
        values (
            '00000000-0000-4000-8000-000000000754',
            '00000000-0000-4000-8000-000000000730',
            'place',
            0.5,
            'Missing typed row'
        );
        set constraints enrichment_profiles_shape immediate;
    $test$,
    '23514',
    'Enrichment profile requires exactly one matching typed row',
    'A profile root cannot commit without exactly one typed row'
);

select throws_ok(
    $test$
        insert into public.enrichment_profiles (
            id,
            knowledge_version_id,
            profile_type,
            confidence,
            rationale
        )
        values (
            '00000000-0000-4000-8000-000000000755',
            '00000000-0000-4000-8000-000000000730',
            'place',
            0.5,
            'Invalid ages'
        );
        insert into public.enrichment_place_profiles (
            profile_id,
            knowledge_version_id,
            place_id,
            wine_color,
            first_trial_age,
            best_start_age,
            best_end_age,
            outer_horizon_age,
            body,
            acidity,
            tannin,
            sweetness,
            alcohol,
            freshness,
            savory
        )
        values (
            '00000000-0000-4000-8000-000000000755',
            '00000000-0000-4000-8000-000000000730',
            '00000000-0000-4000-8000-000000000721',
            'white',
            12,
            8,
            10,
            20,
            3,
            3,
            0,
            0,
            3,
            3,
            2
        )
    $test$,
    '23514',
    'new row for relation "enrichment_place_profiles" violates check constraint "enrichment_place_profiles_ages_check"',
    'Maturity horizons must remain monotonic'
);

select throws_ok(
    $test$
        insert into public.enrichment_evidence (
            source_id,
            source_policy_id,
            source_record_url,
            content_mode,
            claim_type,
            scope_level,
            place_id,
            product_id,
            claim_value
        )
        values (
            '00000000-0000-4000-8000-000000000710',
            '00000000-0000-4000-8000-000000000711',
            'https://regulator.example.test/volnay',
            'normalized-claim',
            'legal-definition',
            'place',
            '00000000-0000-4000-8000-000000000721',
            '00000000-0000-4000-8000-000000000741',
            '{"colors":["red"]}'::jsonb
        )
    $test$,
    '23514',
    'new row for relation "enrichment_evidence" violates check constraint "enrichment_evidence_scope_check"',
    'Evidence cannot pretend to have two incompatible scopes'
);

insert into public.enrichment_evidence (
    id,
    source_id,
    source_policy_id,
    source_record_url,
    content_mode,
    claim_type,
    scope_level,
    place_id,
    claim_value,
    review_status,
    reviewed_at
)
values (
    '00000000-0000-4000-8000-000000000761',
    '00000000-0000-4000-8000-000000000710',
    '00000000-0000-4000-8000-000000000711',
    'https://regulator.example.test/volnay',
    'normalized-claim',
    'legal-definition',
    'place',
    '00000000-0000-4000-8000-000000000721',
    '{"colors":["red"]}'::jsonb,
    'reviewed',
    '2026-08-21T12:00:00Z'
);

select is(
    (select claim_value -> 'colors' ->> 0 from public.enrichment_evidence where id = '00000000-0000-4000-8000-000000000761'),
    'red',
    'A reviewed open policy permits a normalized factual claim'
);

insert into public.enrichment_profile_evidence (
    profile_id,
    evidence_id,
    evidence_role
)
values (
    '00000000-0000-4000-8000-000000000750',
    '00000000-0000-4000-8000-000000000761',
    'supports'
);

select is(
    (select count(*) from public.enrichment_profile_evidence),
    1::bigint,
    'Profile rationale points to its reviewed evidence instead of copying provenance into JSON'
);

update public.enrichment_knowledge_versions
set
    status = 'active',
    content_sha256 = repeat('a', 64),
    published_at = '2026-08-21T12:00:00Z'
where id = '00000000-0000-4000-8000-000000000730';

select throws_ok(
    $test$
        update public.enrichment_place_profiles
        set outer_horizon_age = 25
        where profile_id = '00000000-0000-4000-8000-000000000750'
    $test$,
    '23514',
    'Published enrichment profiles are immutable',
    'Published profile content cannot drift away from its recorded hash'
);

select throws_ok(
    $test$
        insert into public.household_wine_observations (
            household_id,
            wine_id,
            recorded_by,
            observation_type,
            observed_on,
            maturity_assessment
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000002',
            'maturity',
            '2026-08-21',
            'ready'
        )
    $test$,
    '23503',
    'insert or update on table "household_wine_observations" violates foreign key constraint "household_wine_observations_member_fk"',
    'An observation cannot be attributed to a user outside the household'
);

insert into public.household_wine_observations (
    id,
    household_id,
    wine_id,
    recorded_by,
    visibility,
    observation_type,
    observed_on,
    maturity_assessment,
    freshness_rating,
    note
)
values (
    '00000000-0000-4000-8000-000000000770',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000001',
    'personal',
    'tasting',
    '2026-08-21',
    'too-young',
    5,
    'Reassess later'
);

select is(
    (select maturity_assessment from public.household_wine_observations where id = '00000000-0000-4000-8000-000000000770'),
    'too-young',
    'Structured owner feedback is retained without changing the shared profile'
);

insert into public.enrichment_knowledge_versions (
    id,
    version_number,
    label,
    model_key,
    model_version
)
values (
    '00000000-0000-4000-8000-000000000731',
    2,
    'Draft knowledge',
    'curated-inference',
    '1.1.0'
);

select throws_ok(
    $test$
        insert into public.wine_enrichment_projections (
            household_id,
            wine_id,
            knowledge_version_id,
            projection_type,
            method,
            specificity,
            confidence,
            input_fingerprint,
            recommendation
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000731',
            'maturity',
            'curated-inference',
            'comparable-profile',
            0.5,
            repeat('b', 64),
            '{"state":"hold"}'::jsonb
        )
    $test$,
    '23514',
    'A current projection requires an active knowledge version',
    'Draft knowledge cannot produce current household advice'
);

insert into public.wine_enrichment_projections (
    id,
    household_id,
    wine_id,
    knowledge_version_id,
    projection_type,
    method,
    specificity,
    confidence,
    input_fingerprint,
    recommendation
)
values (
    '00000000-0000-4000-8000-000000000780',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000730',
    'maturity',
    'curated-inference',
    'comparable-profile',
    0.74,
    repeat('b', 64),
    '{"state":"hold","firstTrial":{"from":2028,"to":2030}}'::jsonb
);

insert into public.wine_enrichment_projection_profiles (
    projection_id,
    knowledge_version_id,
    profile_id,
    contribution_order
)
values (
    '00000000-0000-4000-8000-000000000780',
    '00000000-0000-4000-8000-000000000730',
    '00000000-0000-4000-8000-000000000750',
    1
);

insert into public.wine_enrichment_projection_evidence (projection_id, evidence_id)
values (
    '00000000-0000-4000-8000-000000000780',
    '00000000-0000-4000-8000-000000000761'
);

insert into public.wine_enrichment_projection_observations (
    projection_id,
    household_id,
    observation_id
)
values (
    '00000000-0000-4000-8000-000000000780',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000770'
);

select is(
    (
        (select count(*) from public.wine_enrichment_projection_profiles)
        + (select count(*) from public.wine_enrichment_projection_evidence)
        + (select count(*) from public.wine_enrichment_projection_observations)
    ),
    3::bigint,
    'A projection explains its knowledge, evidence, and private observation inputs'
);

select throws_ok(
    $test$
        insert into public.wine_enrichment_projections (
            household_id,
            wine_id,
            knowledge_version_id,
            projection_type,
            method,
            specificity,
            confidence,
            input_fingerprint,
            recommendation
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000730',
            'maturity',
            'curated-inference',
            'comparable-profile',
            0.75,
            repeat('c', 64),
            '{"state":"ready"}'::jsonb
        )
    $test$,
    '23505',
    'duplicate key value violates unique constraint "wine_enrichment_projections_one_current_idx"',
    'Only one current projection exists for one wine and context'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    (
        (select count(*) from public.household_wine_observations)
        + (select count(*) from public.wine_enrichment_projections)
    ),
    2::bigint,
    'The owner can read personal observations and current projections online'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select is(
    (
        (select count(*) from public.household_wine_observations)
        + (select count(*) from public.wine_enrichment_projections)
    ),
    0::bigint,
    'An unrelated household cannot read observations or projections'
);

select ok(
    not has_table_privilege('authenticated', 'public.household_wine_observations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.wine_enrichment_projections', 'INSERT'),
    'Browser clients cannot bypass future reviewed mutation workflows'
);

select * from finish();

rollback;
