begin;

-- The official Dureuil-Janthial page publishes estate history, practices,
-- appellations, and a producer-wide description. It uses an age gate; the
-- worker still receives the server-rendered content and removes hidden HTML
-- before synthesis. Only a URL pointer and reviewed derived profile are kept.
insert into public.enrichment_sources (
    id,
    source_key,
    source_name,
    source_kind,
    homepage_url
) values (
    private.enrichment_seed_uuid('source:dureuil-janthial-official'),
    'dureuil-janthial-official',
    'Domaine Dureuil-Janthial official site',
    'producer',
    'https://www.dureuil-janthial.fr/'
)
on conflict (id) do nothing;

insert into public.enrichment_source_policies (
    id,
    source_id,
    policy_version,
    status,
    effective_from,
    terms_checked_on,
    evidence_url,
    display_right,
    normalized_storage_right,
    raw_payload_storage_right,
    offline_sync_right,
    retention_right,
    cross_household_reuse_right,
    attribution_text,
    notes
) values (
    private.enrichment_seed_uuid('policy:dureuil-janthial-official:v1'),
    private.enrichment_seed_uuid('source:dureuil-janthial-official'),
    1,
    'reviewed',
    '2026-08-28',
    '2026-08-28',
    'https://www.dureuil-janthial.fr/',
    'allowed',
    'prohibited',
    'prohibited',
    'prohibited',
    'allowed',
    'allowed',
    'Domaine Dureuil-Janthial',
    'Pointer-only citation and short-lived in-memory analysis of the official producer page. The age gate does not prevent server retrieval; hidden off-screen HTML is excluded before synthesis. Source HTML and search payloads are not retained.'
)
on conflict (id) do nothing;

insert into public.enrichment_research_source_rules (
    id,
    source_id,
    source_policy_id,
    hostname,
    path_prefix,
    subject_types,
    subject_aliases,
    claim_types,
    search_query_template,
    max_pages
) values (
    private.enrichment_seed_uuid('research-rule:dureuil-janthial-official:v1'),
    private.enrichment_seed_uuid('source:dureuil-janthial-official'),
    private.enrichment_seed_uuid('policy:dureuil-janthial-official:v1'),
    'www.dureuil-janthial.fr',
    '/',
    array['producer-profile'],
    array[
        'dureuil janthial',
        'domaine dureuil janthial',
        'domaine vincent dureuil janthial',
        'vincent dureuil janthial'
    ],
    array['producer-style'],
    'site:dureuil-janthial.fr {subject} domaine vins style',
    1
)
on conflict (id) do nothing;


-- Adding or reactivating a reviewed rule must resume every compatible source
-- review automatically. Source coverage is not tied to one-off data migrations.
create or replace function private.resume_enrichment_research_for_source_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.status = 'active' then
        update public.enrichment_research_cases research_case
        set
            case_status = 'queued',
            attempt_count = 0,
            next_attempt_at = null,
            lease_token = null,
            leased_by = null,
            lease_expires_at = null,
            last_error_code = null,
            updated_at = now()
        where research_case.case_status = 'needs-source-review'
          and research_case.subject_type = any(new.subject_types)
          and research_case.claim_type = any(new.claim_types)
          and (
              cardinality(new.subject_aliases) = 0
              or private.normalize_wine_reference_text(
                  research_case.subject_snapshot ->> 'producer'
              ) = any(new.subject_aliases)
          );
    end if;

    return new;
end;
$$;

revoke execute
on function private.resume_enrichment_research_for_source_rule()
from public, anon, authenticated;

drop trigger if exists enrichment_research_source_rules_resume_cases
on public.enrichment_research_source_rules;

create trigger enrichment_research_source_rules_resume_cases
after insert or update of status, subject_types, subject_aliases, claim_types
on public.enrichment_research_source_rules
for each row
execute function private.resume_enrichment_research_for_source_rule();

-- The rule was inserted before the trigger existed in this migration, so
-- resume the current Dureuil request once. Future rules use the trigger above.
update public.enrichment_research_cases research_case
set
    case_status = 'queued',
    attempt_count = 0,
    next_attempt_at = null,
    lease_token = null,
    leased_by = null,
    lease_expires_at = null,
    last_error_code = null,
    updated_at = now()
where research_case.case_status = 'needs-source-review'
  and research_case.subject_type = 'producer-profile'
  and private.normalize_wine_reference_text(
      research_case.subject_snapshot ->> 'producer'
  ) = any(array[
      'dureuil janthial',
      'domaine dureuil janthial',
      'domaine vincent dureuil janthial',
      'vincent dureuil janthial'
  ]);

commit;
