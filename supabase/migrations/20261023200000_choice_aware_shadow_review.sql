begin;

-- Keep the previously tested owner-visible baseline intact. Only replace the
-- proposed row when this wine has a current, explicit local group choice.
alter function public.drinking_window_shadow_compare(uuid, uuid, uuid[])
    rename to drinking_window_shadow_compare_before_ageing_choice;
revoke all on function public.drinking_window_shadow_compare_before_ageing_choice(uuid, uuid, uuid[])
    from public, anon, authenticated, powersync_role, service_role;

create function public.drinking_window_shadow_compare(
    p_version_id uuid, p_household_id uuid, p_wine_ids uuid[]
)
returns table (
    wine_id uuid, draft_sha256 text, draft_issue_count bigint,
    identity_status text, draft_status text, comparison_status text,
    current_source text, current_projection_id uuid,
    current_first_trial_year integer, current_best_start_year integer,
    current_best_end_year integer, reference_row_id uuid, matched_scope text,
    proposed_first_trial_year integer, proposed_best_start_year integer,
    proposed_best_end_year integer, first_trial_delta integer,
    best_start_delta integer, best_end_delta integer, reason text
)
language sql stable security definer set search_path = '' as $$
    with original as (
        select * from public.drinking_window_shadow_compare_before_ageing_choice(
            p_version_id, p_household_id, p_wine_ids)
    ), selected as (
        select original.*,
            choice.present as has_choice,
            alternative.status as choice_status,
            alternative.matched_scope as choice_scope,
            alternative.reference_row_id as choice_row_id,
            alternative.first_trial_year as choice_first,
            alternative.best_start_year as choice_start,
            alternative.best_end_year as choice_end,
            alternative.reason as choice_reason
        from original
        cross join lateral (select private.drinking_window_wine_context(original.wine_id) as context) c
        left join lateral (
            select true as present
            from private.household_wine_ageing_choices local_choice
            where local_choice.wine_id = original.wine_id
              and local_choice.version_id = p_version_id
              and local_choice.source_fingerprint = c.context ->> 'source_fingerprint'
            limit 1
        ) choice on true
        left join lateral private.drinking_window_preview_draft_match_for_wine(
            original.wine_id, p_version_id,
            (c.context ->> 'producer_id')::uuid,
            (c.context ->> 'product_id')::uuid,
            (c.context ->> 'release_id')::uuid,
            (c.context ->> 'appellation_id')::uuid,
            (c.context ->> 'region_id')::uuid,
            c.context ->> 'wine_color',
            (c.context ->> 'vintage_year')::integer
        ) alternative on choice.present and c.context ->> 'status' = 'ready'
    ), effective as (
        select selected.*,
            case when has_choice then choice_status else selected.draft_status end as effective_status,
            case when has_choice then choice_scope else selected.matched_scope end as effective_scope,
            case when has_choice then choice_row_id else selected.reference_row_id end as effective_row_id,
            case when has_choice then choice_first else selected.proposed_first_trial_year end as effective_first,
            case when has_choice then choice_start else selected.proposed_best_start_year end as effective_start,
            case when has_choice then choice_end else selected.proposed_best_end_year end as effective_end,
            case when has_choice then choice_reason else selected.reason end as effective_reason
        from selected
    )
    select effective.wine_id, effective.draft_sha256,
        effective.draft_issue_count, effective.identity_status,
        effective.effective_status,
        case
            when effective.current_source = 'manual_override' then 'manual_preserved'
            when effective.effective_status <> 'draft_match' then effective.effective_status
            when effective.current_source = 'none' then 'new_reference_no_baseline'
            when effective.current_source in
                ('expired_model', 'expired_personalized_model') then 'expired_baseline'
            when (effective.current_first_trial_year,
                  effective.current_best_start_year,
                  effective.current_best_end_year) =
                 (effective.effective_first, effective.effective_start,
                  effective.effective_end) then 'unchanged'
            else 'changed'
        end,
        effective.current_source, effective.current_projection_id,
        effective.current_first_trial_year,
        effective.current_best_start_year,
        effective.current_best_end_year,
        effective.effective_row_id, effective.effective_scope,
        effective.effective_first, effective.effective_start,
        effective.effective_end,
        case when effective.effective_status = 'draft_match'
                  and effective.current_first_trial_year is not null
            then effective.effective_first - effective.current_first_trial_year
            else null end,
        case when effective.effective_status = 'draft_match'
                  and effective.current_best_start_year is not null
            then effective.effective_start - effective.current_best_start_year
            else null end,
        case when effective.effective_status = 'draft_match'
                  and effective.current_best_end_year is not null
            then effective.effective_end - effective.current_best_end_year
            else null end,
        effective.effective_reason
    from effective;
$$;
revoke all on function public.drinking_window_shadow_compare(uuid, uuid, uuid[])
    from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_shadow_compare(uuid, uuid, uuid[])
    to service_role;

-- Choice revisions are part of the exact owner-approved snapshot, including
-- the current active version when comparing a future draft. A stale choice is
-- ignored and does not reappear simply because a new version is published.
create function private.drinking_window_local_choice_snapshot(
    p_household_id uuid, p_version_id uuid
)
returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_object_agg(grouped.wine_id::text, grouped.choices), '{}'::jsonb)
    from (
        select wine.id as wine_id, jsonb_agg(jsonb_build_object(
            'version_id', choice.version_id,
            'scope', choice.scope,
            'group_id', choice.group_id,
            'choice_revision', choice.choice_revision
        ) order by choice.version_id, choice.scope) as choices
        from public.wines wine
        join private.household_wine_ageing_choices choice
          on choice.wine_id = wine.id and choice.household_id = wine.household_id
        join public.drinking_window_reference_versions version
          on version.id = choice.version_id
        where wine.household_id = p_household_id
          and wine.merged_into_wine_id is null
          and choice.source_fingerprint = private.drinking_window_wine_identity_fingerprint(wine)
          and (choice.version_id = p_version_id or version.status = 'active')
        group by wine.id
    ) grouped;
$$;
revoke all on function private.drinking_window_local_choice_snapshot(uuid, uuid)
    from public, anon, authenticated, powersync_role, service_role;

alter function private.drinking_window_shadow_snapshot(uuid, uuid)
    rename to drinking_window_shadow_snapshot_before_ageing_choice;
revoke all on function private.drinking_window_shadow_snapshot_before_ageing_choice(uuid, uuid)
    from public, anon, authenticated, powersync_role, service_role;

create function private.drinking_window_shadow_snapshot(
    p_version_id uuid, p_household_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_before_choices jsonb;
    v_after_choices jsonb;
    v_original jsonb;
    v_rows jsonb;
    v_hash text;
begin
    v_before_choices := private.drinking_window_local_choice_snapshot(
        p_household_id, p_version_id);
    v_original := private.drinking_window_shadow_snapshot_before_ageing_choice(
        p_version_id, p_household_id);
    v_after_choices := private.drinking_window_local_choice_snapshot(
        p_household_id, p_version_id);
    if v_before_choices is distinct from v_after_choices then
        raise exception using errcode = '40001',
            message = 'Local ageing choices changed during comparison; retry';
    end if;
    select coalesce(jsonb_agg(entry.value || jsonb_build_object(
        'local_ageing_choices', coalesce(
            v_after_choices -> (entry.value ->> 'wine_id'), '[]'::jsonb))
        order by entry.ordinality), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(v_original -> 'rows') with ordinality entry(value, ordinality);
    v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
        'version_id', p_version_id,
        'household_id', p_household_id,
        'draft_sha256', v_original ->> 'draft_sha256',
        'draft_issue_count', (v_original ->> 'draft_issue_count')::bigint,
        'rows', v_rows
    )::text, 'UTF8'), 'sha256'), 'hex');
    return jsonb_set(jsonb_set(v_original, '{rows}', v_rows),
        '{content_sha256}', to_jsonb(v_hash));
end;
$$;
revoke all on function private.drinking_window_shadow_snapshot(uuid, uuid)
    from public, anon, authenticated, powersync_role, service_role;

commit;
