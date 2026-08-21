begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

select has_table(
    'public',
    'wine_reference_match_runs',
    'Positive and zero-result searches have a versioned completion record'
);

select has_table(
    'public',
    'wine_reference_match_candidates',
    'Review candidates have a durable evidence table'
);

select has_table(
    'public',
    'wine_reference_match_decisions',
    'Household confirmations and rejections are durable'
);

select has_table(
    'public',
    'wine_reference_household_producer_preferences',
    'Explicit producer shorthand decisions are household scoped'
);

select ok(
    (
        select pg_catalog.bool_and(relrowsecurity)
        from pg_catalog.pg_class
        where oid in (
            'public.wine_reference_match_runs'::regclass,
            'public.wine_reference_match_candidates'::regclass,
            'public.wine_reference_match_decisions'::regclass,
            'public.wine_reference_household_producer_preferences'::regclass
        )
    ),
    'Every matching evidence table has RLS enabled'
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
                'public.wine_reference_match_runs',
                'public.wine_reference_match_candidates',
                'public.wine_reference_match_decisions',
                'public.wine_reference_household_producer_preferences'
            ]
        ) as tables(table_name)
    ),
    'Browser roles cannot bypass the matching review RPCs'
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
                'public.wine_reference_match_runs',
                'public.wine_reference_match_candidates',
                'public.wine_reference_match_decisions',
                'public.wine_reference_household_producer_preferences'
            ]
        ) as tables(table_name)
    ),
    'Trusted services can maintain matching evidence'
);

select ok(
    not exists (
        select 1
        from pg_catalog.pg_publication_tables publication
        where publication.pubname = 'powersync'
          and publication.schemaname = 'public'
          and publication.tablename in (
              'wine_reference_match_runs',
              'wine_reference_match_candidates',
              'wine_reference_match_decisions',
              'wine_reference_household_producer_preferences'
          )
    ),
    'Matching evidence is not published through PowerSync'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_wine_reference_review(uuid,boolean)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.decide_wine_reference_match(uuid,text,text,boolean)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'anon',
        'public.get_wine_reference_review(uuid,boolean)',
        'EXECUTE'
    ),
    'Only authenticated clients can use the review RPCs'
);

select is(
    private.normalize_wine_reference_text(
        '  CLOS-de-la Garènne  '
    ),
    'clos de la garenne',
    'Matching normalization removes accents and punctuation consistently'
);

select ok(
    has_function_privilege(
        'service_role',
        'private.normalize_wine_reference_text(text)',
        'EXECUTE'
    ),
    'The snapshot service can populate generated matching columns'
);

insert into public.wine_reference_lwin_snapshots (
    id,
    source_key,
    content_sha256,
    source_file_name,
    source_retrieved_at,
    source_updated_through,
    expected_record_count,
    record_count,
    live_record_count,
    combined_record_count,
    deleted_record_count,
    import_status,
    rows_retained,
    completed_at
)
values (
    '00000000-0000-4000-8000-000000000800',
    'liv-ex-lwin',
    repeat('8', 64),
    'matching-fixture.xlsx',
    '2026-08-20T20:00:00Z',
    '2026-08-20T19:00:00',
    8,
    8,
    8,
    0,
    0,
    'active',
    true,
    '2026-08-20T20:01:00Z'
);

insert into public.wine_reference_lwin_entries (
    snapshot_id,
    lwin7,
    source_row_number,
    source_status,
    display_name,
    producer_name,
    wine_name,
    country,
    region,
    sub_region,
    site,
    parcel,
    colour,
    product_type,
    designation,
    classification,
    vintage_configuration,
    first_vintage,
    final_vintage
)
values
    (
        '00000000-0000-4000-8000-000000000800',
        '1000001', 2, 'live',
        'Louis Boillot, Volnay Premier Cru, Les Angles',
        'Louis Boillot', 'Volnay', 'France', 'Burgundy',
        'Volnay', 'Les Angles', null, 'Red', 'Wine',
        'AOP', 'Premier Cru', 'sequential', 2000, 2025
    ),
    (
        '00000000-0000-4000-8000-000000000800',
        '1000002', 3, 'live',
        'Lucien Boillot, Volnay Premier Cru, Les Angles',
        'Lucien Boillot', 'Volnay', 'France', 'Burgundy',
        'Volnay', 'Les Angles', null, 'Red', 'Wine',
        'AOP', 'Premier Cru', 'sequential', 2000, 2025
    ),
    (
        '00000000-0000-4000-8000-000000000800',
        '1000003', 4, 'live',
        'Alvina Pernot, Puligny Montrachet Premier Cru, Clos de la Garenne',
        'Alvina Pernot', 'Puligny Montrachet', 'France', 'Burgundy',
        'Puligny Montrachet', 'Clos de la Garenne', null, 'White',
        'Wine', 'AOP', 'Premier Cru', 'sequential', 2018, 2025
    ),
    (
        '00000000-0000-4000-8000-000000000800',
        '1000004', 5, 'live',
        'Paul Pernot, Puligny Montrachet Premier Cru, Clos de la Garenne',
        'Paul Pernot', 'Puligny Montrachet', 'France', 'Burgundy',
        'Puligny Montrachet', 'Clos de la Garenne', null, 'White',
        'Wine', 'AOP', 'Premier Cru', 'sequential', 2000, 2025
    ),
    (
        '00000000-0000-4000-8000-000000000800',
        '1000005', 6, 'live',
        'Unrelated Estate, Bordeaux Rouge',
        'Unrelated Estate', 'Bordeaux Rouge', 'France', 'Bordeaux',
        'Bordeaux', null, null, 'Red', 'Wine', 'AOP', null,
        'sequential', 1990, 2025
    ),
    (
        '00000000-0000-4000-8000-000000000800',
        '1000006', 7, 'live',
        'Louis Boillot, Pommard Premier Cru, Les Rugiens',
        'Louis Boillot', 'Pommard', 'France', 'Burgundy',
        'Pommard', 'Les Rugiens', null, 'Red', 'Wine',
        'AOP', 'Premier Cru', 'sequential', 2000, 2025
    ),
    (
        '00000000-0000-4000-8000-000000000800',
        '1000007', 8, 'live',
        'Lucien Boillot, Pommard Premier Cru, Les Rugiens',
        'Lucien Boillot', 'Pommard', 'France', 'Burgundy',
        'Pommard', 'Les Rugiens', null, 'Red', 'Wine',
        'AOP', 'Premier Cru', 'sequential', 2000, 2025
    ),
    (
        '00000000-0000-4000-8000-000000000800',
        '1000008', 9, 'live',
        'Example Champagne, Brut Reserve',
        'Example Champagne', 'Brut Reserve', 'France', 'Champagne',
        'Champagne', null, null, 'White', 'Wine', 'AOP', null,
        'sequential', 1000, 1000
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
    format_ml
)
values
    (
        '00000000-0000-4000-8000-000000000810',
        '00000000-0000-4000-8000-000000000100',
        'Boillot', 'Les Angles', 2020, 'red',
        'Volnay', 'Burgundy', 750
    ),
    (
        '00000000-0000-4000-8000-000000000811',
        '00000000-0000-4000-8000-000000000100',
        'Boillot', 'Les Rugiens', 2021, 'red',
        'Pommard', 'Burgundy', 750
    ),
    (
        '00000000-0000-4000-8000-000000000812',
        '00000000-0000-4000-8000-000000000100',
        'Example Champagne', 'Brut Reserve', null, 'white',
        'Champagne', 'Champagne', 750
    );

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    pg_catalog.jsonb_array_length(
        public.get_wine_reference_review(
            '00000000-0000-4000-8000-000000000110',
            false
        ) -> 'candidates'
    ),
    0,
    'A search can complete safely without a plausible candidate'
);

reset role;

select is(
    (
        select match_run.candidate_count
        from public.wine_reference_match_runs match_run
        where match_run.wine_id =
            '00000000-0000-4000-8000-000000000110'
    ),
    0,
    'A zero-result run is cached against the active snapshot'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.get_wine_reference_review(
        '00000000-0000-4000-8000-000000000810',
        true
    ) ->> 'status',
    'unmatched',
    'An unlinked wine receives review candidates without being changed'
);

select is(
    pg_catalog.jsonb_array_length(
        public.get_wine_reference_review(
            '00000000-0000-4000-8000-000000000810',
            false
        ) -> 'candidates'
    ),
    2,
    'Ambiguous producer shorthand preserves both plausible alternatives'
);

select ok(
    (
        public.get_wine_reference_review(
            '00000000-0000-4000-8000-000000000810',
            false
        ) #> '{candidates,0,blockers}'
    ) ? 'close_runner_up',
    'A close runner-up blocks treating the leading candidate as unopposed'
);

select is(
    (
        select wine_reference_id
        from public.wines
        where id = '00000000-0000-4000-8000-000000000810'
    ),
    null,
    'Candidate generation never links a household wine automatically'
);

select is(
    pg_catalog.jsonb_array_length(
        public.decide_wine_reference_match(
            '00000000-0000-4000-8000-000000000810',
            '1000002',
            'rejected',
            false
        ) -> 'rejected_candidates'
    ),
    1,
    'Rejecting a candidate moves it out of active suggestions'
);

select is(
    pg_catalog.jsonb_array_length(
        public.get_wine_reference_review(
            '00000000-0000-4000-8000-000000000810',
            true
        ) -> 'rejected_candidates'
    ),
    1,
    'Refreshing candidates remembers an earlier rejection'
);

select is(
    public.decide_wine_reference_match(
        '00000000-0000-4000-8000-000000000810',
        '1000001',
        'confirmed',
        true
    ) ->> 'status',
    'matched',
    'An explicit owner confirmation links the reviewed candidate'
);

-- Force the deferred hierarchy checks to execute before restoring the test's
-- privileged role. This reproduces PostgREST's transaction boundary and
-- protects against permission failures that an end-of-test commit would hide.
set constraints all immediate;
set constraints all deferred;

reset role;

select ok(
    (
        select
            wine_reference_id is not null
            and wine_reference_type = 'package'
        from public.wines
        where id = '00000000-0000-4000-8000-000000000810'
    ),
    'A vintage bottle links to the promoted package identity'
);

select is(
    (
        select count(*)
        from public.wine_reference_external_identifiers identifier
        where identifier.authority = 'liv-ex'
          and identifier.identifier_scheme = 'LWIN7'
          and identifier.identifier_value = '1000001'
    ),
    1::bigint,
    'The confirmed LWIN7 is attached as an external product identifier'
);

select is(
    (
        select count(*)
        from public.wine_reference_identifier_demands demand
        where demand.authority = 'liv-ex'
          and demand.identifier_scheme in ('LWIN11', 'LWIN16')
    ),
    2::bigint,
    'Release and package identities retain durable demands for longer LWINs'
);

select is(
    (
        select producer.canonical_name
        from public.wine_reference_household_producer_preferences preference
        join public.wine_reference_producers producer
          on producer.id = preference.producer_id
        where preference.household_id =
            '00000000-0000-4000-8000-000000000100'
          and preference.source_producer_normalized = 'boillot'
    ),
    'Louis Boillot',
    'Remembering a producer choice stores household-only shorthand evidence'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select ok(
    (
        public.get_wine_reference_review(
            '00000000-0000-4000-8000-000000000811',
            true
        ) #> '{candidates,0,evidence}'
    ) @> '{"producer_preferred": true}'::jsonb,
    'A confirmed household producer preference improves later candidates'
);

select ok(
    (
        public.get_wine_reference_review(
            '00000000-0000-4000-8000-000000000811',
            false
        ) #> '{candidates,1,blockers}'
    ) ? 'producer_preference_conflict',
    'An equally specific alternative stays visible despite the remembered producer'
);

do $test$
begin
    perform public.get_wine_reference_review(
        '00000000-0000-4000-8000-000000000812',
        true
    );
end;
$test$;

select is(
    public.decide_wine_reference_match(
        '00000000-0000-4000-8000-000000000812',
        '1000008',
        'confirmed',
        false
    ) #>> '{matched_reference,reference_type}',
    'product',
    'A generic NV wine links at product level without inventing a release'
);

reset role;

update public.wines
set appellation = 'Changed after review'
where id = '00000000-0000-4000-8000-000000000810';

select is(
    (
        select wine_reference_id
        from public.wines
        where id = '00000000-0000-4000-8000-000000000810'
    ),
    null,
    'Changing matching evidence invalidates a stale shared link'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000002';

select throws_ok(
    $test$
        select public.get_wine_reference_review(
            '00000000-0000-4000-8000-000000000810',
            false
        )
    $test$,
    '42501',
    'Wine does not belong to this household',
    'A member of another household cannot inspect matching evidence'
);

reset role;

insert into auth.users (
    id,
    email,
    raw_user_meta_data
)
values (
    '00000000-0000-4000-8000-000000000003',
    'member-a@example.test',
    '{}'::jsonb
);

insert into public.household_members (
    household_id,
    user_id,
    role
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000003',
    'member'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select throws_ok(
    $test$
        select public.decide_wine_reference_match(
            '00000000-0000-4000-8000-000000000811',
            '1000006',
            'confirmed',
            false
        )
    $test$,
    '42501',
    'Only household owners can review wine matches',
    'A household member may view but cannot decide an owner-level match'
);

reset role;

select is(
    (
        select count(*)
        from public.wine_reference_match_decisions decision
        where decision.household_id =
            '00000000-0000-4000-8000-000000000100'
          and decision.decision = 'rejected'
    ),
    1::bigint,
    'Rejection memory remains scoped to the reviewed household'
);

select is(
    (
        select count(*)
        from public.wine_reference_products product
        join public.wine_reference_external_identifiers identifier
          on identifier.entity_id = product.id
         and identifier.identifier_scheme = 'LWIN7'
        where identifier.identifier_value in ('1000001', '1000008')
    ),
    2::bigint,
    'Only confirmed source rows are promoted into shared products'
);

select * from finish();

rollback;
