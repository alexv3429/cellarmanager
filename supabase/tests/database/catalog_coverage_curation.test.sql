begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
    to_regprocedure('public.get_shared_knowledge_curation_queue(integer)')
        is not null,
    'Shared knowledge curation has an explicit service API'
);

select ok(
    has_function_privilege(
        'service_role',
        'public.get_shared_knowledge_curation_queue(integer)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'public.get_shared_knowledge_curation_queue(integer)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'anon',
        'public.get_shared_knowledge_curation_queue(integer)',
        'EXECUTE'
    ),
    'Only the trusted service can inspect cross-household curation demand'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select ok(
    (
        select item ? 'specificity'
           and item ? 'profile_layers'
           and item ? 'profile_warnings'
           and jsonb_typeof(item -> 'profile_layers') = 'array'
        from jsonb_array_elements(
            public.get_household_maturity_overview(
                '00000000-0000-4000-8000-000000000100'
            )
        ) item
        where item ->> 'wine_id' =
            '00000000-0000-4000-8000-000000000110'
    ),
    'Household coverage reports exact projection trace fields even while pending'
);

select throws_ok(
    $test$
        select public.get_shared_knowledge_curation_queue(10)
    $test$,
    '42501',
    'permission denied for function get_shared_knowledge_curation_queue',
    'A household member cannot inspect the global queue'
);

reset role;

-- The same normalized wine in two households proves aggregation without
-- exposing either household identifier.
update public.wines
set
    producer = 'Domaine Test',
    cuvee = 'Cuvée Offline',
    vintage = 2020,
    color = 'red',
    appellation = 'Unknown Test AOP',
    area = 'Test Region'
where id = '00000000-0000-4000-8000-000000000210';

update public.wines
set
    appellation = 'Unknown Test AOP',
    area = 'Test Region'
where id = '00000000-0000-4000-8000-000000000110';

update public.enrichment_demands
set
    demand_status = 'needs-review',
    last_error_code = 'unsupported-place-profile',
    updated_at = now()
where capability = 'maturity'
  and wine_id in (
      '00000000-0000-4000-8000-000000000110',
      '00000000-0000-4000-8000-000000000210'
  );

set local role service_role;

select is(
    (
        select (item ->> 'affected_households')::integer
        from jsonb_array_elements(
            public.get_shared_knowledge_curation_queue(100)
        ) item
        where item ->> 'gap_type' = 'fact-grapes'
          and item ->> 'subject_label' like 'Domaine Test — Cuvée Offline%'
    ),
    2,
    'Equal fact gaps aggregate across households by normalized wine subject'
);

select is(
    (
        select (item ->> 'affected_bottles')::integer
        from jsonb_array_elements(
            public.get_shared_knowledge_curation_queue(100)
        ) item
        where item ->> 'gap_type' = 'profile-place'
          and item ->> 'subject_label' = 'Unknown Test AOP · red'
    ),
    7,
    'Place-profile priority counts all affected bottles'
);

select ok(
    (
        select not item ? 'household_id'
           and not item ? 'wine_id'
        from jsonb_array_elements(
            public.get_shared_knowledge_curation_queue(1)
        ) item
        limit 1
    ),
    'Global queue output does not expose household or wine identifiers'
);

select is(
    jsonb_array_length(public.get_shared_knowledge_curation_queue(1)),
    1,
    'The bounded queue honors its requested limit'
);

select throws_ok(
    $test$
        select public.get_shared_knowledge_curation_queue(0)
    $test$,
    '22023',
    'Curation queue limit must be between 1 and 500',
    'The service cannot request an unbounded invalid queue'
);

select ok(
    (
        select bool_and(
            (item ->> 'priority_score')::bigint > 0
            and item ->> 'status' = 'open'
        )
        from jsonb_array_elements(
            public.get_shared_knowledge_curation_queue(100)
        ) item
    ),
    'Every curation item has an explicit open state and positive impact score'
);

select * from finish();

rollback;
