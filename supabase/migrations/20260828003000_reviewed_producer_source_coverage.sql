begin;

-- Frantz Chagnoleau's own site is currently unavailable. The Bourgogne du Sud
-- artisan-vintner association preserves an attributed producer page with the
-- estate history, practices, appellations, and direct contact details. Only a
-- URL pointer and a reviewed derived profile may be retained.
insert into public.enrichment_sources (
    id,
    source_key,
    source_name,
    source_kind,
    homepage_url
) values (
    private.enrichment_seed_uuid(
        'source:frantz-chagnoleau-artisans-vignerons'
    ),
    'frantz-chagnoleau-artisans-vignerons',
    'Domaine Frantz Chagnoleau · Artisans Vignerons de Bourgogne du Sud',
    'producer',
    'https://www.artisans-vignerons-bourgogne-sud.com/artisans/domaine_frantz_chagnoleau.php'
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
    private.enrichment_seed_uuid(
        'policy:frantz-chagnoleau-artisans-vignerons:v1'
    ),
    private.enrichment_seed_uuid(
        'source:frantz-chagnoleau-artisans-vignerons'
    ),
    1,
    'reviewed',
    '2026-08-28',
    '2026-08-28',
    'https://www.artisans-vignerons-bourgogne-sud.com/artisans/domaine_frantz_chagnoleau.php',
    'allowed',
    'prohibited',
    'prohibited',
    'prohibited',
    'allowed',
    'allowed',
    'Domaine Frantz Chagnoleau · Artisans Vignerons de Bourgogne du Sud',
    'Pointer-only citation and short-lived in-memory analysis. The association page attributes first-person estate information and links the producer site; source HTML and search payloads are not retained.'
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
    private.enrichment_seed_uuid(
        'research-rule:frantz-chagnoleau-artisans-vignerons:v1'
    ),
    private.enrichment_seed_uuid(
        'source:frantz-chagnoleau-artisans-vignerons'
    ),
    private.enrichment_seed_uuid(
        'policy:frantz-chagnoleau-artisans-vignerons:v1'
    ),
    'www.artisans-vignerons-bourgogne-sud.com',
    '/artisans/domaine_frantz_chagnoleau.php',
    array['producer-profile'],
    array[
        'chagnoleau',
        'domaine chagnoleau',
        'domaine frantz chagnoleau',
        'frantz chagnoleau'
    ],
    array['producer-style'],
    'site:artisans-vignerons-bourgogne-sud.com {subject} domaine style vins',
    1
)
on conflict (id) do nothing;


-- Château de Cazeneuve publishes its estate history, terroir, producer-era
-- change, varieties, and Le Causse description on its official site. The root
-- page is the deterministic entry point; optional discovery remains confined
-- to that same official host.
insert into public.enrichment_sources (
    id,
    source_key,
    source_name,
    source_kind,
    homepage_url
) values (
    private.enrichment_seed_uuid('source:chateau-cazeneuve-official'),
    'chateau-cazeneuve-official',
    'Château de Cazeneuve official site',
    'producer',
    'https://www.chateaucazeneuve.com/'
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
    private.enrichment_seed_uuid('policy:chateau-cazeneuve-official:v1'),
    private.enrichment_seed_uuid('source:chateau-cazeneuve-official'),
    1,
    'reviewed',
    '2026-08-28',
    '2026-08-28',
    'https://www.chateaucazeneuve.com/',
    'allowed',
    'prohibited',
    'prohibited',
    'prohibited',
    'allowed',
    'allowed',
    'Château de Cazeneuve',
    'Pointer-only citation and short-lived in-memory analysis of the official producer site. Source HTML and search-provider payloads are not retained.'
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
    private.enrichment_seed_uuid('research-rule:chateau-cazeneuve-official:v1'),
    private.enrichment_seed_uuid('source:chateau-cazeneuve-official'),
    private.enrichment_seed_uuid('policy:chateau-cazeneuve-official:v1'),
    'www.chateaucazeneuve.com',
    '/',
    array['producer-profile'],
    array['cazeneuve', 'chateau de cazeneuve', 'de cazeneuve'],
    array['producer-style'],
    'site:chateaucazeneuve.com {subject} domaine terroir vins style',
    3
)
on conflict (id) do nothing;


-- A request that stopped only because one of these reviewed rules did not yet
-- exist can safely return to the bounded queue.
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
      'chagnoleau',
      'domaine chagnoleau',
      'domaine frantz chagnoleau',
      'frantz chagnoleau',
      'cazeneuve',
      'chateau de cazeneuve',
      'de cazeneuve'
  ]);

commit;
