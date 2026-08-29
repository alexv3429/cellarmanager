begin;

-- Keep one invalid draft from blocking unrelated publications, but return a
-- bounded server-side diagnostic so operators can fix systemic publication
-- failures instead of leaving owner-reviewed drafts pending indefinitely.
create or replace function public.publish_reviewed_enrichment_research_drafts(
    p_limit integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_candidate record;
    v_results jsonb := '[]'::jsonb;
begin
    if p_limit not between 1 and 5 then
        raise exception using errcode = '22023', message = 'Research publication limit is invalid';
    end if;

    for v_candidate in
        select
            draft.id as draft_id,
            review.id as review_id
        from public.enrichment_research_cases research_case
        join public.enrichment_research_drafts draft
          on draft.case_id = research_case.id
         and draft.draft_status = 'ready'
        join lateral (
            select candidate.id
            from public.enrichment_research_reviews candidate
            join public.enrichment_research_subscriptions subscription
              on subscription.case_id = research_case.id
             and subscription.household_id = candidate.household_id
             and subscription.subscription_status = 'reviewed'
            where candidate.draft_id = draft.id
              and candidate.verdict in ('accepted', 'edited')
            order by candidate.created_at, candidate.id
            limit 1
        ) review on true
        where research_case.case_status = 'owner-reviewed'
        order by research_case.priority desc, research_case.updated_at, research_case.id
        limit p_limit
    loop
        begin
            v_results := v_results || jsonb_build_array(
                public.publish_enrichment_research_draft(
                    v_candidate.draft_id,
                    v_candidate.review_id
                )
            );
        exception
            when others then
                v_results := v_results || jsonb_build_array(jsonb_build_object(
                    'draft_id', v_candidate.draft_id,
                    'status', 'publication-failed',
                    'sqlstate', sqlstate,
                    'error', left(sqlerrm, 240)
                ));
        end;
    end loop;

    return v_results;
end;
$$;

revoke execute
on function public.publish_reviewed_enrichment_research_drafts(integer)
from public, anon, authenticated;

grant execute
on function public.publish_reviewed_enrichment_research_drafts(integer)
to service_role;

commit;
