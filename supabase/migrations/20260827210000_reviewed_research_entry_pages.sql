begin;

-- A reviewed source rule doubles as a deterministic entry page. Search may
-- add pages inside the same boundary, but the core workflow must not depend on
-- a general search provider when the authoritative page is already known.
update public.enrichment_research_source_rules rule
set path_prefix = '/nos-vins'
where rule.source_id = private.enrichment_seed_uuid(
        'source:jean-marc-burgaud-official'
    )
  and rule.hostname = 'jean-marc-burgaud.com'
  and rule.path_prefix = '/';

commit;
