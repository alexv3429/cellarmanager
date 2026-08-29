begin;

-- A request made from raw cellar text stays private and blocked until the
-- owner confirms a canonical wine reference. Once that happens, move only
-- this household's subscription to the canonical shared case. Other
-- households that happen to use the same raw text must confirm independently.
create or replace function private.rebind_enrichment_research_subscription(
    p_case_id uuid,
    p_household_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_case public.enrichment_research_cases%rowtype;
    v_subscription public.enrichment_research_subscriptions%rowtype;
    v_subject jsonb;
    v_target_case_id uuid;
    v_target_status text;
begin
    select research_case.*
    into v_case
    from public.enrichment_research_cases research_case
    where research_case.id = p_case_id
    for update;

    if not found or v_case.case_status <> 'needs-identity-review' then
        return null;
    end if;

    select subscription.*
    into v_subscription
    from public.enrichment_research_subscriptions subscription
    where subscription.case_id = p_case_id
      and subscription.household_id = p_household_id
    for update;

    if not found then
        return null;
    end if;

    v_subject := private.enrichment_research_subject(
        v_subscription.exemplar_wine_id,
        v_case.gap_type
    );

    if v_subject ->> 'identity_status' = 'needs-identity-review' then
        return null;
    end if;

    insert into public.enrichment_research_cases (
        subject_key,
        subject_type,
        gap_type,
        claim_type,
        field_name,
        subject_snapshot,
        place_id,
        producer_id,
        product_id,
        release_id,
        vintage_year,
        wine_color,
        case_status,
        priority,
        requested_at
    ) values (
        v_subject ->> 'subject_key',
        v_subject ->> 'subject_type',
        v_subject ->> 'gap_type',
        v_subject ->> 'claim_type',
        v_subject ->> 'field_name',
        v_subject -> 'snapshot',
        (v_subject ->> 'place_id')::uuid,
        (v_subject ->> 'producer_id')::uuid,
        (v_subject ->> 'product_id')::uuid,
        (v_subject ->> 'release_id')::uuid,
        (v_subject ->> 'vintage_year')::integer,
        v_subject ->> 'wine_color',
        'queued',
        v_case.priority,
        v_case.requested_at
    )
    on conflict (subject_key) do update
    set
        priority = greatest(
            public.enrichment_research_cases.priority,
            excluded.priority
        ),
        case_status = case
            when public.enrichment_research_cases.case_status in ('not-found', 'failed')
                then 'queued'
            else public.enrichment_research_cases.case_status
        end,
        attempt_count = case
            when public.enrichment_research_cases.case_status in ('not-found', 'failed')
                then 0
            else public.enrichment_research_cases.attempt_count
        end,
        next_attempt_at = case
            when public.enrichment_research_cases.case_status in ('not-found', 'failed')
                then null
            else public.enrichment_research_cases.next_attempt_at
        end,
        last_error_code = case
            when public.enrichment_research_cases.case_status in ('not-found', 'failed')
                then null
            else public.enrichment_research_cases.last_error_code
        end,
        updated_at = now()
    returning id, case_status into v_target_case_id, v_target_status;

    insert into public.enrichment_research_subscriptions (
        case_id,
        household_id,
        exemplar_wine_id,
        requested_by,
        subscription_status,
        requested_at,
        notified_at
    ) values (
        v_target_case_id,
        v_subscription.household_id,
        v_subscription.exemplar_wine_id,
        v_subscription.requested_by,
        case when v_target_status = 'published' then 'published' else 'open' end,
        v_subscription.requested_at,
        case
            when v_target_status in ('draft-ready', 'owner-reviewed', 'published')
                then now()
            else null
        end
    )
    on conflict (case_id, household_id) do update
    set
        exemplar_wine_id = excluded.exemplar_wine_id,
        requested_by = excluded.requested_by,
        requested_at = least(
            public.enrichment_research_subscriptions.requested_at,
            excluded.requested_at
        );

    if v_target_case_id <> v_case.id then
        delete from public.enrichment_research_subscriptions subscription
        where subscription.case_id = v_case.id
          and subscription.household_id = v_subscription.household_id;

        delete from public.enrichment_research_cases research_case
        where research_case.id = v_case.id
          and research_case.case_status = 'needs-identity-review'
          and not exists (
              select 1
              from public.enrichment_research_subscriptions remaining
              where remaining.case_id = research_case.id
          );
    end if;

    return v_target_case_id;
end;
$$;

revoke execute
on function private.rebind_enrichment_research_subscription(uuid, uuid)
from public, anon, authenticated;


create or replace function private.resume_enrichment_research_for_wine_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pending record;
begin
    for v_pending in
        select subscription.case_id, subscription.household_id
        from public.enrichment_research_subscriptions subscription
        join public.enrichment_research_cases research_case
          on research_case.id = subscription.case_id
        where subscription.exemplar_wine_id = new.id
          and research_case.case_status = 'needs-identity-review'
    loop
        perform private.rebind_enrichment_research_subscription(
            v_pending.case_id,
            v_pending.household_id
        );
    end loop;

    return new;
end;
$$;

revoke execute
on function private.resume_enrichment_research_for_wine_reference()
from public, anon, authenticated;

drop trigger if exists wines_resume_enrichment_research_after_reference
on public.wines;

create trigger wines_resume_enrichment_research_after_reference
after update of wine_reference_id, wine_reference_type
on public.wines
for each row
when (
    old.wine_reference_id is distinct from new.wine_reference_id
    or old.wine_reference_type is distinct from new.wine_reference_type
)
execute function private.resume_enrichment_research_for_wine_reference();


create or replace function private.resume_enrichment_research_for_producer_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pending record;
begin
    for v_pending in
        select subscription.case_id, subscription.household_id
        from public.enrichment_research_subscriptions subscription
        join public.enrichment_research_cases research_case
          on research_case.id = subscription.case_id
        where subscription.household_id = new.household_id
          and research_case.case_status = 'needs-identity-review'
          and private.normalize_wine_reference_text(
              research_case.subject_snapshot ->> 'producer'
          ) = new.source_producer_normalized
    loop
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

drop trigger if exists producer_preferences_resume_enrichment_research
on public.wine_reference_household_producer_preferences;

create trigger producer_preferences_resume_enrichment_research
after insert or update of producer_id
on public.wine_reference_household_producer_preferences
for each row
execute function private.resume_enrichment_research_for_producer_preference();


-- The inbox may reveal only the representative wine already owned by this
-- household. It gives the UI a direct, actionable route to the existing LWIN
-- review without exposing any shared queue internals.
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
        select 1 from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Household access is required';
    end if;

    select coalesce(jsonb_agg(item.payload order by item.requested_at desc, item.case_id), '[]'::jsonb)
    into v_result
    from (
        select
            subscription.requested_at,
            research_case.id as case_id,
            jsonb_build_object(
                'case_id', research_case.id,
                'exemplar_wine_id', subscription.exemplar_wine_id,
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
            join public.enrichment_sources source on source.id = draft_source.source_id
            join public.enrichment_source_policies policy on policy.id = draft_source.source_policy_id
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
