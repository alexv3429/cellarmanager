begin;

-- The source-coverage migration can be applied moments before the matching
-- worker deployment. Retry only these inactive producer requests after the
-- conservative producer prompt and validator are available.
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
where research_case.case_status = 'retrying'
  and research_case.last_error_code = 'research-worker-error'
  and research_case.subject_type = 'producer-profile'
  and private.normalize_wine_reference_text(
      research_case.subject_snapshot ->> 'producer'
  ) = any(array[
      'burgaud',
      'chagnoleau',
      'chateau de cazeneuve'
  ]);

commit;
