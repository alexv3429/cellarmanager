begin;

create or replace function private.prevent_enrichment_governance_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception using
        errcode = '23514',
        message = 'Published governance audit rows are immutable';
end;
$$;

revoke execute
on function private.prevent_enrichment_governance_audit_change()
from public, anon, authenticated;

create trigger enrichment_profile_revision_decisions_immutable
before update or delete on public.enrichment_profile_revision_decisions
for each row execute function private.prevent_enrichment_governance_audit_change();

create trigger enrichment_profile_governance_events_immutable
before update or delete on public.enrichment_profile_governance_events
for each row execute function private.prevent_enrichment_governance_audit_change();


create or replace function private.protect_closed_enrichment_profile_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.revision_status in ('superseded', 'published') then
        raise exception using
            errcode = '23514',
            message = 'Closed profile revisions are immutable';
    end if;
    if tg_op = 'DELETE' then
        raise exception using
            errcode = '23514',
            message = 'Profile revision history cannot be deleted';
    end if;
    return new;
end;
$$;

revoke execute
on function private.protect_closed_enrichment_profile_revision()
from public, anon, authenticated;

create trigger enrichment_profile_revisions_protect_history
before update or delete on public.enrichment_profile_revisions
for each row execute function private.protect_closed_enrichment_profile_revision();


create or replace function public.get_enrichment_profile_governance_inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_curator public.enrichment_curator_eligibilities%rowtype;
    v_case record;
    v_profile_id uuid;
    v_items jsonb := '[]'::jsonb;
    v_reports jsonb;
    v_revisions jsonb;
    v_events jsonb;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    select curator.* into v_curator
    from public.enrichment_curator_eligibilities curator
    where curator.user_id = v_user_id;

    if not found then
        return jsonb_build_object(
            'status', 'available',
            'curator', jsonb_build_object('eligible', false, 'status', 'unassigned'),
            'items', '[]'::jsonb
        );
    end if;

    if v_curator.eligibility_status <> 'active' then
        return jsonb_build_object(
            'status', 'available',
            'curator', jsonb_build_object(
                'eligible', false,
                'status', v_curator.eligibility_status,
                'display_name', v_curator.display_name,
                'profile_scopes', v_curator.profile_scopes,
                'rationale', v_curator.rationale,
                'granted_by', v_curator.granted_by,
                'granted_at', v_curator.granted_at
            ),
            'items', '[]'::jsonb
        );
    end if;

    for v_case in
        select review_case.*
        from public.enrichment_profile_review_cases review_case
        where review_case.profile_type = any(v_curator.profile_scopes)
        order by
            case review_case.case_status
                when 'reviewing' then 0
                when 'open' then 1
                else 2
            end,
            review_case.updated_at desc,
            review_case.id
    loop
        select profile.id into v_profile_id
        from public.enrichment_profiles profile
        join public.enrichment_knowledge_versions version
          on version.id = profile.knowledge_version_id
         and version.status = 'active'
        cross join lateral (
            select private.enrichment_profile_review_subject(profile.id) as subject
        ) resolved
        where resolved.subject ->> 'subject_key' = v_case.subject_key
        limit 1;

        if v_profile_id is null then
            v_profile_id := coalesce(v_case.resolution_profile_id, v_case.reported_profile_id);
        end if;

        select coalesce(jsonb_agg(jsonb_build_object(
            'kind', message.message_kind,
            'comment', message.comment,
            'evidence_url', message.evidence_url,
            'created_at', message.created_at
        ) order by message.created_at, message.id), '[]'::jsonb)
        into v_reports
        from public.enrichment_profile_review_subscriptions subscription
        join public.enrichment_profile_review_messages message
          on message.subscription_id = subscription.id
        where subscription.case_id = v_case.id;

        select coalesce(jsonb_agg(jsonb_build_object(
            'id', revision.id,
            'status', revision.revision_status,
            'predecessor_profile', private.enrichment_profile_revision_snapshot(revision.predecessor_profile_id),
            'proposal', revision.proposed_payload,
            'proposal_sha256', revision.proposal_sha256,
            'evidence_urls', revision.evidence_urls,
            'proposed_by', proposer.display_name,
            'proposed_at', revision.proposed_at,
            'superseded_at', revision.superseded_at,
            'published_at', revision.published_at,
            'published_profile', case
                when revision.published_profile_id is null then null
                else private.enrichment_profile_revision_snapshot(revision.published_profile_id)
            end,
            'decisions', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'id', decision.id,
                    'verdict', decision.verdict,
                    'rationale', decision.rationale,
                    'evidence_urls', decision.evidence_urls,
                    'curator', decision_curator.display_name,
                    'decided_at', decision.decided_at
                ) order by decision.decision_sequence)
                from public.enrichment_profile_revision_decisions decision
                join public.enrichment_curator_eligibilities decision_curator
                  on decision_curator.user_id = decision.curator_id
                where decision.revision_id = revision.id
            ), '[]'::jsonb)
        ) order by
            case revision.revision_status
                when 'proposed' then 0
                when 'approved' then 0
                when 'disputed' then 0
                when 'published' then 1
                else 2
            end,
            revision.proposed_at desc,
            revision.id
        ), '[]'::jsonb)
        into v_revisions
        from public.enrichment_profile_revisions revision
        join public.enrichment_curator_eligibilities proposer
          on proposer.user_id = revision.proposed_by
        where revision.case_id = v_case.id;

        select coalesce(jsonb_agg(jsonb_build_object(
            'type', event.event_type,
            'actor', actor.display_name,
            'detail', event.detail,
            'occurred_at', event.occurred_at
        ) order by event.occurred_at, event.id), '[]'::jsonb)
        into v_events
        from public.enrichment_profile_governance_events event
        left join public.enrichment_curator_eligibilities actor
          on actor.user_id = event.actor_id
        where event.case_id = v_case.id;

        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'case_id', v_case.id,
            'subject_key', v_case.subject_key,
            'subject_title', v_case.subject_title,
            'subject', v_case.subject_snapshot,
            'profile_type', v_case.profile_type,
            'status', v_case.case_status,
            'opened_at', v_case.opened_at,
            'updated_at', v_case.updated_at,
            'resolved_at', v_case.resolved_at,
            'resolution_summary', v_case.resolution_summary,
            'reporter_count', (
                select count(distinct subscription.requested_by)::integer
                from public.enrichment_profile_review_subscriptions subscription
                where subscription.case_id = v_case.id
            ),
            'current_profile', private.enrichment_profile_revision_snapshot(v_profile_id),
            'reports', v_reports,
            'revisions', v_revisions,
            'events', v_events
        ));
    end loop;

    return jsonb_build_object(
        'status', 'available',
        'curator', jsonb_build_object(
            'eligible', true,
            'status', v_curator.eligibility_status,
            'display_name', v_curator.display_name,
            'profile_scopes', v_curator.profile_scopes,
            'rationale', v_curator.rationale,
            'granted_by', v_curator.granted_by,
            'granted_at', v_curator.granted_at
        ),
        'items', v_items
    );
end;
$$;

revoke all
on function public.get_enrichment_profile_governance_inbox()
from public, anon;

grant execute
on function public.get_enrichment_profile_governance_inbox()
to authenticated;


create or replace function private.apply_enrichment_profile_revision_payload(
    p_profile_id uuid,
    p_payload jsonb,
    p_reviewed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_type text := p_payload ->> 'profile_type';
    v_typed jsonb := p_payload -> 'typed';
begin
    update public.enrichment_profiles profile
    set
        confidence = (p_payload ->> 'confidence')::numeric,
        rationale = p_payload ->> 'rationale',
        reviewed_by = p_reviewed_by,
        reviewed_at = now(),
        created_at = now()
    where profile.id = p_profile_id;

    if v_type = 'place' then
        update public.enrichment_place_profiles typed set
            first_trial_age = (v_typed ->> 'first_trial_age')::integer,
            best_start_age = (v_typed ->> 'best_start_age')::integer,
            best_end_age = (v_typed ->> 'best_end_age')::integer,
            outer_horizon_age = (v_typed ->> 'outer_horizon_age')::integer,
            body = (v_typed ->> 'body')::numeric,
            acidity = (v_typed ->> 'acidity')::numeric,
            tannin = (v_typed ->> 'tannin')::numeric,
            sweetness = (v_typed ->> 'sweetness')::numeric,
            alcohol = (v_typed ->> 'alcohol')::numeric,
            freshness = (v_typed ->> 'freshness')::numeric,
            savory = (v_typed ->> 'savory')::numeric,
            concentration = (v_typed ->> 'concentration')::numeric
        where typed.profile_id = p_profile_id;
    elsif v_type = 'vintage' then
        update public.enrichment_vintage_profiles typed set
            first_trial_age_adjustment = (v_typed ->> 'first_trial_age_adjustment')::integer,
            best_start_age_adjustment = (v_typed ->> 'best_start_age_adjustment')::integer,
            best_end_age_adjustment = (v_typed ->> 'best_end_age_adjustment')::integer,
            outer_horizon_age_adjustment = (v_typed ->> 'outer_horizon_age_adjustment')::integer,
            body_adjustment = (v_typed ->> 'body_adjustment')::numeric,
            acidity_adjustment = (v_typed ->> 'acidity_adjustment')::numeric,
            tannin_adjustment = (v_typed ->> 'tannin_adjustment')::numeric,
            sweetness_adjustment = (v_typed ->> 'sweetness_adjustment')::numeric,
            alcohol_adjustment = (v_typed ->> 'alcohol_adjustment')::numeric,
            freshness_adjustment = (v_typed ->> 'freshness_adjustment')::numeric,
            savory_adjustment = (v_typed ->> 'savory_adjustment')::numeric,
            concentration_adjustment = (v_typed ->> 'concentration_adjustment')::numeric,
            condition_tags = array(
                select jsonb_array_elements_text(v_typed -> 'condition_tags')
            )
        where typed.profile_id = p_profile_id;
    elsif v_type = 'place-adjustment' then
        update public.enrichment_place_adjustment_profiles typed set
            first_trial_age_adjustment = (v_typed ->> 'first_trial_age_adjustment')::integer,
            best_start_age_adjustment = (v_typed ->> 'best_start_age_adjustment')::integer,
            best_end_age_adjustment = (v_typed ->> 'best_end_age_adjustment')::integer,
            outer_horizon_age_adjustment = (v_typed ->> 'outer_horizon_age_adjustment')::integer,
            body_adjustment = (v_typed ->> 'body_adjustment')::numeric,
            acidity_adjustment = (v_typed ->> 'acidity_adjustment')::numeric,
            tannin_adjustment = (v_typed ->> 'tannin_adjustment')::numeric,
            sweetness_adjustment = (v_typed ->> 'sweetness_adjustment')::numeric,
            alcohol_adjustment = (v_typed ->> 'alcohol_adjustment')::numeric,
            freshness_adjustment = (v_typed ->> 'freshness_adjustment')::numeric,
            savory_adjustment = (v_typed ->> 'savory_adjustment')::numeric,
            concentration_adjustment = (v_typed ->> 'concentration_adjustment')::numeric
        where typed.profile_id = p_profile_id;
    elsif v_type = 'producer-era' then
        update public.enrichment_producer_era_profiles typed set
            first_trial_age_adjustment = (v_typed ->> 'first_trial_age_adjustment')::integer,
            best_start_age_adjustment = (v_typed ->> 'best_start_age_adjustment')::integer,
            best_end_age_adjustment = (v_typed ->> 'best_end_age_adjustment')::integer,
            outer_horizon_age_adjustment = (v_typed ->> 'outer_horizon_age_adjustment')::integer,
            body_adjustment = (v_typed ->> 'body_adjustment')::numeric,
            acidity_adjustment = (v_typed ->> 'acidity_adjustment')::numeric,
            tannin_adjustment = (v_typed ->> 'tannin_adjustment')::numeric,
            sweetness_adjustment = (v_typed ->> 'sweetness_adjustment')::numeric,
            alcohol_adjustment = (v_typed ->> 'alcohol_adjustment')::numeric,
            freshness_adjustment = (v_typed ->> 'freshness_adjustment')::numeric,
            savory_adjustment = (v_typed ->> 'savory_adjustment')::numeric,
            concentration_adjustment = (v_typed ->> 'concentration_adjustment')::numeric
        where typed.profile_id = p_profile_id;
    elsif v_type = 'producer-vintage-interaction' then
        update public.enrichment_producer_vintage_interaction_profiles typed set
            first_trial_age_adjustment = (v_typed ->> 'first_trial_age_adjustment')::integer,
            best_start_age_adjustment = (v_typed ->> 'best_start_age_adjustment')::integer,
            best_end_age_adjustment = (v_typed ->> 'best_end_age_adjustment')::integer,
            outer_horizon_age_adjustment = (v_typed ->> 'outer_horizon_age_adjustment')::integer,
            body_adjustment = (v_typed ->> 'body_adjustment')::numeric,
            acidity_adjustment = (v_typed ->> 'acidity_adjustment')::numeric,
            tannin_adjustment = (v_typed ->> 'tannin_adjustment')::numeric,
            sweetness_adjustment = (v_typed ->> 'sweetness_adjustment')::numeric,
            alcohol_adjustment = (v_typed ->> 'alcohol_adjustment')::numeric,
            freshness_adjustment = (v_typed ->> 'freshness_adjustment')::numeric,
            savory_adjustment = (v_typed ->> 'savory_adjustment')::numeric,
            concentration_adjustment = (v_typed ->> 'concentration_adjustment')::numeric
        where typed.profile_id = p_profile_id;
    elsif v_type = 'cuvee' then
        update public.enrichment_cuvee_profiles typed set
            first_trial_age_adjustment = (v_typed ->> 'first_trial_age_adjustment')::integer,
            best_start_age_adjustment = (v_typed ->> 'best_start_age_adjustment')::integer,
            best_end_age_adjustment = (v_typed ->> 'best_end_age_adjustment')::integer,
            outer_horizon_age_adjustment = (v_typed ->> 'outer_horizon_age_adjustment')::integer,
            body_adjustment = (v_typed ->> 'body_adjustment')::numeric,
            acidity_adjustment = (v_typed ->> 'acidity_adjustment')::numeric,
            tannin_adjustment = (v_typed ->> 'tannin_adjustment')::numeric,
            sweetness_adjustment = (v_typed ->> 'sweetness_adjustment')::numeric,
            alcohol_adjustment = (v_typed ->> 'alcohol_adjustment')::numeric,
            freshness_adjustment = (v_typed ->> 'freshness_adjustment')::numeric,
            savory_adjustment = (v_typed ->> 'savory_adjustment')::numeric,
            concentration_adjustment = (v_typed ->> 'concentration_adjustment')::numeric
        where typed.profile_id = p_profile_id;
    elsif v_type = 'release' then
        update public.enrichment_release_profiles typed set
            first_trial_age_adjustment = (v_typed ->> 'first_trial_age_adjustment')::integer,
            best_start_age_adjustment = (v_typed ->> 'best_start_age_adjustment')::integer,
            best_end_age_adjustment = (v_typed ->> 'best_end_age_adjustment')::integer,
            outer_horizon_age_adjustment = (v_typed ->> 'outer_horizon_age_adjustment')::integer,
            body_adjustment = (v_typed ->> 'body_adjustment')::numeric,
            acidity_adjustment = (v_typed ->> 'acidity_adjustment')::numeric,
            tannin_adjustment = (v_typed ->> 'tannin_adjustment')::numeric,
            sweetness_adjustment = (v_typed ->> 'sweetness_adjustment')::numeric,
            alcohol_adjustment = (v_typed ->> 'alcohol_adjustment')::numeric,
            freshness_adjustment = (v_typed ->> 'freshness_adjustment')::numeric,
            savory_adjustment = (v_typed ->> 'savory_adjustment')::numeric,
            concentration_adjustment = (v_typed ->> 'concentration_adjustment')::numeric
        where typed.profile_id = p_profile_id;
    else
        raise exception using errcode = '22023', message = 'Profile revision type is unsupported';
    end if;
end;
$$;

revoke execute
on function private.apply_enrichment_profile_revision_payload(uuid, jsonb, uuid)
from public, anon, authenticated;


create or replace function public.publish_approved_enrichment_profile_revisions(
    p_limit integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_candidate record;
    v_revision public.enrichment_profile_revisions%rowtype;
    v_case public.enrichment_profile_review_cases%rowtype;
    v_current_profile_id uuid;
    v_new_profile_id uuid;
    v_new_version_id uuid;
    v_approver_id uuid;
    v_result jsonb;
    v_results jsonb := '[]'::jsonb;
    v_current_comparable jsonb;
    v_predecessor_comparable jsonb;
begin
    if p_limit not between 1 and 5 then
        raise exception using errcode = '22023', message = 'Profile revision publication limit is invalid';
    end if;

    for v_candidate in
        select revision.id
        from public.enrichment_profile_revisions revision
        where revision.revision_status = 'approved'
        order by revision.proposed_at, revision.id
        limit p_limit
    loop
        begin
            select revision.* into v_revision
            from public.enrichment_profile_revisions revision
            where revision.id = v_candidate.id
            for update skip locked;
            if not found or v_revision.revision_status <> 'approved' then
                continue;
            end if;

            select review_case.* into v_case
            from public.enrichment_profile_review_cases review_case
            where review_case.id = v_revision.case_id
            for update;

            with latest as (
                select distinct on (decision.curator_id)
                    decision.curator_id, decision.verdict,
                    decision.decided_at, decision.decision_sequence
                from public.enrichment_profile_revision_decisions decision
                where decision.revision_id = v_revision.id
                order by decision.curator_id, decision.decision_sequence desc
            )
            select latest.curator_id into v_approver_id
            from latest
            join public.enrichment_curator_eligibilities curator
              on curator.user_id = latest.curator_id
             and curator.eligibility_status = 'active'
             and v_case.profile_type = any(curator.profile_scopes)
            where latest.verdict = 'approve'
              and not exists (select 1 from latest conflict where conflict.verdict = 'disagree')
            order by latest.decision_sequence
            limit 1;

            if v_approver_id is null then
                update public.enrichment_profile_revisions revision
                set revision_status = 'disputed'
                where revision.id = v_revision.id;
                v_results := v_results || jsonb_build_array(jsonb_build_object(
                    'revision_id', v_revision.id,
                    'status', 'disputed',
                    'error', 'No conflict-free active curator approval remains'
                ));
                continue;
            end if;

            select profile.id into v_current_profile_id
            from public.enrichment_profiles profile
            join public.enrichment_knowledge_versions version
              on version.id = profile.knowledge_version_id
             and version.status = 'active'
            cross join lateral (
                select private.enrichment_profile_review_subject(profile.id) as subject
            ) resolved
            where resolved.subject ->> 'subject_key' = v_case.subject_key
            limit 1;
            if not found then
                raise exception using errcode = '55000', message = 'Reviewed subject disappeared from the active library';
            end if;

            v_current_comparable := jsonb_build_object(
                'profile_type', private.enrichment_profile_revision_snapshot(v_current_profile_id) ->> 'profile_type',
                'confidence', (private.enrichment_profile_revision_snapshot(v_current_profile_id) ->> 'confidence')::numeric,
                'rationale', private.enrichment_profile_revision_snapshot(v_current_profile_id) ->> 'rationale',
                'typed', private.enrichment_profile_revision_snapshot(v_current_profile_id) -> 'typed'
            );
            v_predecessor_comparable := jsonb_build_object(
                'profile_type', private.enrichment_profile_revision_snapshot(v_revision.predecessor_profile_id) ->> 'profile_type',
                'confidence', (private.enrichment_profile_revision_snapshot(v_revision.predecessor_profile_id) ->> 'confidence')::numeric,
                'rationale', private.enrichment_profile_revision_snapshot(v_revision.predecessor_profile_id) ->> 'rationale',
                'typed', private.enrichment_profile_revision_snapshot(v_revision.predecessor_profile_id) -> 'typed'
            );
            if v_current_comparable is distinct from v_predecessor_comparable then
                update public.enrichment_profile_revisions revision
                set revision_status = 'disputed'
                where revision.id = v_revision.id;
                v_results := v_results || jsonb_build_array(jsonb_build_object(
                    'revision_id', v_revision.id,
                    'status', 'disputed',
                    'error', 'The shared profile changed after this revision was proposed'
                ));
                continue;
            end if;

            perform private.validate_enrichment_profile_revision(
                v_current_profile_id,
                v_revision.proposed_payload
            );

            v_new_version_id := private.clone_active_enrichment_knowledge_version(
                'Profile correction: ' || v_case.subject_title,
                'profile-revision-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
                v_approver_id
            );
            select map.new_id into v_new_profile_id
            from pg_temp.enrichment_profile_clone_map map
            where map.old_id = v_current_profile_id;
            if not found then
                raise exception using errcode = '55000', message = 'Profile clone mapping is missing';
            end if;

            perform private.apply_enrichment_profile_revision_payload(
                v_new_profile_id,
                v_revision.proposed_payload,
                v_approver_id
            );
            v_result := public.publish_enrichment_knowledge_version(v_new_version_id);

            update public.enrichment_profile_revisions revision
            set
                revision_status = 'published',
                published_at = now(),
                published_profile_id = v_new_profile_id,
                published_version_id = v_new_version_id
            where revision.id = v_revision.id;

            update public.enrichment_profile_review_cases review_case
            set
                case_status = 'resolved',
                updated_at = now(),
                resolved_at = now(),
                resolution_summary = 'A trusted curator validated the documented correction. It was published in a new immutable shared-library version.',
                resolution_profile_id = v_new_profile_id
            where review_case.id = v_case.id;

            update public.enrichment_profile_review_subscriptions subscription
            set notified_at = now(), seen_at = null
            where subscription.case_id = v_case.id;

            insert into public.enrichment_profile_governance_events (
                event_type, actor_id, case_id, revision_id, profile_id,
                knowledge_version_id, detail
            ) values (
                'revision-published', v_approver_id, v_case.id, v_revision.id,
                v_new_profile_id, v_new_version_id,
                jsonb_build_object(
                    'predecessor_profile_id', v_current_profile_id,
                    'proposal_sha256', v_revision.proposal_sha256,
                    'content_sha256', v_result ->> 'content_sha256'
                )
            );

            v_results := v_results || jsonb_build_array(jsonb_build_object(
                'revision_id', v_revision.id,
                'case_id', v_case.id,
                'status', 'published',
                'profile_id', v_new_profile_id,
                'knowledge_version_id', v_new_version_id,
                'content_sha256', v_result ->> 'content_sha256'
            ));
        exception when others then
            update public.enrichment_profile_revisions revision
            set revision_status = 'disputed'
            where revision.id = v_candidate.id
              and revision.revision_status = 'approved';
            v_results := v_results || jsonb_build_array(jsonb_build_object(
                'revision_id', v_candidate.id,
                'status', 'disputed',
                'sqlstate', sqlstate,
                'error', sqlerrm
            ));
        end;
    end loop;

    return jsonb_build_object(
        'status', 'processed',
        'count', jsonb_array_length(v_results),
        'results', v_results
    );
end;
$$;

revoke all
on function public.publish_approved_enrichment_profile_revisions(integer)
from public, anon, authenticated;

grant execute
on function public.publish_approved_enrichment_profile_revisions(integer)
to service_role;

commit;
