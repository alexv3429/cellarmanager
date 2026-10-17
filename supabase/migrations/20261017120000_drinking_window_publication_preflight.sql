begin;

-- Collect every independent draft gate in one service-only report. This is a
-- preflight for a *future* publisher, not permission to activate a version.
create function public.drinking_window_publication_issues(p_version_id uuid)
returns table (
    check_name text, issue_code text, subject_kind text,
    subject_id uuid, related_id uuid
)
language plpgsql
stable
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft'
    ) then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;

    return query
    select 'structure'::text, i.issue_code, i.subject_kind,
        i.subject_id, i.related_id
    from public.drinking_window_draft_issues(p_version_id) i
    union all
    select 'eligibility'::text, i.issue_code, i.subject_kind,
        i.subject_id, i.related_id
    from public.drinking_window_eligibility_issues(p_version_id) i
    union all
    select 'evidence_fit'::text, i.issue_code, i.subject_kind,
        i.subject_id, i.related_id
    from public.drinking_window_evidence_fit_issues(p_version_id) i
    union all
    select 'review'::text, i.issue_code, i.subject_kind,
        i.subject_id, i.related_id
    from public.drinking_window_review_issues(p_version_id) i;
end;
$$;

revoke all on function public.drinking_window_publication_issues(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_publication_issues(uuid)
to service_role;

-- The fingerprint binds a review report to the exact version contents and
-- directly linked source/rights and curator state. The later publisher must
-- recompute the gates and fingerprint: a preflight is never a certificate.
create function public.drinking_window_draft_fingerprint(p_version_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
    v_snapshot jsonb;
begin
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft'
    ) then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;

    select jsonb_build_object(
        'version_id', p_version_id,
        'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
            from public.drinking_window_reference_rows r
            where r.version_id = p_version_id),
        'groups', (select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb)
            from public.drinking_window_ageing_groups g
            where g.version_id = p_version_id),
        'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
            from public.drinking_window_ageing_group_memberships m
            where m.version_id = p_version_id),
        'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
            'link', to_jsonb(l), 'evidence', to_jsonb(e),
            'source', to_jsonb(s), 'policy', to_jsonb(p)
        ) order by l.id), '[]'::jsonb)
            from public.drinking_window_reference_evidence l
            join public.enrichment_evidence e on e.id = l.evidence_id
            join public.enrichment_sources s on s.id = e.source_id
            join public.enrichment_source_policies p on p.id = e.source_policy_id
            where l.version_id = p_version_id),
        'reviews', (select coalesce(jsonb_agg(jsonb_build_object(
            'review', to_jsonb(r), 'curator', to_jsonb(c)
        ) order by r.decision_sequence), '[]'::jsonb)
            from public.drinking_window_reference_reviews r
            join public.enrichment_curator_eligibilities c
              on c.user_id = r.curator_id
            where r.version_id = p_version_id)
    ) into v_snapshot;

    return pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_snapshot::text, 'UTF8'), 'sha256'
    ), 'hex');
end;
$$;

revoke all on function public.drinking_window_draft_fingerprint(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_draft_fingerprint(uuid)
to service_role;

-- Append-only snapshots make it possible to see exactly which version was
-- checked, which gates failed, and whether a later edit changed that draft.
create table private.drinking_window_publication_preflights (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    issues jsonb not null check (jsonb_typeof(issues) = 'array'),
    issue_count integer not null check (issue_count >= 0),
    checked_at timestamptz not null default now()
);

create index drinking_window_publication_preflights_version_idx
on private.drinking_window_publication_preflights(version_id, checked_at desc);

revoke all on private.drinking_window_publication_preflights
from public, anon, authenticated, powersync_role, service_role;

create function private.reject_drinking_window_preflight_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception using errcode = '23514',
        message = 'Drinking-window publication preflight history is immutable';
end;
$$;

revoke all on function private.reject_drinking_window_preflight_change()
from public, anon, authenticated, powersync_role, service_role;

create trigger drinking_window_publication_preflights_immutable
before update or delete on private.drinking_window_publication_preflights
for each row execute function private.reject_drinking_window_preflight_change();

create function public.record_drinking_window_publication_preflight(p_version_id uuid)
returns table (preflight_id uuid, content_sha256 text, issue_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_issues jsonb;
    v_hash text;
    v_count integer;
    v_id uuid;
begin
    -- Serialise the draft snapshot against version changes. This does not
    -- lock external source metadata; later publication must revalidate it.
    perform 1 from public.drinking_window_reference_versions v
    where v.id = p_version_id and v.status = 'draft'
    for update;
    if not found then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;

    select count(*)::integer,
        coalesce(jsonb_agg(jsonb_build_object(
            'check', i.check_name, 'code', i.issue_code,
            'subject_kind', i.subject_kind, 'subject_id', i.subject_id,
            'related_id', i.related_id
        ) order by i.check_name, i.subject_kind, i.subject_id,
            i.issue_code, i.related_id), '[]'::jsonb)
    into v_count, v_issues
    from public.drinking_window_publication_issues(p_version_id) i;

    v_hash := public.drinking_window_draft_fingerprint(p_version_id);
    insert into private.drinking_window_publication_preflights
        (version_id, content_sha256, issues, issue_count)
    values (p_version_id, v_hash, v_issues, v_count)
    returning id into v_id;

    return query select v_id, v_hash, v_count;
end;
$$;

revoke all on function public.record_drinking_window_publication_preflight(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.record_drinking_window_publication_preflight(uuid)
to service_role;

-- Deliberately do not change block_drinking_window_reference_publication,
-- content_sha256, or any visible drinking-window reader in this migration.
commit;
