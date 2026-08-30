begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select ok(
    to_regclass('public.enrichment_profile_review_cases') is not null
    and to_regclass('public.enrichment_profile_review_subscriptions') is not null
    and to_regclass('public.enrichment_profile_review_messages') is not null,
    'Profile review cases, private subscriptions, and private messages are durable'
);

select ok(
    (
        select bool_and(class.relrowsecurity)
        from pg_catalog.pg_class class
        where class.oid in (
            'public.enrichment_profile_review_cases'::regclass,
            'public.enrichment_profile_review_subscriptions'::regclass,
            'public.enrichment_profile_review_messages'::regclass
        )
    ),
    'Every profile review table has RLS enabled'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_enrichment_profile_review_inbox(uuid)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.request_enrichment_profile_review(uuid,uuid,uuid,text,text,text)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.add_enrichment_profile_review_message(uuid,uuid,text,text)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.mark_enrichment_profile_review_seen(uuid,uuid)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.get_wine_profile_review_targets(uuid)',
        'EXECUTE'
    ),
    'Authenticated household members have only the reporter workflow APIs'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'public.update_enrichment_profile_review_case(uuid,text,text,uuid)',
        'EXECUTE'
    )
    and has_function_privilege(
        'service_role',
        'public.update_enrichment_profile_review_case(uuid,text,text,uuid)',
        'EXECUTE'
    ),
    'Only the trusted service can change the shared case status or outcome'
);

select ok(
    not has_table_privilege(
        'authenticated',
        'public.enrichment_profile_review_cases',
        'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
        'authenticated',
        'public.enrichment_profile_review_subscriptions',
        'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
        'authenticated',
        'public.enrichment_profile_review_messages',
        'SELECT,INSERT,UPDATE,DELETE'
    ),
    'Browser roles cannot bypass the reviewed RPC boundary'
);

select is(
    public.install_hierarchical_maturity_knowledge() ->> 'status',
    'active',
    'The test uses an active immutable shared-library version'
);

create temporary table review_subject as
select
    profile.id as profile_id,
    profile.knowledge_version_id,
    version.content_sha256 as version_content_sha256
from public.enrichment_profiles profile
join public.enrichment_place_profiles typed on typed.profile_id = profile.id
join public.enrichment_places place on place.id = typed.place_id
join public.enrichment_knowledge_versions version
  on version.id = profile.knowledge_version_id
where version.status = 'active'
  and profile.review_status = 'reviewed'
order by place.canonical_name, typed.wine_color, profile.id
limit 1;

grant select on table review_subject to authenticated, service_role;

select is(
    (select count(*) from review_subject),
    1::bigint,
    'A stable reviewed profile is available to both test households'
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
select
    projection.id,
    projection.household_id,
    projection.wine_id,
    subject.knowledge_version_id,
    'maturity',
    'curated-inference',
    'regional-style',
    0.78,
    repeat(projection.fingerprint_character, 64),
    jsonb_build_object(
        'state', 'ready',
        'contributions', jsonb_build_array(jsonb_build_object(
            'profile_id', subject.profile_id,
            'layer', 'region',
            'label', 'Bourgogne red'
        ))
    )
from review_subject subject
cross join (
    values
        (
            '00000000-0000-4000-8000-00000000c101'::uuid,
            '00000000-0000-4000-8000-000000000100'::uuid,
            '00000000-0000-4000-8000-000000000110'::uuid,
            'c'
        ),
        (
            '00000000-0000-4000-8000-00000000c102'::uuid,
            '00000000-0000-4000-8000-000000000200'::uuid,
            '00000000-0000-4000-8000-000000000210'::uuid,
            'd'
        )
) projection(id, household_id, wine_id, fingerprint_character);

insert into public.wine_enrichment_projection_profiles (
    projection_id,
    knowledge_version_id,
    profile_id,
    contribution_order
)
select
    projection.id,
    subject.knowledge_version_id,
    subject.profile_id,
    1
from review_subject subject
cross join (
    values
        ('00000000-0000-4000-8000-00000000c101'::uuid),
        ('00000000-0000-4000-8000-00000000c102'::uuid)
) projection(id);

select is(
    (select count(*) from public.wine_enrichment_projection_profiles),
    2::bigint,
    'Both private wines currently rely on the same canonical profile'
);

-- Valid projections created before hierarchical explanations have immutable
-- profile links but no inline `contributions` array.
update public.wine_enrichment_projections
set recommendation = jsonb_build_object(
    'state', 'ready',
    'reasons', jsonb_build_array('A legacy comparable-profile explanation.')
)
where id = '00000000-0000-4000-8000-00000000c101';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select ok(
    jsonb_array_length(
        public.get_wine_profile_review_targets(
            '00000000-0000-4000-8000-000000000110'
        ) -> 'items'
    ) = 1
    and public.get_wine_profile_review_targets(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{items,0,profile_id}' = (select profile_id::text from review_subject),
    'Legacy prose projections expose their exact stored profile link for review'
);

select is(
    public.get_enrichment_profile_review_inbox(
        '00000000-0000-4000-8000-000000000100'
    ) #>> '{items}',
    '[]',
    'A household starts with an empty private review inbox'
);

select is(
    public.request_enrichment_profile_review(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000110',
        (select profile_id from review_subject),
        'drinking-window',
        'This drinking window feels several years too late.',
        'https://example.test/my-tasting-note'
    ) #>> '{items,0,joined_existing}',
    'false',
    'The first report opens a new canonical case'
);

reset role;

select is(
    (select count(*) from public.enrichment_profile_review_cases),
    1::bigint,
    'The first report creates one shared case'
);

select is(
    (
        select count(*)
        from public.enrichment_profile_review_subscriptions subscription
        join public.enrichment_profile_review_messages message
          on message.subscription_id = subscription.id
    ),
    1::bigint,
    'The first reporter receives one private subscription and message'
);

create temporary table first_review_case as
select id
from public.enrichment_profile_review_cases;

grant select on table first_review_case to authenticated, service_role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select is(
    public.request_enrichment_profile_review(
        '00000000-0000-4000-8000-000000000200',
        '00000000-0000-4000-8000-000000000210',
        (select profile_id from review_subject),
        'evidence-problem',
        'The cited evidence does not describe this regional style.',
        null
    ) #>> '{items,0,joined_existing}',
    'true',
    'A second account joins the existing canonical case'
);

reset role;

select is(
    (select count(*) from public.enrichment_profile_review_cases),
    1::bigint,
    'Cross-account reports do not duplicate an open canonical case'
);

select is(
    (select count(*) from public.enrichment_profile_review_subscriptions),
    2::bigint,
    'Each account retains its own private subscription'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select ok(
    (
        public.get_enrichment_profile_review_inbox(
            '00000000-0000-4000-8000-000000000100'
        ) #>> '{items,0,messages,0,comment}'
    ) = 'This drinking window feels several years too late.'
    and public.get_enrichment_profile_review_inbox(
        '00000000-0000-4000-8000-000000000100'
    )::text not like '%cited evidence%',
    'The first reporter sees only their own comments and evidence'
);

select is(
    jsonb_array_length(
        public.add_enrichment_profile_review_message(
            '00000000-0000-4000-8000-000000000100',
            (select id from first_review_case),
            'A second bottle showed the same earlier evolution.',
            'https://example.test/follow-up'
        ) #> '{items,0,messages}'
    ),
    2,
    'A reporter can append supporting information to an open case'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select ok(
    (
        public.get_enrichment_profile_review_inbox(
            '00000000-0000-4000-8000-000000000200'
        ) #>> '{items,0,messages,0,comment}'
    ) = 'The cited evidence does not describe this regional style.'
    and jsonb_array_length(
        public.get_enrichment_profile_review_inbox(
            '00000000-0000-4000-8000-000000000200'
        ) #> '{items,0,messages}'
    ) = 1,
    'The second reporter cannot see the first reporter private thread'
);

select throws_ok(
    $test$
        select public.get_enrichment_profile_review_inbox(
            '00000000-0000-4000-8000-000000000100'
        )
    $test$,
    '42501',
    'Household access is required',
    'A reporter cannot inspect another household review inbox'
);

select throws_ok(
    $test$
        select public.request_enrichment_profile_review(
            '00000000-0000-4000-8000-000000000200',
            '00000000-0000-4000-8000-000000000210',
            gen_random_uuid(),
            'other',
            'This arbitrary profile was never used by the wine.',
            null
        )
    $test$,
    '42501',
    'This published profile is not part of the current guidance for that wine',
    'A browser cannot report an arbitrary profile outside the wine guidance'
);

reset role;
set local role service_role;

select results_eq(
    format(
        'select result ->> ''status'', (result ->> ''notified_reporters'')::integer from (select public.update_enrichment_profile_review_case(%L, ''reviewing'', null, null) result) update_result',
        (select id from first_review_case)
    ),
    $expected$
        values ('reviewing'::text, 2)
    $expected$,
    'A trusted status change notifies every private subscriber'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    (
        public.get_enrichment_profile_review_inbox(
            '00000000-0000-4000-8000-000000000100'
        ) ->> 'unread_count'
    )::integer,
    1,
    'The reporter sees an unread notification when review starts'
);

select is(
    (
        public.mark_enrichment_profile_review_seen(
            '00000000-0000-4000-8000-000000000100',
            (select id from first_review_case)
        ) ->> 'unread_count'
    )::integer,
    0,
    'Opening the case marks its status notification as seen'
);

reset role;
set local role service_role;

select is(
    public.update_enrichment_profile_review_case(
        (select id from first_review_case),
        'resolved',
        'The reviewed profile remains valid; the explanation will be clarified.',
        null
    ) ->> 'status',
    'resolved',
    'The trusted service records a visible immutable outcome'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select results_eq(
    $test$
        select
            inbox #>> '{items,0,status}',
            inbox #>> '{items,0,resolution_summary}',
            (inbox ->> 'unread_count')::integer
        from (
            select public.get_enrichment_profile_review_inbox(
                '00000000-0000-4000-8000-000000000200'
            ) inbox
        ) result
    $test$,
    $expected$
        values (
            'resolved'::text,
            'The reviewed profile remains valid; the explanation will be clarified.'::text,
            1
        )
    $expected$,
    'Every reporter sees the final status and outcome without seeing others comments'
);

select throws_ok(
    format(
        'select public.add_enrichment_profile_review_message(%L, %L, %L, null)',
        '00000000-0000-4000-8000-000000000200',
        (select id from first_review_case),
        'This message arrives after the case was resolved.'
    ),
    '22023',
    'This profile review case is already closed',
    'Closed review threads cannot be silently rewritten'
);

reset role;

select is(
    (
        select version.content_sha256
        from public.enrichment_knowledge_versions version
        join review_subject subject on subject.knowledge_version_id = version.id
    ),
    (select version_content_sha256 from review_subject),
    'Reporting and resolving a case never mutates the published profile'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    public.request_enrichment_profile_review(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000110',
        (select profile_id from review_subject),
        'other',
        'A later observation justifies a separate review cycle.',
        null
    ) #>> '{items,0,joined_existing}',
    'false',
    'A later report opens a new case after the previous outcome is immutable'
);

reset role;

select is(
    (select count(*) from public.enrichment_profile_review_cases),
    2::bigint,
    'The stable subject keeps a complete history of separate review cycles'
);

select * from finish();

rollback;
