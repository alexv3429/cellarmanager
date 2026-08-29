begin;

-- Broader, page-validated discovery can now revisit every request that was
-- paused under the original narrow source policy. This is a one-time workflow
-- upgrade, not a producer allowlist: future requests enter the generic queue
-- directly.
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
where research_case.case_status = 'needs-source-review';

commit;
