begin;

create extension if not exists pgtap with schema extensions;

select plan(66);

select has_column(
    'public',
    'locations',
    'storage_purpose',
    'Locations have an explicit physical storage role'
);

select results_eq(
    $test$
        select distinct storage_purpose
        from public.locations
        order by storage_purpose
    $test$,
    $expected$
        values ('mixed'::text)
    $expected$,
    'Existing locations migrate safely to mixed storage'
);

select has_table(
    'public',
    'enrichment_place_aliases',
    'Reviewed place aliases are normalized centrally'
);

select has_table(
    'public',
    'wine_enrichment_projection_feedback',
    'Projection reviews are durable'
);

select has_table(
    'public',
    'wine_maturity_overrides',
    'Owner-adjusted windows are stored separately from model output'
);

select ok(
    to_regprocedure('public.install_initial_maturity_knowledge()') is not null
    and to_regprocedure('public.install_expanded_maturity_knowledge()') is not null
    and to_regprocedure('public.process_maturity_enrichment_jobs(text,integer)') is not null,
    'Knowledge installation and bounded maturity processing have explicit service APIs'
);

select ok(
    to_regprocedure('public.get_household_maturity_overview(uuid)') is not null
    and to_regprocedure('public.get_wine_maturity(uuid)') is not null,
    'Household users have narrow maturity read APIs'
);

select ok(
    not has_function_privilege('authenticated', 'public.install_initial_maturity_knowledge()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.install_expanded_maturity_knowledge()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.process_maturity_enrichment_jobs(text,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.install_initial_maturity_knowledge()', 'EXECUTE')
    and has_function_privilege('service_role', 'public.install_expanded_maturity_knowledge()', 'EXECUTE')
    and has_function_privilege('service_role', 'public.process_maturity_enrichment_jobs(text,integer)', 'EXECUTE'),
    'Knowledge publishing and calculation remain service-only'
);

select ok(
    has_function_privilege('authenticated', 'public.get_household_maturity_overview(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_wine_maturity(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.review_wine_maturity_projection(uuid,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_wine_maturity_override(uuid,integer,integer,integer,integer,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.clear_wine_maturity_override(uuid)', 'EXECUTE'),
    'Authenticated users can use only the reviewed household maturity APIs'
);

select ok(
    not has_table_privilege('authenticated', 'public.enrichment_place_aliases', 'SELECT, INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.wine_enrichment_projection_feedback', 'INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.wine_maturity_overrides', 'INSERT, UPDATE, DELETE'),
    'Browser roles cannot mutate shared knowledge, feedback, or overrides directly'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_publication_tables
        where pubname = 'powersync'
          and schemaname = 'public'
          and tablename in (
              'enrichment_place_aliases',
              'wine_enrichment_projection_feedback',
              'wine_maturity_overrides',
              'wine_enrichment_projections'
          )
    ),
    0::bigint,
    'Shared knowledge and online projection metadata stay outside PowerSync'
);

select is(
    (
        select count(*)
        from cron.job
        where jobname = 'cellarmanager-maturity-enrichment'
          and schedule = '* * * * *'
    ),
    1::bigint,
    'One minute-bounded maturity worker is scheduled idempotently'
);

select is(
    public.enqueue_maturity_enrichment_jobs(10) ->> 'reason',
    'no-active-knowledge-version',
    'No maturity work starts before explicit knowledge publication'
);

update public.wines
set
    appellation = 'Pic Saint Loup',
    area = 'Languedoc',
    vintage = 2018
where id = '00000000-0000-4000-8000-000000000110';

update public.locations
set storage_purpose = case code
    when 'A' then 'aging'
    else 'service'
end
where household_id = '00000000-0000-4000-8000-000000000100';

select is(
    public.install_initial_maturity_knowledge() ->> 'status',
    'active',
    'The reviewed baseline publishes atomically'
);

select is(
    (select count(*) from public.enrichment_profiles),
    24::bigint,
    'The accepted POC publishes seven places and seventeen vintages'
);

select results_eq(
    $test$
        select profile_type, count(*)
        from public.enrichment_profiles
        group by profile_type
        order by profile_type
    $test$,
    $expected$
        values
            ('place'::text, 7::bigint),
            ('vintage'::text, 17::bigint)
    $expected$,
    'Initial knowledge contains only the reviewed, environment-independent layers'
);

select ok(
    (
        select content_sha256 ~ '^[0-9a-f]{64}$'
        from public.enrichment_knowledge_versions
        where status = 'active'
    ),
    'Published maturity knowledge has a canonical content hash'
);

select ok(
    (public.install_initial_maturity_knowledge() ->> 'already_installed')::boolean,
    'Initial knowledge installation is idempotent'
);

select results_eq(
    $test$
        select normalized_value
        from public.enrichment_place_aliases
        where normalized_value in (
            'pic saint loup',
            'puligny montrachet 1c',
            'volnay 1er cru'
        )
        order by normalized_value
    $test$,
    $expected$
        values
            ('pic saint loup'::text),
            ('puligny montrachet 1c'::text),
            ('volnay 1er cru'::text)
    $expected$,
    'Real cellar spelling variants resolve to reviewed places'
);

select is(
    (public.process_maturity_enrichment_jobs('pgtap-worker', 10) ->> 'completed')::integer,
    1,
    'The worker completes the supported wine once'
);

select is(
    (public.process_maturity_enrichment_jobs('pgtap-empty', 10) ->> 'processed')::integer,
    0,
    'The worker is idempotent when no input changed'
);

select is(
    (
        select count(*)
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and status = 'current'
    ),
    2::bigint,
    'One maturity and one storage projection are current'
);

select results_eq(
    $test$
        select projection_type
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and status = 'current'
        order by projection_type
    $test$,
    $expected$
        values ('maturity'::text), ('storage'::text)
    $expected$,
    'The maturity job publishes both capability payloads atomically'
);

select results_eq(
    $test$
        select
            recommendation ->> 'state',
            (recommendation ->> 'first_trial_year')::integer,
            (recommendation ->> 'best_start_year')::integer,
            (recommendation ->> 'best_end_year')::integer,
            (recommendation ->> 'drink_by_year')::integer
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    $test$,
    $expected$
        values ('ready'::text, 2022::integer, 2025::integer, 2031::integer, 2037::integer)
    $expected$,
    'Place and vintage layers produce the accepted Pic Saint-Loup window'
);

select ok(
    (
        select
            confidence >= 0.5
            and confidence < 0.75
            and recommendation ->> 'confidence_label' = 'medium'
            and jsonb_array_length(recommendation -> 'warnings') = 2
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    ),
    'Place and vintage evidence remain medium confidence without producer or cuvee support'
);

select ok(
    (
        select
            recommendation ->> 'purpose' = 'split-service-and-aging'
            and (recommendation #>> '{move,needed}')::boolean
            and (recommendation #>> '{move,possible}')::boolean
            and (recommendation #>> '{move,quantity}')::integer = 1
            and recommendation #>> '{move,to_purpose}' = 'service'
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'storage'
          and status = 'current'
    ),
    'Storage advice uses quantities and configured location purposes'
);

select is(
    (
        select demand_status
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000210'
          and capability = 'maturity'
    ),
    'needs-review',
    'Unsupported wine remains explicit instead of receiving a fabricated range'
);

select is(
    (
        select count(*)
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000210'
    ),
    0::bigint,
    'Unsupported wine has no projection'
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
        select
            wine.household_id,
            wine.id,
            version.id,
            'maturity',
            'curated-inference',
            'regional-style',
            0.5,
            repeat('a', 64),
            '{"schema_version":1,"state":"ready","urgency":"ready","first_trial_year":2030,"best_start_year":2029,"best_end_year":2031,"drink_by_year":2035,"warnings":[],"reasons":[]}'::jsonb
        from public.wines wine
        cross join public.enrichment_knowledge_versions version
        where wine.id = '00000000-0000-4000-8000-000000000210'
          and version.status = 'active'
    $test$,
    '23514',
    'Maturity recommendation years must be monotonic',
    'Malformed maturity windows cannot be published'
);

select is(
    (
        select count(*)
        from public.wine_enrichment_projection_profiles
        where projection_id = (
            select id
            from public.wine_enrichment_projections
            where wine_id = '00000000-0000-4000-8000-000000000110'
              and projection_type = 'maturity'
              and status = 'current'
        )
    ),
    2::bigint,
    'Projection provenance retains the place and vintage profiles'
);

select is(
    (
        select count(*)
        from public.wine_enrichment_projection_evidence
        where projection_id = (
            select id
            from public.wine_enrichment_projections
            where wine_id = '00000000-0000-4000-8000-000000000110'
              and projection_type = 'maturity'
              and status = 'current'
        )
    ),
    1::bigint,
    'Projection provenance retains reviewed evidence without duplication'
);

select is(
    (
        select count(*)
        from public.enrichment_jobs
        where capability = 'pairing-profile'
    ),
    0::bigint,
    'The maturity worker does not create premature pairing jobs'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    jsonb_array_length(
        public.get_household_maturity_overview(
            '00000000-0000-4000-8000-000000000100'
        )
    ),
    1,
    'A member receives a compact row for each household wine'
);

select is(
    public.get_wine_maturity(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{projection,maturity,state}',
    'ready',
    'A member can read the full current maturity result'
);

select throws_ok(
    $test$
        select public.get_wine_maturity(
            '00000000-0000-4000-8000-000000000210'
        )
    $test$,
    '42501',
    'Wine membership is required',
    'Another household projection cannot be inspected'
);

select is(
    public.review_wine_maturity_projection(
        (
            select id
            from public.wine_enrichment_projections
            where wine_id = '00000000-0000-4000-8000-000000000110'
              and projection_type = 'maturity'
              and status = 'current'
        ),
        'useful',
        null
    ) #>> '{feedback,verdict}',
    'useful',
    'A member can mark the current model result useful'
);

select is(
    public.set_wine_maturity_override(
        '00000000-0000-4000-8000-000000000110',
        2028,
        2030,
        2034,
        2040,
        'overflow',
        'Producer advised more patience'
    ) #>> '{override,drink_by_year}',
    '2040',
    'A member can save a separate owner-maintained window'
);

select ok(
    (
        select item ->> 'state' = 'hold'
           and (item ->> 'is_override')::boolean
           and item ->> 'confidence_label' = 'owner'
           and (item ->> 'drink_by_year')::integer = 2040
        from jsonb_array_elements(
            public.get_household_maturity_overview(
                '00000000-0000-4000-8000-000000000100'
            )
        ) item
        where item ->> 'wine_id' =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Overview clearly prefers the owner override without deleting the model'
);

select is(
    (
        select recommendation ->> 'state'
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    ),
    'ready',
    'Saving an override preserves the original model projection'
);

select is(
    public.clear_wine_maturity_override(
        '00000000-0000-4000-8000-000000000110'
    ) ->> 'override',
    null::text,
    'A member can return to the model result'
);

select ok(
    public.create_location(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000120',
        'Service rack',
        12,
        'service'
    ) is not null,
    'Owners can classify a new location at creation'
);

select is(
    (
        select storage_purpose
        from public.locations
        where cellar_id = '00000000-0000-4000-8000-000000000120'
          and code = 'Service rack'
    ),
    'service',
    'The classified location purpose is stored'
);

select ok(
    public.update_location(
        (
            select id
            from public.locations
            where cellar_id = '00000000-0000-4000-8000-000000000120'
              and code = 'Service rack'
        ),
        'Overflow rack',
        12,
        'overflow'
    ) is not null,
    'Owners can update a location purpose'
);

reset role;

select is(
    (
        select storage_purpose
        from public.locations
        where cellar_id = '00000000-0000-4000-8000-000000000120'
          and code = 'Overflow rack'
    ),
    'overflow',
    'Updated storage purpose reaches the authoritative location'
);

select is(
    (
        select demand_status
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and capability = 'maturity'
    ),
    'complete',
    'An unused extra location does not invalidate unchanged physical advice'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select ok(
    public.update_location(
        '00000000-0000-4000-8000-000000000121',
        'A',
        null,
        'service'
    ) is not null,
    'Owners can classify a location that contains bottles'
);

reset role;

select is(
    (
        select storage_purpose
        from public.locations
        where id = '00000000-0000-4000-8000-000000000121'
    ),
    'service',
    'The occupied location receives its physical purpose'
);

select is(
    (
        select demand_status
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and capability = 'maturity'
    ),
    'queued',
    'Changing physical storage requeues affected maturity advice'
);

select isnt(
    (
        select input_fingerprint
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and capability = 'maturity'
    ),
    (
        select input_fingerprint
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    ),
    'Storage changes produce a new maturity input fingerprint'
);

select is(
    (
        public.process_maturity_enrichment_jobs(
            'pgtap-storage-refresh',
            10
        ) ->> 'completed'
    )::integer,
    1,
    'Requeued advice recalculates successfully'
);

select is(
    (
        select count(*)
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    ),
    1::bigint,
    'Exactly one current maturity projection remains after recalculation'
);

select is(
    (
        select count(*)
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'superseded'
    ),
    1::bigint,
    'The prior model projection remains as immutable history'
);

-- The expanded knowledge is a separate immutable version. It is activated
-- explicitly only after the initial model behavior above has been verified.
select is(
    public.install_expanded_maturity_knowledge() ->> 'status',
    'active',
    'The expanded appellation-first knowledge publishes atomically'
);

select results_eq(
    $test$
        select version_number, status
        from public.enrichment_knowledge_versions
        order by version_number
    $test$,
    $expected$
        values
            (1::integer, 'superseded'::text),
            (2::integer, 'active'::text)
    $expected$,
    'Knowledge v2 supersedes v1 without deleting its immutable history'
);

select is(
    (
        select count(*)
        from public.enrichment_profiles
        where knowledge_version_id =
            private.enrichment_seed_uuid('knowledge:maturity-v2')
    ),
    218::bigint,
    'Knowledge v2 contains 151 exact place/color and 67 vintage profiles'
);

select ok(
    (public.install_expanded_maturity_knowledge() ->> 'already_installed')::boolean,
    'Expanded knowledge installation is idempotent'
);

update public.wines
set
    appellation = 'Saint-Véran',
    area = 'Bourgogne',
    color = 'white',
    vintage = 2020
where id = '00000000-0000-4000-8000-000000000110';

insert into public.wines (
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area
)
values
    (
        '00000000-0000-4000-8000-000000000111',
        '00000000-0000-4000-8000-000000000100',
        'Unknown producer',
        'Unknown appellation',
        2020,
        'white',
        'Imaginary 1C',
        'Bourgogne'
    ),
    (
        '00000000-0000-4000-8000-000000000112',
        '00000000-0000-4000-8000-000000000100',
        'NV producer',
        'NV wine',
        null,
        'sparkling',
        'Champagne',
        'Champagne'
    ),
    (
        '00000000-0000-4000-8000-000000000113',
        '00000000-0000-4000-8000-000000000100',
        'Conflicting producer',
        'Conflicting wine',
        1996,
        'white',
        'Chianti Classico',
        'Toscane'
    );

select ok(
    (
        select result ->> 'completed' = '1'
           and result ->> 'needs_review' = '4'
        from (
            select public.process_maturity_enrichment_jobs(
                'pgtap-expanded-knowledge',
                10
            ) as result
        ) processed
    ),
    'The expanded worker assesses only exact compatible and vintage-anchored wines'
);

select results_eq(
    $test$
        select
            recommendation ->> 'place_match',
            recommendation ->> 'state',
            (recommendation ->> 'first_trial_year')::integer,
            (recommendation ->> 'best_start_year')::integer,
            (recommendation ->> 'best_end_year')::integer,
            (recommendation ->> 'drink_by_year')::integer
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    $test$,
    $expected$
        values (
            'exact-appellation'::text,
            'ready'::text,
            2021::integer,
            2023::integer,
            2027::integer,
            2032::integer
        )
    $expected$,
    'Saint-Veran uses its exact Maconnais baseline and Bourgogne 2020 modifier'
);

select ok(
    (
        select confidence >= 0.5
           and recommendation ->> 'confidence_label' = 'medium'
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    ),
    'Exact place plus vintage evidence reaches medium confidence without double penalties'
);

select is(
    (
        select demand_status
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000111'
          and capability = 'maturity'
    ),
    'needs-review',
    'An unknown appellation does not fall back to its broad Bourgogne area'
);

select is(
    (
        select last_error_code
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000111'
          and capability = 'maturity'
    ),
    'unsupported-place-profile',
    'An unsupported appellation keeps its explicit assessment reason'
);

select is(
    (
        select count(*)
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000111'
    ),
    0::bigint,
    'No range is fabricated for the unsupported appellation'
);

select is(
    (
        select last_error_code
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000112'
          and capability = 'maturity'
    ),
    'missing-vintage',
    'A non-vintage wine remains unassessed until it has a safe date anchor'
);

select is(
    (
        select last_error_code
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000113'
          and capability = 'maturity'
    ),
    'appellation-color-conflict',
    'A wrong-color match remains an explicit conflict rather than a projection'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    (
        select item ->> 'assessment_reason'
        from jsonb_array_elements(
            public.get_household_maturity_overview(
                '00000000-0000-4000-8000-000000000100'
            )
        ) item
        where item ->> 'wine_id' =
            '00000000-0000-4000-8000-000000000111'
    ),
    'unsupported-place-profile',
    'The household overview explains why a wine was not assessed'
);

select is(
    public.get_wine_maturity(
        '00000000-0000-4000-8000-000000000112'
    ) ->> 'assessment_reason',
    'missing-vintage',
    'Wine detail exposes the exact missing-vintage reason'
);

reset role;

select * from finish();

rollback;
