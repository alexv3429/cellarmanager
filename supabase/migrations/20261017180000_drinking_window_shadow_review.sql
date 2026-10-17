begin;

-- Build one complete, bounded household snapshot. This private helper is also
-- used at approval time; a partial, caller-selected batch is never signable.
create function private.drinking_window_shadow_snapshot(
    p_version_id uuid, p_household_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_count integer;
    v_after_count integer;
    v_before_hash text;
    v_after_hash text;
    v_issues bigint;
    v_after_issues bigint;
    v_ids uuid[];
    v_chunk jsonb;
    v_rows jsonb := '[]'::jsonb;
    v_content_hash text;
begin
    if not exists (select 1 from public.households h where h.id = p_household_id) then
        raise exception using errcode = '22023', message = 'Household was not found';
    end if;
    select count(*) into v_count from public.wines w
    where w.household_id = p_household_id and w.merged_into_wine_id is null;
    if v_count not between 1 and 10000 then
        raise exception using errcode = '22023',
            message = 'Shadow review requires 1 to 10000 active household wines';
    end if;

    v_before_hash := public.drinking_window_draft_fingerprint(p_version_id);
    select count(*) into v_issues
    from public.drinking_window_publication_issues(p_version_id);

    for v_ids in
        select array_agg(w.id order by w.id)
        from (
            select wine.id,
                ((row_number() over (order by wine.id) - 1) / 250)::integer as batch
            from public.wines wine
            where wine.household_id = p_household_id
              and wine.merged_into_wine_id is null
        ) w
        group by w.batch
        order by w.batch
    loop
        select coalesce(jsonb_agg(to_jsonb(result) order by result.wine_id),
            '[]'::jsonb)
        into v_chunk
        from public.drinking_window_shadow_compare(
            p_version_id, p_household_id, v_ids
        ) result;
        v_rows := v_rows || v_chunk;
    end loop;

    v_after_hash := public.drinking_window_draft_fingerprint(p_version_id);
    select count(*) into v_after_issues
    from public.drinking_window_publication_issues(p_version_id);
    select count(*) into v_after_count from public.wines w
    where w.household_id = p_household_id and w.merged_into_wine_id is null;
    if v_before_hash <> v_after_hash or v_issues <> v_after_issues
       or v_count <> v_after_count or jsonb_array_length(v_rows) <> v_count
       or exists (
           select 1 from jsonb_array_elements(v_rows) as item(value)
           where item.value ->> 'draft_sha256' <> v_before_hash
              or (item.value ->> 'draft_issue_count')::bigint <> v_issues
       ) then
        raise exception using errcode = '40001',
            message = 'Draft or cellar changed during shadow comparison; retry';
    end if;

    v_content_hash := encode(extensions.digest(convert_to(
        jsonb_build_object('version_id', p_version_id,
            'household_id', p_household_id, 'draft_sha256', v_before_hash,
            'draft_issue_count', v_issues, 'rows', v_rows)::text,
        'UTF8'), 'sha256'), 'hex');
    return jsonb_build_object(
        'version_id', p_version_id,
        'household_id', p_household_id,
        'draft_sha256', v_before_hash,
        'draft_issue_count', v_issues,
        'wine_count', v_count,
        'content_sha256', v_content_hash,
        'rows', v_rows
    );
end;
$$;
revoke all on function private.drinking_window_shadow_snapshot(uuid, uuid)
from public, anon, authenticated, powersync_role, service_role;

-- Household-private report, removed if the household is deleted. No direct
-- API role can read or mutate its raw comparison rows.
create table private.drinking_window_shadow_reports (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    household_id uuid not null references public.households(id) on delete cascade,
    draft_sha256 text not null check (draft_sha256 ~ '^[0-9a-f]{64}$'),
    draft_issue_count bigint not null check (draft_issue_count >= 0),
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    wine_count integer not null check (wine_count between 1 and 10000),
    rows jsonb not null check (jsonb_typeof(rows) = 'array'),
    recorded_at timestamptz not null default now(),
    check (jsonb_array_length(rows) = wine_count)
);
create index drinking_window_shadow_reports_version_idx
on private.drinking_window_shadow_reports(version_id, recorded_at desc);
revoke all on private.drinking_window_shadow_reports
from public, anon, authenticated, powersync_role, service_role;

create table private.drinking_window_shadow_decisions (
    id uuid primary key default gen_random_uuid(),
    decision_sequence bigint generated always as identity unique,
    report_id uuid not null references private.drinking_window_shadow_reports(id)
        on delete cascade,
    reviewer_id uuid not null references auth.users(id),
    verdict text not null check (verdict in ('approve', 'reject')),
    rationale text not null check (length(trim(rationale)) between 10 and 2000),
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    decided_at timestamptz not null default now()
);
create index drinking_window_shadow_decisions_report_idx
on private.drinking_window_shadow_decisions(report_id, decision_sequence desc);
revoke all on private.drinking_window_shadow_decisions
from public, anon, authenticated, powersync_role, service_role;

create function private.reject_drinking_window_shadow_update()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception using errcode = '23514',
        message = 'Drinking-window shadow history cannot be updated';
end;
$$;
revoke all on function private.reject_drinking_window_shadow_update()
from public, anon, authenticated, powersync_role, service_role;
create trigger drinking_window_shadow_reports_no_update
before update on private.drinking_window_shadow_reports
for each row execute function private.reject_drinking_window_shadow_update();
create trigger drinking_window_shadow_decisions_no_update
before update on private.drinking_window_shadow_decisions
for each row execute function private.reject_drinking_window_shadow_update();

create function public.record_drinking_window_shadow_report(
    p_version_id uuid, p_household_id uuid
)
returns table (report_id uuid, content_sha256 text, draft_issue_count bigint,
    wine_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_snapshot jsonb;
    v_id uuid;
begin
    v_snapshot := private.drinking_window_shadow_snapshot(
        p_version_id, p_household_id
    );
    insert into private.drinking_window_shadow_reports
        (version_id, household_id, draft_sha256, draft_issue_count,
         content_sha256, wine_count, rows)
    values (p_version_id, p_household_id,
        v_snapshot ->> 'draft_sha256',
        (v_snapshot ->> 'draft_issue_count')::bigint,
        v_snapshot ->> 'content_sha256',
        (v_snapshot ->> 'wine_count')::integer,
        v_snapshot -> 'rows')
    returning id into v_id;
    return query select v_id, v_snapshot ->> 'content_sha256',
        (v_snapshot ->> 'draft_issue_count')::bigint,
        (v_snapshot ->> 'wine_count')::integer;
end;
$$;
revoke all on function public.record_drinking_window_shadow_report(uuid, uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.record_drinking_window_shadow_report(uuid, uuid)
to service_role;

-- Owners can inspect their own detailed report only. The unpublished draft
-- remains clearly labelled by its issue count and is never display advice.
create function public.get_drinking_window_shadow_report(p_report_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
    v_report private.drinking_window_shadow_reports%rowtype;
    v_decision record;
begin
    select * into v_report from private.drinking_window_shadow_reports r
    where r.id = p_report_id;
    if not found then
        raise exception using errcode = '22023', message = 'Shadow report was not found';
    end if;
    if not exists (select 1 from public.household_members m
        where m.household_id = v_report.household_id
          and m.user_id = auth.uid() and m.role = 'owner') then
        raise exception using errcode = '42501',
            message = 'Only the household owner can review this report';
    end if;
    select d.verdict, d.rationale, d.decided_at into v_decision
    from private.drinking_window_shadow_decisions d
    where d.report_id = p_report_id
    order by d.decision_sequence desc limit 1;
    return jsonb_build_object(
        'report_id', v_report.id, 'version_id', v_report.version_id,
        'household_id', v_report.household_id,
        'draft_sha256', v_report.draft_sha256,
        'draft_issue_count', v_report.draft_issue_count,
        'content_sha256', v_report.content_sha256,
        'wine_count', v_report.wine_count,
        'recorded_at', v_report.recorded_at,
        'latest_decision', case when v_decision.verdict is null then null
            else jsonb_build_object('verdict', v_decision.verdict,
                'rationale', v_decision.rationale,
                'decided_at', v_decision.decided_at) end,
        'rows', v_report.rows
    );
end;
$$;
revoke all on function public.get_drinking_window_shadow_report(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.get_drinking_window_shadow_report(uuid)
to authenticated;

-- The owner's decision attests to the exact full-cellar report hash. For an
-- approval, both the draft and the household snapshot are recalculated.
create function public.review_drinking_window_shadow_report(
    p_report_id uuid, p_expected_content_sha256 text,
    p_verdict text, p_rationale text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
    v_report private.drinking_window_shadow_reports%rowtype;
    v_snapshot jsonb;
    v_id uuid;
begin
    select * into v_report from private.drinking_window_shadow_reports r
    where r.id = p_report_id for share;
    if not found then
        raise exception using errcode = '22023', message = 'Shadow report was not found';
    end if;
    if not exists (select 1 from public.household_members m
        where m.household_id = v_report.household_id
          and m.user_id = auth.uid() and m.role = 'owner') then
        raise exception using errcode = '42501',
            message = 'Only the household owner can review this report';
    end if;
    if p_expected_content_sha256 is distinct from v_report.content_sha256
       or p_verdict is null or p_verdict not in ('approve', 'reject')
       or p_rationale is null or length(trim(p_rationale)) not between 10 and 2000 then
        raise exception using errcode = '22023',
            message = 'Review must name this report hash, verdict, and rationale';
    end if;

    if p_verdict = 'approve' then
        if v_report.draft_issue_count <> 0 or not exists (
            select 1 from private.drinking_window_publication_preflights p
            where p.version_id = v_report.version_id
              and p.content_sha256 = v_report.draft_sha256
              and p.issue_count = 0
        ) then
            raise exception using errcode = '23514',
                message = 'A current zero-issue publication preflight is required';
        end if;
        v_snapshot := private.drinking_window_shadow_snapshot(
            v_report.version_id, v_report.household_id
        );
        if v_snapshot ->> 'content_sha256' <> v_report.content_sha256
           or (v_snapshot ->> 'draft_issue_count')::bigint <> 0 then
            raise exception using errcode = '40001',
                message = 'Shadow report is stale; record and review a new report';
        end if;
        if exists (
            select 1 from jsonb_array_elements(v_report.rows) as item(value)
            where item.value ->> 'draft_status' in ('ambiguous', 'identity_conflict')
        ) then
            raise exception using errcode = '23514',
                message = 'Resolve ambiguous or conflicting wine identities before approval';
        end if;
    end if;

    insert into private.drinking_window_shadow_decisions
        (report_id, reviewer_id, verdict, rationale, content_sha256)
    values (p_report_id, auth.uid(), p_verdict, trim(p_rationale),
        v_report.content_sha256)
    returning id into v_id;
    return v_id;
end;
$$;
revoke all on function public.review_drinking_window_shadow_report(uuid, text, text, text)
from public, anon, authenticated, powersync_role;
grant execute on function public.review_drinking_window_shadow_report(uuid, text, text, text)
to authenticated;

-- Publication remains blocked. The future publisher must recheck the latest
-- owner decision, report hash, live cellar state, and all preflight gates.
commit;
