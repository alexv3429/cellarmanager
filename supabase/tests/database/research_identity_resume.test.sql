begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select ok(
    to_regprocedure(
        'private.rebind_enrichment_research_subscription(uuid,uuid)'
    ) is not null,
    'Pending research has a private canonical-identity rebinding path'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_enrichment_research_producer_candidates(uuid,uuid)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.confirm_enrichment_research_producer_identity(uuid,uuid,text)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'anon',
        'public.confirm_enrichment_research_producer_identity(uuid,uuid,text)',
        'EXECUTE'
    ),
    'Only authenticated clients can enter the reviewed producer-identity path'
);

insert into public.wines (
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    format_ml
) values
    (
        '00000000-0000-4000-8000-00000000011f',
        '00000000-0000-4000-8000-000000000100',
        'Cazeneuve',
        'Le Causse',
        2022,
        'red',
        750
    ),
    (
        '00000000-0000-4000-8000-000000000120',
        '00000000-0000-4000-8000-000000000100',
        'Cazeneuve',
        'Le Roc des Mates',
        2020,
        'red',
        750
    );

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    (
        public.request_enrichment_research(
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-00000000011f',
            'profile-producer',
            100
        ) #>> '{items,0,status}'
    ),
    'needs-identity-review',
    'Raw producer text remains blocked until the owner confirms an identity'
);

select is(
    (
        public.get_household_enrichment_research_inbox(
            '00000000-0000-4000-8000-000000000100'
        ) #>> '{items,0,exemplar_wine_id}'
    ),
    '00000000-0000-4000-8000-00000000011f',
    'The private inbox exposes its own representative wine for identity review'
);

reset role;

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
) values (
    '00000000-0000-4000-8000-0000000008f0',
    'liv-ex-lwin',
    repeat('f', 64),
    'producer-identity-fixture.xlsx',
    '2026-08-27T20:00:00Z',
    '2026-08-27T19:00:00',
    2,
    2,
    2,
    0,
    0,
    'active',
    true,
    '2026-08-27T20:01:00Z'
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
    colour,
    product_type,
    designation,
    vintage_configuration
) values
    (
        '00000000-0000-4000-8000-0000000008f0',
        '1999901',
        2,
        'live',
        'Chateau de Cazeneuve, Roc Mates, Languedoc',
        'de Cazeneuve',
        'Roc Mates',
        'France',
        'Languedoc',
        'Red',
        'Wine',
        'AOP',
        'sequential'
    ),
    (
        '00000000-0000-4000-8000-0000000008f0',
        '1999902',
        3,
        'live',
        'Chateau de Cazeneuve, Sang Calvaire, Languedoc',
        'de Cazeneuve',
        'Sang Calvaire',
        'France',
        'Languedoc',
        'Red',
        'Wine',
        'AOP',
        'sequential'
    );

create temporary table pending_identity_case as
select subscription.case_id
from public.enrichment_research_subscriptions subscription
where subscription.exemplar_wine_id =
    '00000000-0000-4000-8000-00000000011f';

grant select on table pending_identity_case to authenticated;

-- Reproduce a real correction made after the request was created: the case
-- snapshot still says "Cazeneuve", while the wine now carries the full name.
update public.wines wine
set producer = 'Chateau de Cazeneuve'
where wine.id = '00000000-0000-4000-8000-00000000011f';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    (
        public.get_enrichment_research_producer_candidates(
            '00000000-0000-4000-8000-000000000100',
            (
                select pending.case_id
                from pending_identity_case pending
            )
        ) #>> '{candidates,0,canonical_name}'
    ),
    'de Cazeneuve',
    'Producer review finds a canonical LWIN producer even when the cuvee is absent'
);

select ok(
    not exists (
        select 1
        from jsonb_array_elements(
            public.get_enrichment_research_producer_candidates(
                '00000000-0000-4000-8000-000000000100',
                (
                    select pending.case_id
                    from pending_identity_case pending
                )
            ) -> 'candidates'
        ) candidate(value)
        where candidate.value ->> 'canonical_name' = 'Chateau'
    ),
    'Generic estate words cannot become producer identity candidates'
);

select is(
    (
        public.confirm_enrichment_research_producer_identity(
            '00000000-0000-4000-8000-000000000100',
            (
                select pending.case_id
                from pending_identity_case pending
            ),
            'de cazeneuve'
        ) #>> '{items,0,status}'
    ),
    'queued',
    'Confirming the producer-level identity resumes the blocked request'
);

select is(
    (
        select count(*)::integer
        from jsonb_array_elements_text(
            public.get_household_enrichment_research_inbox(
                '00000000-0000-4000-8000-000000000100'
            ) #> '{items,0,matching_wine_ids}'
        ) matching(wine_id)
        where matching.wine_id in (
            '00000000-0000-4000-8000-00000000011f',
            '00000000-0000-4000-8000-000000000120'
        )
    ),
    2,
    'The inbox links canonical research to every matching local producer alias'
);

reset role;

select is(
    (
        select count(*)::integer
        from public.wine_reference_household_producer_preferences preference
        where preference.household_id =
            '00000000-0000-4000-8000-000000000100'
          and preference.source_producer_normalized in (
              'cazeneuve',
              'chateau de cazeneuve'
          )
    ),
    2,
    'Identity confirmation preserves the requested alias and corrected producer name'
);

select is(
    (
        select research_case.case_status
        from public.enrichment_research_cases research_case
        join public.enrichment_research_subscriptions subscription
          on subscription.case_id = research_case.id
        where subscription.exemplar_wine_id =
            '00000000-0000-4000-8000-00000000011f'
          and subscription.household_id =
            '00000000-0000-4000-8000-000000000100'
    ),
    'queued',
    'The resumed request remains available to the requesting household'
);

select is(
    (
        select research_case.producer_id
        from public.enrichment_research_cases research_case
        join public.enrichment_research_subscriptions subscription
          on subscription.case_id = research_case.id
        where subscription.exemplar_wine_id =
            '00000000-0000-4000-8000-00000000011f'
          and subscription.household_id =
            '00000000-0000-4000-8000-000000000100'
    ),
    (
        select producer.id
        from public.wine_reference_producers producer
        where producer.canonical_name = 'de Cazeneuve'
    ),
    'The resumed request is attached to the owner-confirmed canonical producer'
);

select * from finish();

rollback;
