begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

select has_table(
    'public',
    'enrichment_dish_profiles',
    'Reviewed dish profiles are typed shared knowledge'
);

select has_table(
    'public',
    'wine_pairing_preferences',
    'Personal dish preferences are stored outside shared knowledge'
);

select ok(
    to_regprocedure('public.install_pairing_knowledge()') is not null
    and to_regprocedure('public.process_pairing_profile_jobs(text,integer)') is not null
    and not has_function_privilege(
        'authenticated',
        'public.install_pairing_knowledge()',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'public.install_refined_pairing_knowledge()',
        'EXECUTE'
    )
    and has_function_privilege(
        'service_role',
        'public.process_pairing_profile_jobs(text,integer)',
        'EXECUTE'
    ),
    'Knowledge installation and pairing workers remain service-only'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_pairing_dish_profiles(uuid)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.get_pairing_suggestions(uuid,text,jsonb,text[],text,integer)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.review_wine_pairing_projection(uuid,text,text)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'public.get_pairing_suggestions_v1(uuid,text,jsonb,text[],text,integer)',
        'EXECUTE'
    ),
    'Members use narrow pairing RPCs rather than shared tables'
);

select ok(
    (
        select bool_and(relrowsecurity)
        from pg_catalog.pg_class
        where oid in (
            'public.enrichment_dish_profiles'::regclass,
            'public.wine_pairing_preferences'::regclass
        )
    ),
    'Dish knowledge and personal preferences have RLS enabled'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.enrichment_dish_profiles',
        'SELECT, INSERT, UPDATE, DELETE'
    )
    and not has_table_privilege(
        'authenticated',
        'public.wine_pairing_preferences',
        'SELECT, INSERT, UPDATE, DELETE'
    ),
    'Browser roles cannot bypass pairing RPC validation'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_publication_tables
        where pubname = 'powersync'
          and schemaname = 'public'
          and tablename in (
              'enrichment_dish_profiles',
              'wine_pairing_preferences'
          )
    ),
    0::bigint,
    'Pairing knowledge and preferences remain online-only'
);

update public.wines
set
    appellation = 'Pic Saint Loup',
    area = 'Languedoc',
    vintage = 2018,
    color = 'red'
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
values (
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000100',
    'Maison Test',
    'Brut sans année',
    null,
    'sparkling',
    'Champagne',
    'Champagne'
);

insert into public.holdings (
    id,
    household_id,
    wine_id,
    location_id,
    quantity
)
values (
    '00000000-0000-4000-8000-000000000131',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000121',
    2
);

select is(
    public.install_pairing_knowledge() ->> 'status',
    'active',
    'Reviewed v4 wine and dish knowledge publishes explicitly'
);

select is(
    public.install_expanded_pairing_knowledge() ->> 'status',
    'active',
    'Expanded v5 dish knowledge publishes explicitly'
);

select is(
    public.install_refined_pairing_knowledge() ->> 'status',
    'active',
    'Refined v6 pairing knowledge is active'
);

select results_eq(
    $test$
        select version_number, status, model_key
        from public.enrichment_knowledge_versions
        where version_number in (3, 4, 5, 6)
        order by version_number
    $test$,
    $expected$
        values
            (3::integer, 'superseded'::text, 'hierarchical-maturity'::text),
            (4::integer, 'superseded'::text, 'hierarchical-maturity'::text),
            (5::integer, 'superseded'::text, 'hierarchical-maturity'::text),
            (6::integer, 'active'::text, 'hierarchical-maturity'::text)
    $expected$,
    'v6 preserves the hierarchical maturity engine and immutable history'
);

select is(
    (
        select count(*)
        from public.enrichment_profiles
        where knowledge_version_id =
            private.enrichment_seed_uuid('knowledge:pairing-v6')
    ),
    266::bigint,
    'v6 keeps the wine hierarchy, 32 dishes, and distinct Maury Sec structure'
);

select is(
    (
        select count(*)
        from public.enrichment_dish_profiles
        where knowledge_version_id =
            private.enrichment_seed_uuid('knowledge:pairing-v6')
    ),
    32::bigint,
    'The reviewed dish library contains 32 adjustable archetypes'
);

select ok(
    (
        select content_sha256 ~ '^[0-9a-f]{64}$'
        from public.enrichment_knowledge_versions
        where version_number = 6
    )
    and (
        private.enrichment_knowledge_version_payload(
            private.enrichment_seed_uuid('knowledge:pairing-v6')
        ) #> '{profiles,0,typed}'
    ) is not null,
    'The canonical v6 hash includes typed profile payloads'
);

select ok(
    (
        public.install_refined_pairing_knowledge()
            ->> 'already_installed'
    )::boolean,
    'Refined pairing knowledge installation is idempotent'
);

select results_eq(
    $test$
        select place.canonical_name, typed.sweetness
        from public.enrichment_place_profiles typed
        join public.enrichment_places place on place.id = typed.place_id
        where typed.knowledge_version_id =
            private.enrichment_seed_uuid('knowledge:pairing-v6')
          and place.id in (
              private.enrichment_seed_uuid('place:maury'),
              private.enrichment_seed_uuid('place:maury-sec')
          )
        order by place.canonical_name
    $test$,
    $expected$
        values
            ('Maury'::text, 4.50::numeric),
            ('Maury Sec'::text, 0.00::numeric)
    $expected$,
    'Maury vin doux naturel and Maury Sec have distinct sweetness profiles'
);

select is(
    (public.process_maturity_enrichment_jobs('pgtap-pairing-maturity', 100)
        ->> 'completed')::integer,
    1,
    'Maturity prepares the supported vintage wine before pairing'
);

update public.wine_enrichment_projections
set recommendation = jsonb_set(
    recommendation,
    '{traits,concentration}',
    '-0.4'::jsonb
)
where wine_id = '00000000-0000-4000-8000-000000000110'
  and projection_type = 'maturity'
  and status = 'current';

select is(
    (public.process_pairing_profile_jobs('pgtap-pairing-profile', 100)
        ->> 'completed')::integer,
    2,
    'Pairing prepares a vintage wine and an exact-place NV wine'
);

select is(
    (
        select count(*)
        from public.wine_enrichment_projections
        where household_id = '00000000-0000-4000-8000-000000000100'
          and projection_type = 'pairing'
          and context_key = 'wine-profile'
          and status = 'current'
    ),
    2::bigint,
    'Two in-household wine-side profiles are current'
);

select ok(
    (
        select
            (recommendation #>> '{traits,concentration}')::numeric = 0
            and jsonb_array_length(recommendation -> 'warnings') = 1
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'pairing'
          and context_key = 'wine-profile'
          and status = 'current'
    ),
    'Derived structural adjustments are normalized to the 0-5 pairing scale'
);

select ok(
    (
        select
            recommendation ->> 'wine_color' = 'sparkling'
            and jsonb_array_length(recommendation -> 'warnings') = 1
            and specificity = 'place'
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000111'
          and projection_type = 'pairing'
          and context_key = 'wine-profile'
          and status = 'current'
    ),
    'NV Champagne uses exact reviewed structure without inventing readiness'
);

select ok(
    not exists (
        select 1
        from public.wine_enrichment_projections projection
        where projection.projection_type = 'pairing'
          and projection.context_key = 'wine-profile'
          and not exists (
              select 1
              from public.wine_enrichment_projection_profiles link
              where link.projection_id = projection.id
          )
    ),
    'Every prepared pairing profile retains contributing shared profiles'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    jsonb_array_length(
        public.get_pairing_dish_profiles(
            '00000000-0000-4000-8000-000000000100'
        )
    ),
    32,
    'A member can load reviewed dish profiles through the narrow RPC'
);

select ok(
    (
        public.set_pairing_preference(
            '00000000-0000-4000-8000-000000000100',
            'grilled-beef',
            array['red'],
            'rich'
        ) ->> 'saved'
    )::boolean,
    'A member can remember personal color and style defaults'
);

select is(
    public.get_pairing_suggestions(
        '00000000-0000-4000-8000-000000000100',
        'grilled-beef',
        null,
        array['red'],
        'rich',
        5
    ) ->> 'status',
    'suggestions',
    'An in-stock compatible bottle produces a pairing suggestion'
);

select ok(
    (
        with result as (
            select public.get_pairing_suggestions(
                '00000000-0000-4000-8000-000000000100',
                'grilled-beef',
                null,
                array['red'],
                'rich',
                5
            ) as payload
        )
        select
            payload #>> '{suggestions,0,wine_id}' =
                '00000000-0000-4000-8000-000000000110'
            and (payload #>> '{suggestions,0,quantity}')::integer = 5
            and jsonb_array_length(payload #> '{suggestions,0,locations}') = 1
        from result
    ),
    'Suggestions identify a real in-stock wine and its physical location'
);

select is(
    (
        select projection.recommendation ->> 'scorer_version'
        from public.wine_enrichment_projections projection
        where projection.wine_id = '00000000-0000-4000-8000-000000000110'
          and projection.projection_type = 'pairing'
          and projection.context_key like 'dish:grilled-beef:%'
          and projection.status = 'current'
    ),
    'pairing-score-1.2.0',
    'Persisted pairing advice identifies the exact scoring algorithm'
);

reset role;

select ok(
    (
        select count(*) >= 2
        from public.wine_enrichment_projection_profiles link
        join public.wine_enrichment_projections projection
          on projection.id = link.projection_id
        where projection.wine_id = '00000000-0000-4000-8000-000000000110'
          and projection.projection_type = 'pairing'
          and projection.context_key like 'dish:grilled-beef:%'
          and projection.status = 'current'
    ),
    'A dish match retains both wine and dish profile provenance'
);

set local role authenticated;

select is(
    public.review_wine_pairing_projection(
        (
            select projection.id
            from public.wine_enrichment_projections projection
            where projection.wine_id = '00000000-0000-4000-8000-000000000110'
              and projection.projection_type = 'pairing'
              and projection.context_key like 'dish:grilled-beef:%'
              and projection.status = 'current'
        ),
        'useful',
        'Worked well tonight'
    ) ->> 'verdict',
    'useful',
    'A member can review the exact pairing projection'
);

do $$
begin
    perform public.get_pairing_suggestions(
        '00000000-0000-4000-8000-000000000100',
        'grilled-beef',
        null,
        array['red'],
        'rich',
        5
    );
end
$$;

reset role;

select is(
    (
        select (projection.recommendation ->> 'personal_adjustment')::integer
        from public.wine_enrichment_projections projection
        where projection.wine_id = '00000000-0000-4000-8000-000000000110'
          and projection.projection_type = 'pairing'
          and projection.context_key like 'dish:grilled-beef:%'
          and projection.status = 'current'
    ),
    6,
    'Repeated feedback refines only the member ranking'
);

set local role authenticated;

select is(
    public.get_pairing_suggestions(
        '00000000-0000-4000-8000-000000000100',
        'fruit-tart',
        null,
        array['red'],
        null,
        5
    ) ->> 'status',
    'no-suitable-wine',
    'The engine refuses to recommend a dry wine for a sweet dessert'
);

reset role;

select ok(
    not (
        private.score_wine_pairing(
            '{"body":4,"acidity":3.5,"tannin":1,"sweetness":4.5,"alcohol":3,"freshness":3,"savory":2,"concentration":4}'::jsonb,
            '{"intensity":4,"fat":3,"acidity":1,"sweetness":2,"salt":2,"umami":2,"spice":3,"protein":4,"fish":0}'::jsonb,
            'ready',
            null,
            null
        ) ->> 'suitable'
    )::boolean,
    'A dessert-level sweet wine is rejected for a mildly sweet lamb tagine'
);

select ok(
    (
        private.score_wine_pairing(
            '{"body":4,"acidity":3.5,"tannin":1,"sweetness":4.5,"alcohol":3,"freshness":3,"savory":2,"concentration":4}'::jsonb,
            '{"intensity":5,"fat":4,"acidity":1,"sweetness":0,"salt":5,"umami":5,"spice":0,"protein":3,"fish":0}'::jsonb,
            'ready',
            null,
            null
        ) ->> 'suitable'
    )::boolean,
    'The narrow salty blue-cheese contrast remains available to sweet wine'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select throws_ok(
    $test$
        select public.get_pairing_dish_profiles(
            '00000000-0000-4000-8000-000000000200'
        )
    $test$,
    '42501',
    'Household membership is required',
    'Pairing APIs reject another household'
);

select throws_ok(
    $test$
        select public.get_pairing_suggestions(
            '00000000-0000-4000-8000-000000000100',
            'grilled-beef',
            '{"intensity":9}'::jsonb,
            array[]::text[],
            null,
            5
        )
    $test$,
    '22023',
    'Dish attributes must contain nine values between 0 and 5',
    'Malformed ingredient constraints are rejected server-side'
);

reset role;

select is(
    (
        select count(*)
        from public.wine_pairing_preferences
        where household_id = '00000000-0000-4000-8000-000000000200'
    ),
    0::bigint,
    'Personal pairing preferences never cross household boundaries'
);

select is(
    (
        select count(*)
        from cron.job
        where jobname = 'cellarmanager-pairing-profiles'
          and schedule = '* * * * *'
    ),
    1::bigint,
    'One bounded pairing-profile worker is scheduled idempotently'
);

select * from finish();

rollback;
