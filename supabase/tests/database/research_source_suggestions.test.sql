begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select ok(
    to_regclass('public.enrichment_research_source_suggestions') is not null
    and (
        select class.relrowsecurity
        from pg_catalog.pg_class class
        where class.oid = 'public.enrichment_research_source_suggestions'::regclass
    ),
    'Source suggestions are durable and protected by RLS'
);

select ok(
    to_regprocedure('public.suggest_enrichment_research_source(uuid,uuid,text,text)') is not null
    and to_regprocedure('public.record_discovered_enrichment_research_sources(uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.accept_enrichment_research_source_suggestion(uuid,uuid,uuid,text,text,text)') is not null
    and to_regprocedure('public.reject_enrichment_research_source_suggestion(uuid,uuid,uuid,text)') is not null,
    'Manual and trusted source-suggestion APIs are explicit'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.suggest_enrichment_research_source(uuid,uuid,text,text)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'public.accept_enrichment_research_source_suggestion(uuid,uuid,uuid,text,text,text)',
        'EXECUTE'
    )
    and has_function_privilege(
        'service_role',
        'public.accept_enrichment_research_source_suggestion(uuid,uuid,uuid,text,text,text)',
        'EXECUTE'
    ),
    'Owners can nominate URLs while only the trusted worker can accept them'
);

insert into public.enrichment_research_cases (
    id,
    subject_key,
    subject_type,
    gap_type,
    claim_type,
    subject_snapshot,
    wine_color,
    case_status,
    priority,
    last_error_code
) values (
    '00000000-0000-4000-8000-000000000081',
    'producer-profile:test-source-suggestion:white',
    'producer-profile',
    'profile-producer',
    'producer-style',
    jsonb_build_object(
        'producer', 'Sylvain Langoureau',
        'title', 'Producer profile: Sylvain Langoureau · white',
        'search_subject', 'Sylvain Langoureau white Burgundy'
    ),
    'white',
    'needs-source-review',
    999999999,
    'no-reviewed-source-rule'
);

insert into public.enrichment_research_subscriptions (
    case_id,
    household_id,
    exemplar_wine_id,
    requested_by
) values (
    '00000000-0000-4000-8000-000000000081',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000001'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select throws_ok(
    $$select public.suggest_enrichment_research_source(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000081',
        'https://localhost/private',
        'other'
    )$$,
    '22023',
    'Research source must use a public DNS hostname',
    'Private or local source URLs are rejected before queueing'
);

select is(
    public.suggest_enrichment_research_source(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000081',
        'https://profiles.example/langoureau',
        'technical'
    ) #>> '{items,0,status}',
    'queued',
    'An owner suggestion resumes the generic research queue'
);

reset role;

select ok(
    exists (
        select 1
        from public.enrichment_research_source_suggestions suggestion
        where suggestion.case_id = '00000000-0000-4000-8000-000000000081'
          and suggestion.household_id = '00000000-0000-4000-8000-000000000100'
          and suggestion.suggestion_origin = 'owner'
          and suggestion.source_kind = 'technical'
          and suggestion.suggestion_status = 'pending'
    ),
    'Only the URL and suggestion metadata are stored'
);

set local role service_role;

select is(
    jsonb_array_length(
        public.claim_enrichment_research_cases('source-suggestion-test', 1, 300)
        #> '{0,suggested_sources}'
    ),
    1,
    'A trusted lease receives the pending source without household identity'
);

select public.accept_enrichment_research_source_suggestion(
    '00000000-0000-4000-8000-000000000081',
    (
        select research_case.lease_token
        from public.enrichment_research_cases research_case
        where research_case.id = '00000000-0000-4000-8000-000000000081'
    ),
    (
        select suggestion.id
        from public.enrichment_research_source_suggestions suggestion
        where suggestion.case_id = '00000000-0000-4000-8000-000000000081'
    ),
    'Langoureau technical profile',
    'profiles.example',
    'https://profiles.example/langoureau'
);

reset role;

select ok(
    exists (
        select 1
        from public.enrichment_research_source_suggestions suggestion
        where suggestion.case_id = '00000000-0000-4000-8000-000000000081'
          and suggestion.suggestion_status = 'accepted'
          and suggestion.reviewed_at is not null
    ),
    'A verified candidate records an auditable accepted decision'
);

select ok(
    exists (
        select 1
        from public.enrichment_research_source_rules rule
        join public.enrichment_sources source on source.id = rule.source_id
        join public.enrichment_source_policies policy
          on policy.id = rule.source_policy_id
        where source.source_key = 'submitted-web-' || md5('profiles.example')
          and rule.hostname = 'profiles.example'
          and rule.path_prefix = '/langoureau'
          and rule.subject_aliases @> array['sylvain langoureau']
          and rule.status = 'active'
          and policy.raw_payload_storage_right = 'prohibited'
          and policy.normalized_storage_right = 'prohibited'
    ),
    'Accepted suggestions become narrow pointer-only rules for the exact subject'
);

select is(
    (
        select count(*)
        from information_schema.columns column_info
        where column_info.table_schema = 'public'
          and column_info.table_name = 'enrichment_research_source_suggestions'
          and column_info.column_name in ('raw_payload', 'page_text', 'search_snippet')
    ),
    0::bigint,
    'Search snippets and page bodies have no persistence column'
);

update public.enrichment_research_cases research_case
set
    case_status = 'researching',
    lease_token = '00000000-0000-4000-8000-000000000082',
    leased_by = 'source-suggestion-test',
    lease_expires_at = now() + interval '5 minutes'
where research_case.id = '00000000-0000-4000-8000-000000000081';

set local role service_role;

select is(
    jsonb_array_length(public.record_discovered_enrichment_research_sources(
        '00000000-0000-4000-8000-000000000081',
        '00000000-0000-4000-8000-000000000082',
        jsonb_build_array(
            jsonb_build_object(
                'url', 'https://guide.example/langoureau',
                'kind', 'editorial'
            ),
            jsonb_build_object(
                'url', 'https://technical.example/langoureau',
                'kind', 'technical'
            )
        )
    )),
    2,
    'Automatic discovery can submit several complementary source candidates'
);

reset role;

select ok(
    (
        select bool_and(suggestion.suggestion_origin = 'automatic')
        from public.enrichment_research_source_suggestions suggestion
        where suggestion.case_id = '00000000-0000-4000-8000-000000000081'
          and suggestion.suggestion_status = 'pending'
    ),
    'Automatic source candidates remain distinguishable from owner suggestions'
);

select * from finish();

rollback;
