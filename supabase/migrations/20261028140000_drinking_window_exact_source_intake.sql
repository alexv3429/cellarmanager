begin;

-- A URL supplied for an unpublished exact release is only a lead. Keep the
-- research note private until a curator separately checks both the three-date
-- claim and the rights to display/reuse a pointer to it across households.
create table private.drinking_window_source_intake (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    row_id uuid not null references public.drinking_window_reference_rows(id),
    row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
    first_trial_year integer not null,
    best_start_year integer not null,
    best_end_year integer not null,
    source_name text not null,
    source_kind text not null check (source_kind in ('producer', 'critic', 'provider', 'vintage-report')),
    source_url text not null,
    claim_note text not null,
    rights_evidence_url text not null,
    rights_note text not null,
    submitted_by uuid not null references public.enrichment_curator_eligibilities(user_id),
    submitted_at timestamptz not null default now(),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    reviewed_by uuid references public.enrichment_curator_eligibilities(user_id),
    reviewed_at timestamptz,
    review_note text,
    evidence_id uuid unique references public.enrichment_evidence(id),
    check ((status = 'pending' and reviewed_by is null and reviewed_at is null
            and review_note is null and evidence_id is null)
        or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null
            and review_note is not null and evidence_id is null)
        or (status = 'approved' and reviewed_by is not null and reviewed_at is not null
            and review_note is not null and evidence_id is not null))
);
create index drinking_window_source_intake_row_idx
    on private.drinking_window_source_intake(version_id, row_id, submitted_at desc);
revoke all on private.drinking_window_source_intake
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_source_intake to service_role;

create function public.get_drinking_window_source_intake(
    p_version_id uuid, p_row_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if not exists (
        select 1 from public.drinking_window_reference_rows r
        join public.drinking_window_reference_versions v on v.id = r.version_id
        where r.id = p_row_id and r.version_id = p_version_id
          and r.scope = 'release' and v.status = 'draft'
    ) then
        raise exception using errcode = '22023',
            message = 'Choose an unpublished exact-release row';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', item.id, 'source_name', item.source_name,
            'source_kind', item.source_kind, 'source_url', item.source_url,
            'claim_note', item.claim_note,
            'rights_evidence_url', item.rights_evidence_url,
            'rights_note', item.rights_note,
            'first_trial_year', item.first_trial_year,
            'best_start_year', item.best_start_year,
            'best_end_year', item.best_end_year,
            'row_hash', item.row_hash, 'status', item.status,
            'submitted_at', item.submitted_at, 'review_note', item.review_note,
            'evidence_id', item.evidence_id
        ) order by item.submitted_at desc, item.id desc)
        from (select * from private.drinking_window_source_intake
              where version_id = p_version_id and row_id = p_row_id
              order by submitted_at desc, id desc limit 20) item
    ), '[]'::jsonb);
end;
$$;

create function public.submit_drinking_window_source_intake(
    p_version_id uuid, p_row_id uuid, p_expected_hash text,
    p_source_name text, p_source_kind text, p_source_url text,
    p_claim_note text, p_rights_evidence_url text, p_rights_note text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    v_row public.drinking_window_reference_rows%rowtype;
    v_hash text;
    v_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    select r.* into v_row from public.drinking_window_reference_rows r
    join public.drinking_window_reference_versions v on v.id = r.version_id
    where r.id = p_row_id and r.version_id = p_version_id
      and r.scope = 'release' and v.status = 'draft';
    if not found then
        raise exception using errcode = '22023',
            message = 'Only an unpublished exact-release row accepts a new source';
    end if;
    v_hash := private.drinking_window_review_subject_hash(p_version_id, 'row', p_row_id);
    if p_expected_hash is distinct from v_hash then
        raise exception using errcode = '40001',
            message = 'This draft changed; refresh before adding a source';
    end if;
    if p_source_kind is null or p_source_kind not in ('producer', 'critic', 'provider', 'vintage-report')
       or length(trim(coalesce(p_source_name, ''))) not between 3 and 160
       or length(coalesce(p_source_url, '')) not between 12 and 1000
       or p_source_url !~ '^https://[^[:space:]]+$'
       or length(trim(coalesce(p_claim_note, ''))) not between 20 and 2000
       or length(coalesce(p_rights_evidence_url, '')) not between 12 and 1000
       or p_rights_evidence_url !~ '^https://[^[:space:]]+$'
       or length(trim(coalesce(p_rights_note, ''))) not between 20 and 2000 then
        raise exception using errcode = '22023',
            message = 'Provide the source, an exact-date note, and a documented reuse-rights assessment';
    end if;
    if (select count(*) from private.drinking_window_source_intake
        where version_id = p_version_id and row_id = p_row_id and status = 'pending') >= 20 then
        raise exception using errcode = '23514', message = 'Too many sources await review for this row';
    end if;
    insert into private.drinking_window_source_intake (
        version_id, row_id, row_hash, first_trial_year, best_start_year,
        best_end_year, source_name, source_kind, source_url, claim_note,
        rights_evidence_url, rights_note, submitted_by
    ) values (
        p_version_id, p_row_id, v_hash, v_row.first_trial_year,
        v_row.best_start_year, v_row.best_end_year, trim(p_source_name),
        p_source_kind, p_source_url, trim(p_claim_note),
        p_rights_evidence_url, trim(p_rights_note), auth.uid()
    ) returning id into v_id;
    return v_id;
end;
$$;

create function public.review_drinking_window_source_intake(
    p_intake_id uuid, p_expected_hash text, p_verdict text,
    p_review_note text, p_dates_checked boolean, p_rights_checked boolean
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    v_intake private.drinking_window_source_intake%rowtype;
    v_row public.drinking_window_reference_rows%rowtype;
    v_hash text;
    v_source_id uuid := gen_random_uuid();
    v_policy_id uuid := gen_random_uuid();
    v_evidence_id uuid := gen_random_uuid();
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    select * into v_intake from private.drinking_window_source_intake
    where id = p_intake_id for update;
    if not found or v_intake.status <> 'pending' then
        raise exception using errcode = '22023', message = 'Choose a pending source';
    end if;
    select r.* into v_row from public.drinking_window_reference_rows r
    join public.drinking_window_reference_versions v on v.id = r.version_id
    where r.id = v_intake.row_id and r.version_id = v_intake.version_id
      and r.scope = 'release' and v.status = 'draft';
    if not found then
        raise exception using errcode = '22023', message = 'The exact-release draft is no longer editable';
    end if;
    v_hash := private.drinking_window_review_subject_hash(v_intake.version_id, 'row', v_intake.row_id);
    if p_expected_hash is distinct from v_hash
       or (p_verdict = 'approve' and v_intake.row_hash <> v_hash) then
        raise exception using errcode = '40001',
            message = 'This draft changed; submit a new source assessment for the current dates';
    end if;
    if p_verdict is null or p_verdict not in ('approve', 'reject')
       or length(trim(coalesce(p_review_note, ''))) not between 20 and 2000 then
        raise exception using errcode = '22023', message = 'Choose a verdict and explain it';
    end if;
    if p_verdict = 'approve' then
        if p_dates_checked is distinct from true or p_rights_checked is distinct from true
           or (v_intake.first_trial_year, v_intake.best_start_year, v_intake.best_end_year)
              is distinct from
              (v_row.first_trial_year, v_row.best_start_year, v_row.best_end_year) then
            raise exception using errcode = '22023',
                message = 'Verify all three exact dates and the documented reuse rights';
        end if;
        if exists (select 1 from public.enrichment_evidence e
                   where e.release_id = v_row.release_id
                     and e.claim_type = 'maturity-window'
                     and e.source_record_url = v_intake.source_url
                     and e.review_status = 'reviewed') then
            raise exception using errcode = '23505',
                message = 'A reviewed source for this exact release already exists; link it instead';
        end if;
        insert into public.enrichment_sources (
            id, source_key, source_name, source_kind, homepage_url
        ) values (
            v_source_id, 'dw-document-' || replace(v_intake.id::text, '-', ''),
            v_intake.source_name, v_intake.source_kind, v_intake.source_url
        );
        insert into public.enrichment_source_policies (
            id, source_id, policy_version, status, effective_from,
            terms_checked_on, evidence_url, display_right,
            normalized_storage_right, raw_payload_storage_right,
            offline_sync_right, retention_right, cross_household_reuse_right,
            attribution_text, notes
        ) values (
            v_policy_id, v_source_id, 1, 'reviewed', current_date,
            current_date, v_intake.rights_evidence_url, 'allowed', 'allowed',
            'prohibited', 'prohibited', 'allowed', 'allowed',
            v_intake.source_name, v_intake.rights_note || ' Review: ' || trim(p_review_note)
        );
        insert into public.enrichment_evidence (
            id, source_id, source_policy_id, source_record_id,
            source_record_url, content_mode, claim_type, scope_level,
            release_id, wine_color, review_status, reviewed_by, reviewed_at
        ) values (
            v_evidence_id, v_source_id, v_policy_id,
            'dw-intake-' || v_intake.id::text, v_intake.source_url,
            'pointer-only', 'maturity-window', 'release', v_row.release_id,
            v_row.wine_color, 'reviewed', auth.uid(), now()
        );
    end if;
    update private.drinking_window_source_intake
    set status = case when p_verdict = 'approve' then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now(),
        review_note = trim(p_review_note),
        evidence_id = case when p_verdict = 'approve' then v_evidence_id else null end
    where id = p_intake_id;
    return jsonb_build_object(
        'status', case when p_verdict = 'approve' then 'approved' else 'rejected' end,
        'evidence_id', case when p_verdict = 'approve' then v_evidence_id else null end
    );
end;
$$;

revoke all on function public.get_drinking_window_source_intake(uuid, uuid) from public, anon;
revoke all on function public.submit_drinking_window_source_intake(uuid, uuid, text, text, text, text, text, text, text)
    from public, anon;
revoke all on function public.review_drinking_window_source_intake(uuid, text, text, text, boolean, boolean)
    from public, anon;
grant execute on function public.get_drinking_window_source_intake(uuid, uuid) to authenticated;
grant execute on function public.submit_drinking_window_source_intake(uuid, uuid, text, text, text, text, text, text, text)
    to authenticated;
grant execute on function public.review_drinking_window_source_intake(uuid, text, text, text, boolean, boolean)
    to authenticated;

commit;
