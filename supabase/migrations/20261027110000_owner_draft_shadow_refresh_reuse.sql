begin;

-- Rechecking an unchanged draft must not supersede an owner's decision on the
-- exact same cellar snapshot. A changed draft or cellar still gets a new,
-- immutable report and requires a new owner decision.
create or replace function public.request_drinking_window_draft_shadow_report(
    p_household_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version_id uuid;
    v_latest private.drinking_window_shadow_reports%rowtype;
    v_snapshot jsonb;
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

    -- Serialize repeated owner refreshes, including two fast taps. The lock is
    -- scoped to this version and household, not to unrelated cellars.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext(v_version_id::text),
        pg_catalog.hashtext(p_household_id::text));

    v_snapshot := private.drinking_window_shadow_snapshot(
        v_version_id, p_household_id);
    select report.* into v_latest
    from private.drinking_window_shadow_reports report
    where report.version_id = v_version_id
      and report.household_id = p_household_id
    order by report.report_sequence desc
    limit 1;

    if v_latest.id is not null
       and v_latest.requested_by = auth.uid()
       and v_latest.content_sha256 = v_snapshot ->> 'content_sha256'
       and v_latest.draft_sha256 = v_snapshot ->> 'draft_sha256'
       and v_latest.draft_issue_count =
           (v_snapshot ->> 'draft_issue_count')::bigint
       and v_latest.wine_count = (v_snapshot ->> 'wine_count')::integer then
        return v_latest.id;
    end if;

    insert into private.drinking_window_shadow_reports
        (version_id, household_id, requested_by, draft_sha256,
         draft_issue_count, content_sha256, wine_count, rows)
    values (v_version_id, p_household_id, auth.uid(),
        v_snapshot ->> 'draft_sha256',
        (v_snapshot ->> 'draft_issue_count')::bigint,
        v_snapshot ->> 'content_sha256',
        (v_snapshot ->> 'wine_count')::integer,
        v_snapshot -> 'rows')
    returning id into v_report_id;
    return v_report_id;
end;
$$;

revoke all on function public.request_drinking_window_draft_shadow_report(uuid)
    from public, anon, authenticated, powersync_role, service_role;
grant execute on function public.request_drinking_window_draft_shadow_report(uuid)
    to authenticated;

commit;
