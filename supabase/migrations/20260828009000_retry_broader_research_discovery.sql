begin;

-- The first generic discovery release only retained pre-classified publishers
-- or domains named after the producer. Broader sources are now admitted as
-- unclassified candidates and checked by the worker before owner review.
-- Resume requests which could not pass that overly narrow first gate.
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
  and research_case.last_error_code in (
      'no-reviewed-source-rule',
      'suggested-sources-unusable'
  );

commit;
