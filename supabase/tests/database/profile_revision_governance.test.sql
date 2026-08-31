begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

select ok(
    to_regclass('public.enrichment_curator_eligibilities') is not null
    and to_regclass('public.enrichment_profile_revisions') is not null
    and to_regclass('public.enrichment_profile_revision_decisions') is not null
    and to_regclass('public.enrichment_profile_governance_events') is not null,
    'Curator grants, revisions, decisions, and audit events are durable'
);

select ok(
    (
        select bool_and(class.relrowsecurity)
        from pg_catalog.pg_class class
        where class.oid in (
            'public.enrichment_curator_eligibilities'::regclass,
            'public.enrichment_profile_revisions'::regclass,
            'public.enrichment_profile_revision_decisions'::regclass,
            'public.enrichment_profile_governance_events'::regclass
        )
    ),
    'Every governance table has RLS enabled'
);

select ok(
    not has_table_privilege(
        'authenticated', 'public.enrichment_profile_revisions',
        'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
        'authenticated', 'public.enrichment_profile_revision_decisions',
        'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
        'authenticated', 'public.enrichment_profile_governance_events',
        'SELECT,INSERT,UPDATE,DELETE'
    ),
    'Browser roles cannot bypass governance RPCs'
);

select ok(
    has_function_privilege(
        'authenticated', 'public.get_enrichment_profile_governance_inbox()', 'EXECUTE'
    )
    and has_function_privilege(
        'authenticated', 'public.propose_enrichment_profile_revision(uuid,jsonb,text[])', 'EXECUTE'
    )
    and has_function_privilege(
        'authenticated', 'public.review_enrichment_profile_revision(uuid,text,text,text[])', 'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated', 'public.publish_approved_enrichment_profile_revisions(integer)', 'EXECUTE'
    )
    and has_function_privilege(
        'service_role', 'public.publish_approved_enrichment_profile_revisions(integer)', 'EXECUTE'
    ),
    'Curators review through browser RPCs while only the trusted service publishes'
);

select is(
    public.install_hierarchical_maturity_knowledge() ->> 'status',
    'active',
    'The test starts from an active reviewed immutable library'
);

create temporary table governance_subject as
select
    profile.id as profile_id,
    profile.knowledge_version_id,
    version.version_number,
    version.content_sha256,
    private.enrichment_profile_review_subject(profile.id) as subject,
    private.enrichment_profile_revision_snapshot(profile.id) as snapshot,
    typed.body
from public.enrichment_profiles profile
join public.enrichment_place_profiles typed on typed.profile_id = profile.id
join public.enrichment_knowledge_versions version
  on version.id = profile.knowledge_version_id
where version.status = 'active'
  and profile.review_status = 'reviewed'
order by profile.id
limit 1;

grant select on table governance_subject to authenticated, service_role;

select is(
    (select count(*) from governance_subject),
    1::bigint,
    'One reviewed place profile is selected for revision'
);

insert into public.enrichment_profile_review_cases (
    id, subject_key, profile_type, subject_title, subject_snapshot,
    reported_profile_id
)
select
    '00000000-0000-4000-8000-00000000d101',
    subject ->> 'subject_key',
    subject ->> 'profile_type',
    subject ->> 'subject_title',
    subject -> 'subject_snapshot',
    profile_id
from governance_subject;

insert into public.enrichment_profile_review_subscriptions (
    id, case_id, household_id, wine_id, requested_by
) values (
    '00000000-0000-4000-8000-00000000d201',
    '00000000-0000-4000-8000-00000000d101',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000001'
), (
    '00000000-0000-4000-8000-00000000d202',
    '00000000-0000-4000-8000-00000000d101',
    '00000000-0000-4000-8000-000000000200',
    '00000000-0000-4000-8000-000000000210',
    '00000000-0000-4000-8000-000000000002'
);

insert into public.enrichment_profile_review_messages (
    subscription_id, message_kind, comment, evidence_url
) values (
    '00000000-0000-4000-8000-00000000d201',
    'drinking-window',
    'The current profile appears too conservative for this place.',
    'https://example.test/report-one'
), (
    '00000000-0000-4000-8000-00000000d202',
    'evidence-problem',
    'A second source documents a lighter structural profile.',
    'https://example.test/report-two'
);

set local role service_role;

select is(
    public.set_enrichment_curator_eligibility(
        '00000000-0000-4000-8000-000000000001',
        'Curator One',
        'active',
        array['place'],
        'Experienced reviewer for place-level maturity and structure profiles.',
        'database-test'
    ) ->> 'status',
    'active',
    'The trusted service grants a scoped curator role'
);

select is(
    public.set_enrichment_curator_eligibility(
        '00000000-0000-4000-8000-000000000002',
        'Curator Two',
        'active',
        array['place'],
        'Independent reviewer for place-level maturity and structure profiles.',
        'database-test'
    ) ->> 'status',
    'active',
    'A second curator receives an independently auditable grant'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';

select is(
    public.get_enrichment_profile_governance_inbox() #>> '{curator,eligible}',
    'false',
    'An ordinary account cannot see the shared governance queue'
);

select throws_ok(
    $test$
        select public.propose_enrichment_profile_revision(
            '00000000-0000-4000-8000-00000000d101',
            '{}'::jsonb,
            array['https://example.test/evidence']
        )
    $test$,
    '42501',
    'An active curator grant for this profile type is required',
    'An ordinary account cannot propose a shared profile revision'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select ok(
    public.get_enrichment_profile_governance_inbox() #>> '{curator,eligible}' = 'true'
    and public.get_enrichment_profile_governance_inbox() #>> '{items,0,reporter_count}' = '2'
    and jsonb_array_length(
        public.get_enrichment_profile_governance_inbox() #> '{items,0,reports}'
    ) = 2,
    'A scoped curator sees the case and anonymized supporting reports'
);

select throws_ok(
    $test$
        select public.propose_enrichment_profile_revision(
            '00000000-0000-4000-8000-00000000d101',
            jsonb_build_object(
                'profile_type', 'place',
                'confidence', (select snapshot -> 'confidence' from governance_subject),
                'rationale', 'This proposal illegally changes canonical identity.',
                'typed', jsonb_set(
                    (select snapshot -> 'typed' from governance_subject),
                    '{wine_color}',
                    '"other"'::jsonb
                )
            ),
            array['https://example.test/evidence']
        )
    $test$,
    '22023',
    'Canonical profile identity fields cannot be revised',
    'A curator cannot alter canonical identity inside a parameter revision'
);

select is(
    public.propose_enrichment_profile_revision(
        '00000000-0000-4000-8000-00000000d101',
        jsonb_build_object(
            'profile_type', 'place',
            'confidence', (select snapshot -> 'confidence' from governance_subject),
            'rationale', 'Two documented sources support a modest correction to body.',
            'typed', jsonb_set(
                (select snapshot -> 'typed' from governance_subject),
                '{body}',
                to_jsonb((
                    select case when body <= 4.5 then body + 0.25 else body - 0.25 end
                    from governance_subject
                ))
            )
        ),
        array['https://example.test/evidence']
    ) ->> 'status',
    'proposed',
    'A curator proposes one bounded attributable correction'
);

reset role;

select is(
    (
        select version.content_sha256
        from public.enrichment_knowledge_versions version
        join governance_subject subject on subject.knowledge_version_id = version.id
    ),
    (select content_sha256 from governance_subject),
    'A proposal never mutates the active shared library'
);

create temporary table first_revision as
select id from public.enrichment_profile_revisions
where case_id = '00000000-0000-4000-8000-00000000d101';
grant select on table first_revision to authenticated, service_role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    public.review_enrichment_profile_revision(
        (select id from first_revision),
        'approve',
        'The bounded correction is supported by the cited evidence.',
        array['https://example.test/curator-one']
    ) ->> 'status',
    'approved',
    'An explicit curator approval makes a conflict-free revision publishable'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select is(
    public.review_enrichment_profile_revision(
        (select id from first_revision),
        'disagree',
        'The body adjustment is plausible but the evidence is not specific enough.',
        array['https://example.test/curator-two']
    ) ->> 'status',
    'disputed',
    'One attributable disagreement blocks publication'
);

reset role;
set local role service_role;

select is(
    public.publish_approved_enrichment_profile_revisions(2) ->> 'count',
    '0',
    'The trusted publisher ignores disputed revisions'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    public.propose_enrichment_profile_revision(
        '00000000-0000-4000-8000-00000000d101',
        jsonb_build_object(
            'profile_type', 'place',
            'confidence', (select snapshot -> 'confidence' from governance_subject),
            'rationale', 'The revised proposal keeps body and acidity changes conservative.',
            'typed', jsonb_set(
                (select snapshot -> 'typed' from governance_subject),
                '{acidity}',
                to_jsonb((
                    select case
                        when (snapshot #>> '{typed,acidity}')::numeric <= 4.5
                            then (snapshot #>> '{typed,acidity}')::numeric + 0.25
                        else (snapshot #>> '{typed,acidity}')::numeric - 0.25
                    end
                    from governance_subject
                ))
            )
        ),
        array['https://example.test/revised-evidence']
    ) ->> 'status',
    'proposed',
    'A disputed proposal is replaced rather than rewritten'
);

reset role;

select is(
    (select revision_status from public.enrichment_profile_revisions where id = (select id from first_revision)),
    'superseded',
    'The disputed proposal remains as immutable superseded history'
);

create temporary table second_revision as
select id from public.enrichment_profile_revisions
where case_id = '00000000-0000-4000-8000-00000000d101'
  and revision_status = 'proposed';
grant select on table second_revision to authenticated, service_role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
    public.review_enrichment_profile_revision(
        (select id from second_revision),
        'approve',
        'The revised bounded correction addresses the earlier disagreement.',
        array['https://example.test/revised-approval']
    ) ->> 'status',
    'approved',
    'The replacement proposal receives a new attributable decision'
);

reset role;
set local role service_role;

select is(
    public.publish_approved_enrichment_profile_revisions(2) #>> '{results,0,status}',
    'published',
    'The service publisher activates an approved conflict-free revision'
);

select is(
    (
        select version.version_number
        from public.enrichment_knowledge_versions version
        where version.status = 'active'
    ),
    (select version_number + 1 from governance_subject),
    'Publication creates the next immutable knowledge version'
);

select is(
    (
        select version.status
        from public.enrichment_knowledge_versions version
        join governance_subject subject on subject.knowledge_version_id = version.id
    ),
    'superseded',
    'The previous knowledge version is retained as superseded history'
);

select is(
    (select case_status from public.enrichment_profile_review_cases where id = '00000000-0000-4000-8000-00000000d101'),
    'resolved',
    'Successful publication resolves the shared report case'
);

select ok(
    (
        select typed.acidity
        from public.enrichment_place_profiles typed
        join public.enrichment_knowledge_versions version
          on version.id = typed.knowledge_version_id
         and version.status = 'active'
        join public.enrichment_profile_review_cases review_case
          on review_case.resolution_profile_id = typed.profile_id
        where review_case.id = '00000000-0000-4000-8000-00000000d101'
    ) is distinct from (
        select (snapshot #>> '{typed,acidity}')::numeric from governance_subject
    ),
    'Only the cloned active profile receives the approved value'
);

select is(
    (
        select typed.acidity
        from public.enrichment_place_profiles typed
        join governance_subject subject on subject.profile_id = typed.profile_id
    ),
    (select (snapshot #>> '{typed,acidity}')::numeric from governance_subject),
    'The predecessor profile remains byte-for-byte historical evidence'
);

select is(
    (select count(*) from public.enrichment_profile_revisions where revision_status = 'published'),
    1::bigint,
    'The published revision retains one before/after history record'
);

select ok(
    (select count(*) from public.enrichment_profile_governance_events where case_id = '00000000-0000-4000-8000-00000000d101') >= 6,
    'Proposal, disagreement, replacement, approval, and publication are auditable'
);

select throws_ok(
    format(
        'update public.enrichment_profile_revision_decisions set rationale = %L where revision_id = %L',
        'Attempted rewrite of an audit decision.',
        (select id from second_revision)
    ),
    '23514',
    'Published governance audit rows are immutable',
    'Curator decisions cannot be rewritten after the fact'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select ok(
    public.get_enrichment_profile_governance_inbox() #>> '{items,0,status}' = 'resolved'
    and jsonb_array_length(
        public.get_enrichment_profile_governance_inbox() #> '{items,0,revisions}'
    ) = 2,
    'The curator UI receives the resolved outcome and complete revision history'
);

select ok(
    jsonb_path_exists(
        public.get_enrichment_profile_governance_inbox(),
        '$.items[0].revisions[*] ? (@.status == "published" && @.published_profile.knowledge_version.status == "active")'
    )
    and jsonb_path_exists(
        public.get_enrichment_profile_governance_inbox(),
        '$.items[0].revisions[*] ? (@.status == "superseded")'
    ),
    'Before/after snapshots expose active and superseded immutable versions'
);

select * from finish();

rollback;
