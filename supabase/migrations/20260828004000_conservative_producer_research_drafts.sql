begin;

-- A producer-wide profile is necessarily broader than a cuvee profile. Keep
-- its evidence confidence below the general research ceiling in both trusted
-- draft ingestion and owner review.
create or replace function private.validate_producer_research_confidence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_row jsonb := to_jsonb(new);
    v_proposal jsonb;
begin
    v_proposal := coalesce(
        v_row -> 'proposal',
        v_row -> 'reviewed_proposal'
    );

    if v_proposal is not null
       and v_proposal ->> 'profile_type' = 'producer-era'
       and (
           jsonb_typeof(v_proposal -> 'confidence') <> 'number'
           or (v_proposal ->> 'confidence')::numeric not between 0 and 0.70
       )
    then
        raise exception using
            errcode = '22023',
            message = 'Producer research confidence must be between 0 and 0.70';
    end if;

    return new;
end;
$$;

revoke execute
on function private.validate_producer_research_confidence()
from public, anon, authenticated;

drop trigger if exists enrichment_research_drafts_producer_confidence
on public.enrichment_research_drafts;

create trigger enrichment_research_drafts_producer_confidence
before insert or update of proposal
on public.enrichment_research_drafts
for each row execute function private.validate_producer_research_confidence();

drop trigger if exists enrichment_research_reviews_producer_confidence
on public.enrichment_research_reviews;

create trigger enrichment_research_reviews_producer_confidence
before insert or update of reviewed_proposal
on public.enrichment_research_reviews
for each row execute function private.validate_producer_research_confidence();


-- Revision 1 was generated before producer-wide/cuvee-specific evidence was
-- separated in the prompt. It is inactive and unreviewed, so preserve it as a
-- superseded audit record and generate a more conservative revision.
update public.enrichment_research_drafts draft
set draft_status = 'superseded'
from public.enrichment_research_cases research_case
where draft.case_id = research_case.id
  and draft.draft_status = 'ready'
  and research_case.case_status = 'draft-ready'
  and research_case.subject_type = 'producer-profile'
  and private.normalize_wine_reference_text(
      research_case.subject_snapshot ->> 'producer'
  ) = 'burgaud'
  and not exists (
      select 1
      from public.enrichment_research_reviews review
      where review.draft_id = draft.id
  );

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
where research_case.case_status = 'draft-ready'
  and research_case.subject_type = 'producer-profile'
  and private.normalize_wine_reference_text(
      research_case.subject_snapshot ->> 'producer'
  ) = 'burgaud'
  and not exists (
      select 1
      from public.enrichment_research_drafts draft
      where draft.case_id = research_case.id
        and draft.draft_status = 'ready'
  );

commit;
