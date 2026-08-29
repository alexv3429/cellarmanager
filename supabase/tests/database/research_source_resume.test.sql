begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

select ok(
    exists (
        select 1
        from public.enrichment_research_source_rules rule
        join public.enrichment_sources source on source.id = rule.source_id
        join public.enrichment_source_policies policy
          on policy.id = rule.source_policy_id
        where source.source_key = 'dureuil-janthial-official'
          and rule.status = 'active'
          and policy.status = 'reviewed'
          and rule.hostname = 'www.dureuil-janthial.fr'
          and 'dureuil janthial' = any(rule.subject_aliases)
    ),
    'Dureuil research uses a reviewed, narrowly attributed source rule'
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
    last_error_code
) values
    (
        '00000000-0000-4000-8000-000000000071',
        'producer-profile:test-dureuil-resume:white',
        'producer-profile',
        'profile-producer',
        'producer-style',
        jsonb_build_object('producer', 'Dureuil-Janthial'),
        'white',
        'needs-source-review',
        'no-reviewed-source-rule'
    ),
    (
        '00000000-0000-4000-8000-000000000072',
        'producer-profile:test-unrelated-resume:white',
        'producer-profile',
        'profile-producer',
        'producer-style',
        jsonb_build_object('producer', 'Unrelated Producer'),
        'white',
        'needs-source-review',
        'no-reviewed-source-rule'
    );

update public.enrichment_research_source_rules rule
set status = 'active'
from public.enrichment_sources source
where source.id = rule.source_id
  and source.source_key = 'dureuil-janthial-official';

select is(
    (
        select research_case.case_status
        from public.enrichment_research_cases research_case
        where research_case.id = '00000000-0000-4000-8000-000000000071'
    ),
    'queued',
    'A reviewed source rule automatically resumes its compatible request'
);

select is(
    (
        select research_case.case_status
        from public.enrichment_research_cases research_case
        where research_case.id = '00000000-0000-4000-8000-000000000072'
    ),
    'needs-source-review',
    'A source rule does not resume unrelated producer research'
);

select * from finish();

rollback;
