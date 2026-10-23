begin;

-- Keep the reviewed comparison tied to the actual group definition and row
-- rationale, not just its dates. This adds explanation to new snapshots only;
-- it neither selects a reference nor changes any cellar's advice.
alter function private.drinking_window_shadow_snapshot(uuid, uuid)
    rename to drinking_window_shadow_snapshot_before_group_context;
revoke all on function private.drinking_window_shadow_snapshot_before_group_context(uuid, uuid)
    from public, anon, authenticated, powersync_role, service_role;

create function private.drinking_window_shadow_snapshot(
    p_version_id uuid, p_household_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
    v_original jsonb;
    v_rows jsonb;
    v_hash text;
begin
    v_original := private.drinking_window_shadow_snapshot_before_group_context(
        p_version_id, p_household_id
    );

    select coalesce(jsonb_agg(
        case when reference_row.id is null then entry.value
            else entry.value || jsonb_build_object(
                'proposed_reference_rationale', reference_row.rationale,
                'proposed_group_key', ageing_group.group_key,
                'proposed_group_definition', ageing_group.definition
            ) end order by entry.ordinality
        ), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(v_original -> 'rows') with ordinality entry(value, ordinality)
    left join public.drinking_window_reference_rows reference_row
      on reference_row.id = (entry.value ->> 'reference_row_id')::uuid
     and reference_row.version_id = p_version_id
    left join public.drinking_window_ageing_groups ageing_group
      on ageing_group.id = reference_row.ageing_group_id
     and ageing_group.version_id = p_version_id;

    if public.drinking_window_draft_fingerprint(p_version_id)
        <> v_original ->> 'draft_sha256' then
        raise exception using errcode = '40001',
            message = 'Draft changed during shadow comparison; retry';
    end if;

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
