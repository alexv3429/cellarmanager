begin;

-- Identity review can start with a short cellar alias and finish after the
-- representative wine has been corrected to a fuller producer name. Preserve
-- both owner-confirmed spellings so the shared profile applies to the whole
-- local producer group, not only to the edited exemplar.
create or replace function private.resume_enrichment_research_for_producer_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pending record;
    v_requested_producer_normalized text;
begin
    for v_pending in
        select
            subscription.case_id,
            subscription.household_id,
            research_case.subject_snapshot ->> 'producer' as requested_producer
        from public.enrichment_research_subscriptions subscription
        join public.enrichment_research_cases research_case
          on research_case.id = subscription.case_id
        join public.wines wine
          on wine.id = subscription.exemplar_wine_id
         and wine.household_id = subscription.household_id
        where subscription.household_id = new.household_id
          and research_case.case_status = 'needs-identity-review'
          and private.normalize_wine_reference_text(wine.producer) =
              new.source_producer_normalized
    loop
        v_requested_producer_normalized :=
            private.normalize_wine_reference_text(v_pending.requested_producer);

        if v_requested_producer_normalized <> ''
           and v_requested_producer_normalized <>
               new.source_producer_normalized
        then
            insert into public.wine_reference_household_producer_preferences (
                household_id,
                source_producer_normalized,
                source_producer_text,
                producer_id,
                decided_by
            ) values (
                new.household_id,
                v_requested_producer_normalized,
                trim(v_pending.requested_producer),
                new.producer_id,
                new.decided_by
            )
            on conflict (household_id, source_producer_normalized)
            do nothing;
        end if;

        perform private.rebind_enrichment_research_subscription(
            v_pending.case_id,
            v_pending.household_id
        );
    end loop;

    return new;
end;
$$;

revoke execute
on function private.resume_enrichment_research_for_producer_preference()
from public, anon, authenticated;


-- The inbox exposes only this household's matching wine IDs. This lets the
-- catalog associate a canonical research case with every confirmed local
-- producer alias without exposing shared-case internals or other cellars.
create or replace function public.get_household_enrichment_research_inbox(
    p_household_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Household access is required';
    end if;

    select coalesce(
        jsonb_agg(item.payload order by item.requested_at desc, item.case_id),
        '[]'::jsonb
    )
    into v_result
    from (
        select
            subscription.requested_at,
            research_case.id as case_id,
            jsonb_build_object(
                'case_id', research_case.id,
                'exemplar_wine_id', subscription.exemplar_wine_id,
                'matching_wine_ids', coalesce(
                    matching_wines.items,
                    jsonb_build_array(subscription.exemplar_wine_id)
                ),
                'subject_key', research_case.subject_key,
                'subject_type', research_case.subject_type,
                'gap_type', research_case.gap_type,
                'status', research_case.case_status,
                'subject', research_case.subject_snapshot,
                'requested_at', subscription.requested_at,
                'notified_at', subscription.notified_at,
                'seen_at', subscription.seen_at,
                'subscription_status', subscription.subscription_status,
                'last_error_code', research_case.last_error_code,
                'draft', case when draft.id is null then null else jsonb_build_object(
                    'id', draft.id,
                    'revision', draft.revision,
                    'proposal_kind', draft.proposal_kind,
                    'proposal', draft.proposal,
                    'rationale', draft.rationale,
                    'confidence', draft.confidence,
                    'synthesis_model', draft.synthesis_model,
                    'created_at', draft.created_at,
                    'sources', coalesce(sources.items, '[]'::jsonb),
                    'review', review.payload
                ) end
            ) as payload
        from public.enrichment_research_subscriptions subscription
        join public.enrichment_research_cases research_case
          on research_case.id = subscription.case_id
        left join lateral (
            select jsonb_agg(wine.id order by wine.id) as items
            from public.wines wine
            left join public.wine_reference_household_producer_preferences preference
              on preference.household_id = wine.household_id
             and preference.source_producer_normalized =
                 private.normalize_wine_reference_text(wine.producer)
            where wine.household_id = subscription.household_id
              and (
                  wine.id = subscription.exemplar_wine_id
                  or (
                      research_case.subject_type = 'producer-profile'
                      and research_case.producer_id is not null
                      and preference.producer_id = research_case.producer_id
                  )
              )
        ) matching_wines on true
        left join lateral (
            select candidate.*
            from public.enrichment_research_drafts candidate
            where candidate.case_id = research_case.id
              and candidate.draft_status in ('ready', 'published')
            order by candidate.revision desc
            limit 1
        ) draft on true
        left join lateral (
            select jsonb_agg(jsonb_build_object(
                'name', source.source_name,
                'url', draft_source.source_record_url,
                'retrieved_at', draft_source.retrieved_at,
                'attribution', policy.attribution_text
            ) order by source.source_name, draft_source.source_record_url) as items
            from public.enrichment_research_draft_sources draft_source
            join public.enrichment_sources source
              on source.id = draft_source.source_id
            join public.enrichment_source_policies policy
              on policy.id = draft_source.source_policy_id
            where draft_source.draft_id = draft.id
        ) sources on true
        left join lateral (
            select jsonb_build_object(
                'id', candidate.id,
                'verdict', candidate.verdict,
                'proposal', candidate.reviewed_proposal,
                'note', candidate.note,
                'created_at', candidate.created_at
            ) as payload
            from public.enrichment_research_reviews candidate
            where candidate.draft_id = draft.id
              and candidate.household_id = p_household_id
            order by candidate.created_at desc, candidate.id desc
            limit 1
        ) review on true
        where subscription.household_id = p_household_id
    ) item;

    return jsonb_build_object(
        'status', 'available',
        'items', v_result,
        'unread_count', (
            select count(*)::integer
            from public.enrichment_research_subscriptions subscription
            where subscription.household_id = p_household_id
              and subscription.notified_at is not null
              and subscription.seen_at is null
        )
    );
end;
$$;

revoke all
on function public.get_household_enrichment_research_inbox(uuid)
from public, anon;

grant execute
on function public.get_household_enrichment_research_inbox(uuid)
to authenticated;

commit;
