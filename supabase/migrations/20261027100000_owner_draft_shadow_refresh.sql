begin;

-- An owner may refresh a draft comparison that was already shared with that
-- same owner. This does not make other drafts discoverable and does not grant
-- direct access to the service-only report recorder or private rows.
create function public.request_drinking_window_draft_shadow_report(
    p_household_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version_id uuid;
    v_report_id uuid;
begin
    if auth.uid() is null or not exists (
        select 1 from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = auth.uid()
          and member.role = 'owner'
    ) then
        raise exception using errcode = '42501',
            message = 'Only the household owner can refresh this comparison';
    end if;

    select version.id into v_version_id
    from public.drinking_window_reference_versions version
    join private.drinking_window_shadow_reports report
      on report.version_id = version.id
    where report.household_id = p_household_id
      and report.requested_by = auth.uid()
      and version.status = 'draft'
    order by report.report_sequence desc
    limit 1
    for share of version;

    if v_version_id is null then
        raise exception using errcode = '22023',
            message = 'No previously shared draft comparison is available';
    end if;

    select recorded.report_id into v_report_id
    from public.record_drinking_window_shadow_report(
        v_version_id, p_household_id
    ) recorded;
    return v_report_id;
end;
$$;

revoke all on function public.request_drinking_window_draft_shadow_report(uuid)
    from public, anon, authenticated, powersync_role, service_role;
grant execute on function public.request_drinking_window_draft_shadow_report(uuid)
    to authenticated;

commit;
