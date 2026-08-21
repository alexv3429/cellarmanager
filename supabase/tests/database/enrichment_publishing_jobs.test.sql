begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

select has_table('public', 'enrichment_demands', 'Synchronized wines have durable enrichment demands');
select has_table('public', 'enrichment_jobs', 'Enrichment work has leaseable jobs');
select has_table('public', 'enrichment_provider_cache_entries', 'Provider result metadata has a rights-aware cache');
select has_table('public', 'enrichment_provider_rate_limits', 'Provider rate-limit windows are durable');

select ok(
    to_regprocedure('public.publish_enrichment_knowledge_version(uuid)') is not null,
    'Reviewed knowledge has one atomic publication function'
);

select ok(
    to_regprocedure('public.claim_enrichment_jobs(text,integer,integer)') is not null,
    'Workers claim bounded jobs through a lease function'
);

select ok(
    to_regprocedure('public.complete_enrichment_job(uuid,uuid,text,text,timestamp with time zone)') is not null,
    'Workers complete jobs through a token-checked function'
);

select ok(
    (
        select pg_catalog.bool_and(relrowsecurity)
        from pg_catalog.pg_class
        where oid in (
            'public.enrichment_demands'::regclass,
            'public.enrichment_jobs'::regclass,
            'public.enrichment_provider_cache_entries'::regclass,
            'public.enrichment_provider_rate_limits'::regclass
        )
    ),
    'Every publishing and job table has RLS enabled'
);

select ok(
    (
        select pg_catalog.bool_and(
            not has_table_privilege('authenticated', table_name, 'SELECT, INSERT, UPDATE, DELETE')
        )
        from unnest(array[
            'public.enrichment_demands',
            'public.enrichment_jobs',
            'public.enrichment_provider_cache_entries',
            'public.enrichment_provider_rate_limits'
        ]) as tables(table_name)
    ),
    'Browser roles cannot inspect or mutate the service queue'
);

select ok(
    (
        select pg_catalog.bool_and(
            has_table_privilege('service_role', table_name, 'SELECT, INSERT, UPDATE, DELETE')
        )
        from unnest(array[
            'public.enrichment_demands',
            'public.enrichment_jobs',
            'public.enrichment_provider_cache_entries',
            'public.enrichment_provider_rate_limits'
        ]) as tables(table_name)
    ),
    'Trusted services can maintain demands, jobs, caches, and rate limits'
);

select ok(
    not has_function_privilege('authenticated', 'public.publish_enrichment_knowledge_version(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_enrichment_jobs(text,integer,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.complete_enrichment_job(uuid,uuid,text,text,timestamp with time zone)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.publish_enrichment_knowledge_version(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.claim_enrichment_jobs(text,integer,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.complete_enrichment_job(uuid,uuid,text,text,timestamp with time zone)', 'EXECUTE'),
    'Publishing and worker functions are service-only'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_publication_tables
        where pubname = 'powersync'
          and schemaname = 'public'
          and tablename in (
              'enrichment_demands',
              'enrichment_jobs',
              'enrichment_provider_cache_entries',
              'enrichment_provider_rate_limits'
          )
    ),
    0::bigint,
    'Service queue and provider metadata are excluded from PowerSync'
);

select is(
    (select count(*) from public.enrichment_demands),
    4::bigint,
    'The two seeded wines each receive maturity and pairing-profile demands'
);

select ok(
    not exists (
        select 1
        from public.wines wine
        where (
            select count(*)
            from public.enrichment_demands demand
            where demand.wine_id = wine.id
              and demand.household_id = wine.household_id
        ) <> 2
    ),
    'Demand creation is complete and household-scoped'
);

select ok(
    (
        select bool_and(
            demand.input_fingerprint ~ '^[0-9a-f]{64}$'
            and demand.demand_status = 'queued'
        )
        from public.enrichment_demands demand
    ),
    'Initial demands are queued with canonical SHA-256 input fingerprints'
);

select is(
    public.enqueue_enrichment_jobs(100) ->> 'reason',
    'no-active-knowledge-version',
    'No job is created before reviewed knowledge is active'
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
        '00000000-0000-4000-8000-000000000800',
        'publishing-source',
        'Publishing source',
        'regulatory',
        'https://publishing.example.test/'
    ),
    (
        '00000000-0000-4000-8000-000000000801',
        'no-cache-provider',
        'No-cache provider',
        'provider',
        'https://nocache.example.test/'
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
        '00000000-0000-4000-8000-000000000810',
        '00000000-0000-4000-8000-000000000800',
        1,
        'reviewed',
        '2026-08-21',
        '2026-08-21',
        'https://publishing.example.test/licence',
        'allowed',
        'allowed',
        'prohibited',
        'allowed',
        'allowed',
        'allowed'
    ),
    (
        '00000000-0000-4000-8000-000000000811',
        '00000000-0000-4000-8000-000000000801',
        1,
        'reviewed',
        '2026-08-21',
        '2026-08-21',
        'https://nocache.example.test/terms',
        'prohibited',
        'prohibited',
        'prohibited',
        'prohibited',
        'prohibited',
        'prohibited'
    );

insert into public.enrichment_places (
    id,
    place_type,
    canonical_name,
    country_code
)
values (
    '00000000-0000-4000-8000-000000000820',
    'appellation',
    'Publishing Appellation',
    'FR'
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
    '00000000-0000-4000-8000-000000000830',
    '00000000-0000-4000-8000-000000000800',
    '00000000-0000-4000-8000-000000000810',
    'https://publishing.example.test/appellation',
    'normalized-claim',
    'legal-definition',
    'place',
    '00000000-0000-4000-8000-000000000820',
    '{"colors":["red"]}'::jsonb,
    'reviewed',
    '2026-08-21T12:00:00Z'
);

insert into public.enrichment_knowledge_versions (
    id,
    version_number,
    label,
    model_key,
    model_version
)
values (
    '00000000-0000-4000-8000-000000000840',
    1,
    'Publishing test v1',
    'curated-inference',
    '1.0.0'
);

insert into public.enrichment_profiles (
    id,
    knowledge_version_id,
    profile_type,
    confidence,
    rationale
)
values (
    '00000000-0000-4000-8000-000000000850',
    '00000000-0000-4000-8000-000000000840',
    'place',
    0.8,
    'Reviewed baseline once approved'
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
    '00000000-0000-4000-8000-000000000850',
    '00000000-0000-4000-8000-000000000840',
    '00000000-0000-4000-8000-000000000820',
    'red',
    5,
    8,
    14,
    22,
    3,
    4,
    3,
    0,
    3,
    4,
    3
);

insert into public.enrichment_profile_evidence (
    profile_id,
    evidence_id,
    evidence_role
)
values (
    '00000000-0000-4000-8000-000000000850',
    '00000000-0000-4000-8000-000000000830',
    'supports'
);

select throws_ok(
    $test$
        select public.publish_enrichment_knowledge_version(
            '00000000-0000-4000-8000-000000000840'
        )
    $test$,
    '23514',
    'Every enrichment profile must be reviewed before publication',
    'A draft profile blocks publication'
);

update public.enrichment_profiles
set
    review_status = 'reviewed',
    reviewed_at = '2026-08-21T12:30:00Z'
where id = '00000000-0000-4000-8000-000000000850';

select ok(
    (
        select
            result ->> 'status' = 'active'
            and result ->> 'profile_count' = '1'
            and result ->> 'content_sha256' ~ '^[0-9a-f]{64}$'
        from (
            select public.publish_enrichment_knowledge_version(
                '00000000-0000-4000-8000-000000000840'
            ) as result
        ) published
    ),
    'Publication validates, hashes, and activates reviewed knowledge atomically'
);

select ok(
    (
        select
            status = 'active'
            and content_sha256 ~ '^[0-9a-f]{64}$'
            and published_at is not null
        from public.enrichment_knowledge_versions
        where id = '00000000-0000-4000-8000-000000000840'
    ),
    'The active row retains its exact content hash and publication time'
);

select throws_ok(
    $test$
        update public.enrichment_evidence
        set claim_value = '{"colors":["white"]}'::jsonb
        where id = '00000000-0000-4000-8000-000000000830'
    $test$,
    '23514',
    'Reviewed enrichment evidence is immutable',
    'Published evidence cannot drift after hashing'
);

select ok(
    (
        select bool_and(
            demand_status = 'queued'
            and attempt_count = 0
            and last_error_code is null
        )
        from public.enrichment_demands
    ),
    'Publishing requeues all household demands against the new version'
);

select is(
    (public.enqueue_enrichment_jobs(100) ->> 'enqueued')::integer,
    4,
    'One idempotent job is created for every current demand'
);

select is(
    (public.enqueue_enrichment_jobs(100) ->> 'enqueued')::integer,
    0,
    'Repeating enqueue creates no duplicate jobs'
);

create temporary table claimed_jobs on commit drop as
select *
from public.claim_enrichment_jobs('worker-a', 2, 120);

select is(
    (select count(*) from claimed_jobs),
    2::bigint,
    'A worker claims only its requested bounded batch'
);

select ok(
    (
        select
            count(distinct lease_token) = 2
            and bool_and(attempt_count = 1)
            and bool_and(lease_expires_at > now())
        from claimed_jobs
    ),
    'Each claimed job has a unique live token and incremented attempt'
);

select throws_ok(
    $test$
        select public.complete_enrichment_job(
            (select job_id from claimed_jobs order by job_id limit 1),
            gen_random_uuid(),
            'complete'
        )
    $test$,
    '40001',
    'Enrichment job lease is missing, expired, or owned by another worker',
    'Another worker cannot complete a claimed job'
);

select is(
    (
        select public.complete_enrichment_job(
            job_id,
            lease_token,
            'retry',
            'temporary-provider-error',
            now() + interval '5 minutes'
        ) ->> 'job_status'
        from claimed_jobs
        order by job_id
        limit 1
    ),
    'retrying',
    'A transient failure schedules a bounded future retry'
);

select is(
    (
        select public.complete_enrichment_job(
            job_id,
            lease_token,
            'complete'
        ) ->> 'demand_status'
        from claimed_jobs
        order by job_id desc
        limit 1
    ),
    'complete',
    'A successful lease completion advances the durable demand'
);

update public.enrichment_jobs
set next_attempt_at = now() - interval '1 second'
where job_status = 'retrying';

update public.enrichment_demands
set next_attempt_at = now() - interval '1 second'
where demand_status = 'retrying';

create temporary table claimed_retry on commit drop as
select *
from public.claim_enrichment_jobs('worker-b', 1, 120);

select is(
    (select attempt_count from claimed_retry),
    2,
    'A due retry is reclaimed as the next attempt on the same job'
);

select is(
    (
        select public.complete_enrichment_job(
            job_id,
            lease_token,
            'complete'
        ) ->> 'job_status'
        from claimed_retry
    ),
    'succeeded',
    'A retried job can complete normally'
);

create temporary table claimed_stale on commit drop as
select *
from public.claim_enrichment_jobs('worker-c', 1, 120);

update public.wines wine
set producer = wine.producer || ' Changed'
where wine.id = (select wine_id from claimed_stale);

select is(
    (
        select job_status
        from public.enrichment_jobs
        where id = (select job_id from claimed_stale)
    ),
    'cancelled',
    'Changing wine identity cancels in-flight advice computed from stale input'
);

insert into public.enrichment_knowledge_versions (
    id,
    version_number,
    label,
    model_key,
    model_version
)
values (
    '00000000-0000-4000-8000-000000000841',
    2,
    'Publishing test v2',
    'curated-inference',
    '1.1.0'
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
values (
    '00000000-0000-4000-8000-000000000851',
    '00000000-0000-4000-8000-000000000841',
    'place',
    'reviewed',
    0.82,
    'Updated reviewed baseline',
    '2026-08-21T14:00:00Z'
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
    '00000000-0000-4000-8000-000000000851',
    '00000000-0000-4000-8000-000000000841',
    '00000000-0000-4000-8000-000000000820',
    'red',
    6,
    9,
    15,
    23,
    3,
    4,
    3,
    0,
    3,
    4,
    3
);

insert into public.enrichment_profile_evidence (profile_id, evidence_id, evidence_role)
values (
    '00000000-0000-4000-8000-000000000851',
    '00000000-0000-4000-8000-000000000830',
    'supports'
);

select is(
    public.publish_enrichment_knowledge_version(
        '00000000-0000-4000-8000-000000000841'
    ) ->> 'status',
    'active',
    'A reviewed replacement knowledge version publishes successfully'
);

select ok(
    (
        select
            count(*) filter (where status = 'active') = 1
            and count(*) filter (where status = 'superseded') = 1
        from public.enrichment_knowledge_versions
    ),
    'Publishing atomically leaves one active version and preserves its predecessor'
);

select ok(
    not exists (
        select 1
        from public.enrichment_demands
        where demand_status <> 'queued'
    )
    and not exists (
        select 1
        from public.enrichment_jobs
        where knowledge_version_id = '00000000-0000-4000-8000-000000000840'
          and job_status in ('queued', 'leased', 'retrying')
    ),
    'A new publication requeues demands and cancels obsolete active jobs'
);

select throws_ok(
    $test$
        insert into public.enrichment_provider_cache_entries (
            source_id,
            source_policy_id,
            cache_key_sha256,
            result_status,
            expires_at
        )
        values (
            '00000000-0000-4000-8000-000000000801',
            '00000000-0000-4000-8000-000000000811',
            repeat('d', 64),
            'not-found',
            now() + interval '1 day'
        )
    $test$,
    '23514',
    'A reviewed source policy must permit cache retention',
    'Provider metadata is not cached when retention is prohibited'
);

insert into public.enrichment_provider_cache_entries (
    source_id,
    source_policy_id,
    cache_key_sha256,
    result_status,
    expires_at
)
values (
    '00000000-0000-4000-8000-000000000800',
    '00000000-0000-4000-8000-000000000810',
    repeat('e', 64),
    'not-found',
    now() + interval '1 day'
);

select is(
    (select count(*) from public.enrichment_provider_cache_entries),
    1::bigint,
    'An allowed negative result is cached without repeating a provider call'
);

select ok(
    not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name in ('enrichment_jobs', 'enrichment_provider_cache_entries')
          and column_name in ('api_key', 'credential', 'secret', 'raw_payload', 'response_body')
    ),
    'Jobs and caches have no credential or raw-response storage column'
);

select throws_ok(
    $test$
        insert into public.enrichment_provider_rate_limits (
            source_id,
            bucket_key,
            window_started_at,
            window_ends_at,
            request_count,
            request_limit
        )
        values (
            '00000000-0000-4000-8000-000000000800',
            'daily',
            now(),
            now() + interval '1 day',
            11,
            10
        )
    $test$,
    '23514',
    'new row for relation "enrichment_provider_rate_limits" violates check constraint "enrichment_provider_rate_limits_count_check"',
    'A rate-limit bucket cannot over-allocate its provider quota'
);

insert into public.wines (
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    format_ml
)
values (
    '00000000-0000-4000-8000-000000000899',
    '00000000-0000-4000-8000-000000000100',
    'New Synced Domaine',
    'Queue Test',
    2022,
    'red',
    750
);

select is(
    (
        select count(*)
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000899'
    ),
    2::bigint,
    'A newly synchronized wine receives both demands without blocking its save'
);

select * from finish();

rollback;
