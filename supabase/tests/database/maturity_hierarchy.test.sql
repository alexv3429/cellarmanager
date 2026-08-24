begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select has_table(
    'public',
    'enrichment_place_adjustment_profiles',
    'Hierarchical place refinements are stored separately from regional baselines'
);

select has_table(
    'public',
    'enrichment_producer_vintage_interaction_profiles',
    'Producer and vintage interactions are explicit reviewed knowledge'
);

select has_table(
    'public',
    'enrichment_release_profiles',
    'Exact release refinements have their own typed profile'
);

select ok(
    to_regprocedure('public.install_hierarchical_maturity_knowledge()') is not null
    and not has_function_privilege(
        'authenticated',
        'public.install_hierarchical_maturity_knowledge()',
        'EXECUTE'
    )
    and has_function_privilege(
        'service_role',
        'public.install_hierarchical_maturity_knowledge()',
        'EXECUTE'
    ),
    'Only the service role can activate hierarchical knowledge'
);

select is(
    public.install_hierarchical_maturity_knowledge() ->> 'status',
    'active',
    'Reviewed v3 knowledge publishes atomically and explicitly'
);

select results_eq(
    $test$
        select version_number, status, model_key
        from public.enrichment_knowledge_versions
        order by version_number
    $test$,
    $expected$
        values
            (2::integer, 'superseded'::text, 'curated-inference'::text),
            (3::integer, 'active'::text, 'hierarchical-maturity'::text)
    $expected$,
    'v3 supersedes the cloned v2 coverage without mutating it'
);

select is(
    (
        select count(*)
        from public.enrichment_profiles
        where knowledge_version_id =
            private.enrichment_seed_uuid('knowledge:maturity-v3')
    ),
    233::bigint,
    'v3 preserves broad v2 coverage and adds fifteen hierarchical refinements'
);

select results_eq(
    $test$
        select profile_type, count(*)
        from public.enrichment_profiles
        where knowledge_version_id =
            private.enrichment_seed_uuid('knowledge:maturity-v3')
          and profile_type in (
              'place-adjustment',
              'producer-era',
              'producer-vintage-interaction',
              'cuvee',
              'release'
          )
        group by profile_type
        order by profile_type
    $test$,
    $expected$
        values
            ('cuvee'::text, 6::bigint),
            ('place-adjustment'::text, 3::bigint),
            ('producer-era'::text, 3::bigint),
            ('producer-vintage-interaction'::text, 2::bigint),
            ('release'::text, 1::bigint)
    $expected$,
    'Every reviewed hierarchy layer is represented by a typed profile'
);

select ok(
    not exists (
        select 1
        from public.enrichment_evidence evidence
        join public.enrichment_profile_evidence link
          on link.evidence_id = evidence.id
        join public.enrichment_profiles profile on profile.id = link.profile_id
        where profile.knowledge_version_id =
                private.enrichment_seed_uuid('knowledge:maturity-v3')
          and evidence.content_mode <> 'pointer-only'
    ),
    'v3 stores derived parameters and source pointers, not copied source text'
);

-- Simulate an independently imported provider product. The confirmed producer
-- identity is shared, while the product UUID and name differ from v3's reviewed
-- maturity product.
insert into public.wine_reference_entities (id, entity_type)
values ('10000000-0000-4000-8000-000000000001', 'product');

insert into public.wine_reference_products (
    id,
    producer_id,
    canonical_name
)
values (
    '10000000-0000-4000-8000-000000000001',
    private.enrichment_seed_uuid('wine-reference:producer:louis-boillot'),
    'Provider-specific Evocelles identity'
);

update public.wines
set
    producer = 'Boillot',
    cuvee = 'Evocelles',
    vintage = 2018,
    color = 'red',
    appellation = 'Gevrey-Chambertin',
    area = 'Bourgogne'
where id = '00000000-0000-4000-8000-000000000110';

update public.wines
set
    wine_reference_id = '10000000-0000-4000-8000-000000000001',
    wine_reference_type = 'product'
where id = '00000000-0000-4000-8000-000000000110';

select is(
    (public.process_maturity_enrichment_jobs('pgtap-hierarchy-evocelles', 10)
        ->> 'completed')::integer,
    1,
    'The hierarchical worker completes the confirmed Evocelles wine'
);

select results_eq(
    $test$
        select
            specificity,
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
        values ('cuvee'::text, 2023, 2025, 2033, 2038)
    $expected$,
    'Evocelles 2018 reproduces the owner-reviewed maturity window'
);

select results_eq(
    $test$
        select contribution.value ->> 'layer'
        from public.wine_enrichment_projections projection
        cross join lateral jsonb_array_elements(
            projection.recommendation -> 'contributions'
        ) with ordinality contribution(value, position)
        where projection.wine_id = '00000000-0000-4000-8000-000000000110'
          and projection.projection_type = 'maturity'
          and projection.status = 'current'
        order by contribution.position
    $test$,
    $expected$
        values
            ('region'::text),
            ('appellation'::text),
            ('climat'::text),
            ('vintage'::text),
            ('producer-era'::text),
            ('interaction'::text),
            ('cuvee'::text)
    $expected$,
    'The explanation preserves the ordered calculation trace'
);

select ok(
    (
        select confidence >= 0.5
           and confidence < 0.75
           and recommendation ->> 'confidence_label' = 'medium'
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    ),
    'Reliability is the conservative minimum of material layers, not inflated by specificity'
);

update public.wines
set vintage = 2021
where id = '00000000-0000-4000-8000-000000000110';

update public.wines
set
    wine_reference_id = '10000000-0000-4000-8000-000000000001',
    wine_reference_type = 'product'
where id = '00000000-0000-4000-8000-000000000110';

select is(
    (public.process_maturity_enrichment_jobs('pgtap-hierarchy-release', 10)
        ->> 'completed')::integer,
    1,
    'A changed vintage queues a fresh hierarchical calculation'
);

select results_eq(
    $test$
        select
            specificity,
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
        values ('release'::text, 2024, 2026, 2030, 2034)
    $expected$,
    'The exact reviewed 2021 release safely refines the cuvee profile'
);

update public.wines
set
    vintage = 2018,
    wine_reference_id = null,
    wine_reference_type = null
where id = '00000000-0000-4000-8000-000000000110';

select is(
    (public.process_maturity_enrichment_jobs('pgtap-hierarchy-ambiguous', 10)
        ->> 'completed')::integer,
    1,
    'Raw ambiguous producer text can still use safe place and vintage layers'
);

select results_eq(
    $test$
        select specificity, jsonb_array_length(recommendation -> 'contributions')
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    $test$,
    $expected$
        values ('place'::text, 3)
    $expected$,
    'Boillot is not guessed: unconfirmed identity excludes producer, interaction, cuvee, and release layers'
);

insert into public.wine_reference_household_producer_preferences (
    household_id,
    source_producer_normalized,
    source_producer_text,
    producer_id,
    decided_by
)
values (
    '00000000-0000-4000-8000-000000000100',
    'boillot',
    'Boillot',
    private.enrichment_seed_uuid('wine-reference:producer:louis-boillot'),
    '00000000-0000-4000-8000-000000000001'
);

select is(
    (public.process_maturity_enrichment_jobs('pgtap-hierarchy-preference', 10)
        ->> 'completed')::integer,
    1,
    'An explicit remembered producer choice enables a unique curated cuvee alias'
);

select results_eq(
    $test$
        select
            specificity,
            (recommendation ->> 'best_end_year')::integer,
            (recommendation ->> 'drink_by_year')::integer
        from public.wine_enrichment_projections
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and projection_type = 'maturity'
          and status = 'current'
    $test$,
    $expected$
        values ('cuvee'::text, 2033, 2038)
    $expected$,
    'Confirmed producer identity plus an exact cuvee alias restores the reviewed hierarchy'
);

update public.wines
set
    producer = 'Mas Cal Demoura',
    cuvee = 'Fragments',
    vintage = 2023,
    color = 'red',
    appellation = 'Terrasses du Larzac',
    area = 'Languedoc'
where id = '00000000-0000-4000-8000-000000000110';

update public.wines
set
    wine_reference_id =
        private.enrichment_seed_uuid('wine-reference:product:fragments-cal-demoura'),
    wine_reference_type = 'product'
where id = '00000000-0000-4000-8000-000000000110';

select is(
    (public.process_maturity_enrichment_jobs('pgtap-hierarchy-cal-demoura', 10)
        ->> 'completed')::integer,
    1,
    'The hierarchical worker completes a confirmed Cal Demoura wine'
);

select results_eq(
    $test$
        select
            specificity,
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
        values ('cuvee'::text, 2031, 2035, 2040, 2046)
    $expected$,
    'Fragments 2023 keeps the owner-validated long-aging profile'
);

update public.wines
set
    producer = 'Boillot',
    cuvee = 'Evocelles',
    vintage = 2018,
    color = 'white',
    appellation = 'Gevrey-Chambertin',
    area = 'Bourgogne',
    wine_reference_id = null,
    wine_reference_type = null
where id = '00000000-0000-4000-8000-000000000110';

select is(
    (public.process_maturity_enrichment_jobs('pgtap-hierarchy-color', 10)
        ->> 'needs_review')::integer,
    1,
    'A wrong-color exact appellation is rejected rather than widened to a regional guess'
);

select is(
    (
        select last_error_code
        from public.enrichment_demands
        where wine_id = '00000000-0000-4000-8000-000000000110'
          and capability = 'maturity'
    ),
    'appellation-color-conflict',
    'The user receives the actionable color-conflict reason'
);

select ok(
    (public.install_hierarchical_maturity_knowledge() ->> 'already_installed')::boolean,
    'Hierarchical knowledge installation is idempotent'
);

select * from finish();
rollback;
