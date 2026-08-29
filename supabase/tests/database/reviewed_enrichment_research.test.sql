begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select ok(
    (
        select bool_and(to_regclass(table_name) is not null)
        from unnest(array[
            'public.enrichment_research_source_rules',
            'public.enrichment_research_cases',
            'public.enrichment_research_subscriptions',
            'public.enrichment_research_drafts',
            'public.enrichment_research_draft_sources',
            'public.enrichment_research_reviews',
            'public.enrichment_researched_fact_claims'
        ]) tables(table_name)
    ),
    'Research requests, drafts, reviews, and published facts have durable tables'
);

select ok(
    to_regprocedure('public.request_enrichment_research(uuid,uuid,text,integer)') is not null
    and to_regprocedure('public.get_household_enrichment_research_inbox(uuid)') is not null
    and to_regprocedure('public.review_enrichment_research_draft(uuid,uuid,text,jsonb,text)') is not null
    and to_regprocedure('public.claim_enrichment_research_cases(text,integer,integer)') is not null
    and to_regprocedure('public.complete_enrichment_research_case(uuid,uuid,text,jsonb,timestamp with time zone)') is not null
    and to_regprocedure('public.publish_enrichment_research_draft(uuid,uuid)') is not null
    and to_regprocedure('public.publish_reviewed_enrichment_research_drafts(integer)') is not null,
    'The research lifecycle has explicit browser and trusted-service APIs'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.request_enrichment_research(uuid,uuid,text,integer)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.review_enrichment_research_draft(uuid,uuid,text,jsonb,text)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'public.claim_enrichment_research_cases(text,integer,integer)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'public.publish_enrichment_research_draft(uuid,uuid)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'public.publish_reviewed_enrichment_research_drafts(integer)',
        'EXECUTE'
    )
    and has_function_privilege(
        'service_role',
        'public.publish_enrichment_research_draft(uuid,uuid)',
        'EXECUTE'
    ),
    'Owners review drafts while only the trusted service claims and publishes them'
);

select ok(
    (
        select bool_and(class.relrowsecurity)
        from pg_catalog.pg_class class
        where class.oid in (
            'public.enrichment_research_source_rules'::regclass,
            'public.enrichment_research_cases'::regclass,
            'public.enrichment_research_subscriptions'::regclass,
            'public.enrichment_research_drafts'::regclass,
            'public.enrichment_research_draft_sources'::regclass,
            'public.enrichment_research_reviews'::regclass,
            'public.enrichment_researched_fact_claims'::regclass
        )
    ),
    'Every research table has RLS enabled'
);

select ok(
    exists (
        select 1
        from public.enrichment_research_source_rules rule
        join public.enrichment_sources source on source.id = rule.source_id
        join public.enrichment_source_policies policy on policy.id = rule.source_policy_id
        where source.source_key = 'jean-marc-burgaud-official'
          and rule.hostname = 'jean-marc-burgaud.com'
          and rule.path_prefix = '/nos-vins'
          and rule.subject_aliases @> array['burgaud']
          and policy.status = 'reviewed'
          and policy.normalized_storage_right = 'prohibited'
          and policy.raw_payload_storage_right = 'prohibited'
    ),
    'The first live source is a narrow pointer-only Burgaud allowlist rule'
);

select ok(
    exists (
        select 1
        from public.enrichment_research_source_rules rule
        join public.enrichment_sources source on source.id = rule.source_id
        join public.enrichment_source_policies policy
          on policy.id = rule.source_policy_id
        where source.source_key = 'frantz-chagnoleau-artisans-vignerons'
          and rule.subject_aliases @> array['chagnoleau']
          and policy.status = 'reviewed'
          and policy.raw_payload_storage_right = 'prohibited'
    )
    and exists (
        select 1
        from public.enrichment_research_source_rules rule
        join public.enrichment_sources source on source.id = rule.source_id
        join public.enrichment_source_policies policy
          on policy.id = rule.source_policy_id
        where source.source_key = 'chateau-cazeneuve-official'
          and rule.subject_aliases @> array['chateau de cazeneuve']
          and policy.status = 'reviewed'
          and policy.raw_payload_storage_right = 'prohibited'
    ),
    'Chagnoleau and Cazeneuve have narrow reviewed pointer-only source rules'
);

select is(
    private.https_url_path(
        'https://jean-marc-burgaud.com/nos-vins/archive?language=en#history'
    ),
    '/nos-vins/archive',
    'Source validation keeps the complete path while excluding query and fragment data'
);

select is(
    private.https_url_path('https://jean-marc-burgaud.com'),
    '/',
    'An approved HTTPS hostname without an explicit path resolves to the root path'
);

insert into public.wine_reference_entities (id, entity_type)
values
    ('00000000-0000-4000-8000-000000000b10', 'producer'),
    ('00000000-0000-4000-8000-000000000b11', 'product');

insert into public.wine_reference_producers (id, entity_type, canonical_name)
values ('00000000-0000-4000-8000-000000000b10', 'producer', 'Jean-Marc Burgaud');

insert into public.wine_reference_products (id, entity_type, producer_id, canonical_name)
values (
    '00000000-0000-4000-8000-000000000b11',
    'product',
    '00000000-0000-4000-8000-000000000b10',
    'Morgon Côte du Py'
);

insert into public.wine_reference_household_producer_preferences (
    household_id,
    source_producer_normalized,
    source_producer_text,
    producer_id,
    decided_by
) values (
    '00000000-0000-4000-8000-000000000100',
    'burgaud',
    'Burgaud',
    '00000000-0000-4000-8000-000000000b10',
    '00000000-0000-4000-8000-000000000001'
);

update public.wines
set
    producer = 'Burgaud',
    cuvee = 'Morgon Côte du Py',
    vintage = 2020,
    color = 'red',
    appellation = 'Morgon',
    area = 'Beaujolais',
    wine_reference_id = '00000000-0000-4000-8000-000000000b11',
    wine_reference_type = 'product'
where id = '00000000-0000-4000-8000-000000000110';

select public.install_refined_pairing_knowledge();

create temporary table research_baseline as
select
    version.id as active_version_id,
    (select count(*) from public.enrichment_profiles profile
        where profile.knowledge_version_id = version.id) as profile_count,
    (select count(*) from public.enrichment_dish_profiles dish
        where dish.knowledge_version_id = version.id) as dish_count
from public.enrichment_knowledge_versions version
where version.status = 'active';

grant select on table research_baseline to service_role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    (
        public.request_enrichment_research(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000110',
            'profile-producer',
            9400
        ) #>> '{items,0,status}'
    ),
    'queued',
    'A household owner can request a canonical producer-profile research case'
);

reset role;

select is(
    (select count(*) from public.enrichment_research_subscriptions
        where household_id = '00000000-0000-4000-8000-000000000100'),
    1::bigint,
    'A household subscription is created without duplicating the global subject'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select throws_ok(
    $test$
        select public.get_household_enrichment_research_inbox(
            '00000000-0000-4000-8000-000000000100'
        )
    $test$,
    '42501',
    'Household access is required',
    'Another household cannot inspect a research subscription or draft'
);

reset role;
set local role service_role;

create temporary table claimed_research as
select public.claim_enrichment_research_cases('pgtap-research', 1, 120) -> 0 as item;

select ok(
    (select item::text not like '%household%' and item::text not like '%wine_id%'
        from claimed_research),
    'The trusted worker claim omits household and wine identifiers'
);

select is(
    (select jsonb_array_length(item -> 'allowed_sources') from claimed_research),
    1,
    'The Burgaud case receives only its exact official source rule'
);

select throws_ok(
    format(
        'select public.complete_enrichment_research_case(%L, %L, %L, null, null)',
        (select item ->> 'case_id' from claimed_research),
        gen_random_uuid(),
        'failed'
    ),
    '55000',
    'Research lease is missing, stale, or expired',
    'A stale worker token cannot complete research'
);

select is(
    public.complete_enrichment_research_case(
        (select (item ->> 'case_id')::uuid from claimed_research),
        (select (item ->> 'lease_token')::uuid from claimed_research),
        'draft',
        jsonb_build_object(
            'proposal', jsonb_build_object(
                'profile_type', 'producer-era',
                'first_vintage_year', 1989,
                'final_vintage_year', 2200,
                'rationale', 'Traditional Beaujolais vinification produces structured, cellar-worthy Morgon with ripe noble tannins.',
                'confidence', 0.70,
                'age_adjustments', jsonb_build_object(
                    'first_trial', 1,
                    'best_start', 1,
                    'best_end', 2,
                    'outer_horizon', 3
                ),
                'trait_adjustments', jsonb_build_object(
                    'body', 0.4,
                    'acidity', 0.0,
                    'tannin', 0.6,
                    'sweetness', 0.0,
                    'alcohol', 0.0,
                    'freshness', 0.1,
                    'savory', 0.2,
                    'concentration', 0.6
                )
            ),
            'rationale', 'Traditional Beaujolais vinification produces structured, cellar-worthy Morgon with ripe noble tannins.',
            'confidence', 0.70,
            'synthesis_model', 'pgtap-deterministic-1',
            'sources', jsonb_build_array(jsonb_build_object(
                'rule_id', (
                    select rule.id
                    from public.enrichment_research_source_rules rule
                    where rule.hostname = 'jean-marc-burgaud.com'
                ),
                'url', 'https://jean-marc-burgaud.com/nos-vins',
                'retrieved_at', '2026-08-27T15:00:00Z'
            ))
        ),
        null
    ) ->> 'status',
    'draft-ready',
    'An allowlisted result becomes an attributable inactive draft'
);

select is(
    (select case_status from public.enrichment_research_cases
        where id = (select (item ->> 'case_id')::uuid from claimed_research)),
    'draft-ready',
    'Completing research notifies owners without activating shared knowledge'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select ok(
    (
        select item #>> '{draft,sources,0,url}' = 'https://jean-marc-burgaud.com/nos-vins'
           and item #>> '{draft,proposal,profile_type}' = 'producer-era'
           and (item #>> '{draft,confidence}')::numeric = 0.70
        from jsonb_array_elements(
            public.get_household_enrichment_research_inbox(
                '00000000-0000-4000-8000-000000000100'
            ) -> 'items'
        ) item
        limit 1
    ),
    'The owner inbox exposes the proposal, confidence, and direct source citation'
);

select is(
    public.get_household_enrichment_research_inbox(
        '00000000-0000-4000-8000-000000000100'
    ) ->> 'unread_count',
    '1',
    'A newly prepared draft is an unread owner notification'
);

select throws_ok(
    format(
        'select public.review_enrichment_research_draft(%L, %L, %L, %L::jsonb, %L)',
        '00000000-0000-4000-8000-000000000100',
        (
            public.get_household_enrichment_research_inbox(
                '00000000-0000-4000-8000-000000000100'
            ) #>> '{items,0,draft,id}'
        )::uuid,
        'edited',
        jsonb_build_object(
            'profile_type', 'producer-era',
            'rationale', 'This malicious browser edit raises confidence outside the reviewed boundary.',
            'confidence', 1
        )::text,
        'Invalid edit'
    ),
    '22023',
    'Research rationale or confidence is invalid',
    'Browser edits are revalidated at the database boundary'
);

select is(
    public.review_enrichment_research_draft(
        '00000000-0000-4000-8000-000000000100',
        (
            public.get_household_enrichment_research_inbox(
                '00000000-0000-4000-8000-000000000100'
            ) #>> '{items,0,draft,id}'
        )::uuid,
        'accepted',
        null,
        'The producer profile matches the cellar experience.'
    ) #>> '{items,0,subscription_status}',
    'reviewed',
    'An owner can accept a visible proposal without changing it'
);

select is(
    public.get_household_enrichment_research_inbox(
        '00000000-0000-4000-8000-000000000100'
    ) #>> '{items,0,status}',
    'owner-reviewed',
    'Owner acceptance queues the draft for trusted publication'
);

reset role;
set local role service_role;

create temporary table publication_result as
select public.publish_reviewed_enrichment_research_drafts(2) -> 0 as result;

select is(
    (select result ->> 'publication_type' from publication_result),
    'profile',
    'The trusted publisher promotes an accepted profile draft'
);

select isnt(
    (select id from public.enrichment_knowledge_versions where status = 'active'),
    (select active_version_id from research_baseline),
    'Profile publication activates a new immutable knowledge version'
);

select is(
    (
        select count(*)
        from public.enrichment_profiles profile
        join public.enrichment_knowledge_versions version
          on version.id = profile.knowledge_version_id
         and version.status = 'active'
    ),
    (select profile_count + 1 from research_baseline),
    'The new version clones every prior profile and adds exactly one'
);

select is(
    (
        select count(*)
        from public.enrichment_dish_profiles dish
        join public.enrichment_knowledge_versions version
          on version.id = dish.knowledge_version_id
         and version.status = 'active'
    ),
    (select dish_count from research_baseline),
    'Publishing a producer profile preserves every reviewed dish profile'
);

select ok(
    exists (
        select 1
        from public.enrichment_producer_era_profiles typed
        join public.enrichment_profiles profile on profile.id = typed.profile_id
        join public.enrichment_knowledge_versions version
          on version.id = typed.knowledge_version_id
         and version.status = 'active'
        where typed.producer_id = '00000000-0000-4000-8000-000000000b10'
          and typed.wine_color = 'red'
          and typed.first_vintage_year = 1989
          and typed.outer_horizon_age_adjustment = 3
          and typed.tannin_adjustment = 0.6
          and profile.review_status = 'reviewed'
    ),
    'The reviewed Burgaud era and bounded adjustments are stored exactly'
);

select ok(
    exists (
        select 1
        from public.enrichment_profile_evidence link
        join public.enrichment_evidence evidence on evidence.id = link.evidence_id
        join public.enrichment_sources source on source.id = evidence.source_id
        where link.profile_id = (select (result ->> 'profile_id')::uuid from publication_result)
          and evidence.content_mode = 'pointer-only'
          and evidence.claim_value is null
          and evidence.review_status = 'reviewed'
          and source.source_key = 'jean-marc-burgaud-official'
    ),
    'Published knowledge retains reviewed pointer-only provenance without copied source content'
);

select ok(
    exists (
        select 1
        from public.enrichment_research_cases research_case
        join public.enrichment_research_subscriptions subscription
          on subscription.case_id = research_case.id
        where research_case.case_status = 'published'
          and research_case.published_at is not null
          and subscription.subscription_status = 'published'
          and subscription.seen_at is null
    ),
    'Publication notifies subscribed owners and closes the shared research case'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    public.mark_enrichment_research_seen(
        '00000000-0000-4000-8000-000000000100',
        null
    ) ->> 'unread_count',
    '0',
    'The owner can mark research notifications as seen'
);

select throws_ok(
    $test$
        select public.publish_enrichment_research_draft(
            gen_random_uuid(),
            gen_random_uuid()
        )
    $test$,
    '42501',
    'permission denied for function publish_enrichment_research_draft',
    'Browser users cannot bypass trusted publication'
);

select * from finish();

rollback;
