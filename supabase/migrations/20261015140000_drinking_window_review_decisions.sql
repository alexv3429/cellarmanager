begin;

-- Drinking-window review is a distinct grant. Existing profile curators do
-- not gain this authority automatically.
alter table public.enrichment_curator_eligibilities
    drop constraint enrichment_curator_scopes_check;
alter table public.enrichment_curator_eligibilities
    add constraint enrichment_curator_scopes_check check (
        cardinality(profile_scopes) between 1 and 8
        and profile_scopes <@ array[
            'place', 'place-adjustment', 'vintage', 'producer-era',
            'producer-vintage-interaction', 'cuvee', 'release',
            'drinking-window'
        ]::text[]
        and array_position(profile_scopes, null) is null
    );

-- Hash the complete target and all its linked evidence/policy state. An edit
-- to years, applicability, evidence, evidence review, or rights makes an old
-- decision stale. The snapshot is for review invalidation, not publication.
create function private.drinking_window_review_subject_hash(
    p_version_id uuid, p_subject_kind text, p_subject_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_subject jsonb;
    v_evidence jsonb;
begin
    case p_subject_kind
        when 'row' then
            select to_jsonb(r) into v_subject
            from public.drinking_window_reference_rows r
            where r.id = p_subject_id and r.version_id = p_version_id;
        when 'group' then
            select to_jsonb(g) into v_subject
            from public.drinking_window_ageing_groups g
            where g.id = p_subject_id and g.version_id = p_version_id;
        when 'membership' then
            select to_jsonb(m) into v_subject
            from public.drinking_window_ageing_group_memberships m
            where m.id = p_subject_id and m.version_id = p_version_id;
        else
            raise exception using errcode = '22023',
                message = 'Drinking-window review subject kind is invalid';
    end case;

    if v_subject is null then
        raise exception using errcode = 'P0002',
            message = 'Drinking-window review subject does not exist in this version';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'link', to_jsonb(l),
        'evidence', to_jsonb(e),
        'source', to_jsonb(s),
        'policy', to_jsonb(p)
    ) order by l.id), '[]'::jsonb)
    into v_evidence
    from public.drinking_window_reference_evidence l
    join public.enrichment_evidence e on e.id = l.evidence_id
    join public.enrichment_sources s on s.id = e.source_id
    join public.enrichment_source_policies p on p.id = e.source_policy_id
    where l.version_id = p_version_id
      and (
          (p_subject_kind = 'row' and l.reference_row_id = p_subject_id)
          or (p_subject_kind = 'group' and l.ageing_group_id = p_subject_id)
          or (p_subject_kind = 'membership' and l.membership_id = p_subject_id)
      );

    return pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(jsonb_build_object(
            'subject', v_subject, 'evidence', v_evidence
        )::text, 'UTF8'), 'sha256'
    ), 'hex');
end;
$$;

revoke all on function private.drinking_window_review_subject_hash(uuid, text, uuid)
from public, anon, authenticated, powersync_role;
grant execute on function private.drinking_window_review_subject_hash(uuid, text, uuid)
to service_role;

-- Append-only human decisions. A reviewed target cannot be deleted out from
-- under its audit record, but may be edited; edits invalidate the snapshot.
create table public.drinking_window_reference_reviews (
    id uuid primary key default gen_random_uuid(),
    decision_sequence bigint generated always as identity unique,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    reference_row_id uuid,
    ageing_group_id uuid,
    membership_id uuid,
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    verdict text not null check (verdict in ('approve', 'disagree')),
    rationale text not null check (length(trim(rationale)) between 10 and 2000),
    subject_sha256 text not null check (subject_sha256 ~ '^[0-9a-f]{64}$'),
    decided_at timestamptz not null default now(),
    constraint drinking_window_reviews_row_version_fk
        foreign key (reference_row_id, version_id)
        references public.drinking_window_reference_rows(id, version_id),
    constraint drinking_window_reviews_group_version_fk
        foreign key (ageing_group_id, version_id)
        references public.drinking_window_ageing_groups(id, version_id),
    constraint drinking_window_reviews_membership_version_fk
        foreign key (membership_id, version_id)
        references public.drinking_window_ageing_group_memberships(id, version_id),
    constraint drinking_window_reviews_one_subject_check
        check (num_nonnulls(reference_row_id, ageing_group_id, membership_id) = 1)
);

create index drinking_window_reviews_target_idx
    on public.drinking_window_reference_reviews(version_id, decision_sequence desc);

create function private.guard_drinking_window_reference_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_kind text;
    v_subject_id uuid;
begin
    if tg_op <> 'INSERT' then
        raise exception using errcode = '23514',
            message = 'Drinking-window review history is immutable';
    end if;

    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = new.version_id and v.status = 'draft'
    ) then
        raise exception using errcode = '23514',
            message = 'Only a draft drinking-window version can be reviewed';
    end if;

    if not exists (
        select 1 from public.enrichment_curator_eligibilities c
        where c.user_id = new.curator_id
          and c.eligibility_status = 'active'
          and 'drinking-window' = any(c.profile_scopes)
    ) then
        raise exception using errcode = '42501',
            message = 'An active drinking-window curator grant is required';
    end if;

    v_kind := case when new.reference_row_id is not null then 'row'
        when new.ageing_group_id is not null then 'group'
        when new.membership_id is not null then 'membership' end;
    v_subject_id := coalesce(
        new.reference_row_id, new.ageing_group_id, new.membership_id
    );
    if v_kind is null then
        raise exception using errcode = '23514',
            message = 'A review must name exactly one draft subject';
    end if;

    new.subject_sha256 := private.drinking_window_review_subject_hash(
        new.version_id, v_kind, v_subject_id
    );
    new.decided_at := now();
    return new;
end;
$$;

revoke all on function private.guard_drinking_window_reference_review()
from public, anon, authenticated, powersync_role;

create trigger drinking_window_reviews_guard
before insert or update or delete on public.drinking_window_reference_reviews
for each row execute function private.guard_drinking_window_reference_review();

alter table public.drinking_window_reference_reviews enable row level security;
revoke all privileges on table public.drinking_window_reference_reviews
from public, anon, authenticated, powersync_role;
grant select, insert on table public.drinking_window_reference_reviews to service_role;
grant usage on sequence public.drinking_window_reference_reviews_decision_sequence_seq
to service_role;

-- A second service-only report keeps the decision gate separate from the
-- structural/evidence report added earlier. Both must be clear eventually;
-- neither report can publish a version.
create function public.drinking_window_review_issues(p_version_id uuid)
returns table (issue_code text, subject_kind text, subject_id uuid, related_id uuid)
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
    with subjects as (
        select 'row'::text as kind, r.id
        from public.drinking_window_reference_rows r where r.version_id = p_version_id
        union all
        select 'group', g.id
        from public.drinking_window_ageing_groups g where g.version_id = p_version_id
        union all
        select 'membership', m.id
        from public.drinking_window_ageing_group_memberships m
        where m.version_id = p_version_id
    ),
    hashes as (
        select s.kind, s.id,
            private.drinking_window_review_subject_hash(p_version_id, s.kind, s.id)
                as current_hash
        from subjects s
    ),
    current_decisions as (
        select distinct on (h.kind, h.id, review.curator_id)
            h.kind, h.id, review.curator_id, review.verdict,
            curator.eligibility_status, curator.profile_scopes,
            (review.decided_at >= curator.granted_at) as grant_is_current
        from hashes h
        join public.drinking_window_reference_reviews review
          on review.version_id = p_version_id
         and review.subject_sha256 = h.current_hash
         and ((h.kind = 'row' and review.reference_row_id = h.id)
              or (h.kind = 'group' and review.ageing_group_id = h.id)
              or (h.kind = 'membership' and review.membership_id = h.id))
        join public.enrichment_curator_eligibilities curator
          on curator.user_id = review.curator_id
        order by h.kind, h.id, review.curator_id,
            review.decision_sequence desc
    ),
    issues as (
        select 'missing_current_approval'::text as code, h.kind, h.id,
            null::uuid as other_id
        from hashes h
        where not exists (
            select 1 from current_decisions d
            where d.kind = h.kind and d.id = h.id and d.verdict = 'approve'
              and d.eligibility_status = 'active'
              and d.grant_is_current
              and 'drinking-window' = any(d.profile_scopes)
        )
        union all
        select 'stale_review', h.kind, h.id, null::uuid
        from hashes h
        where exists (
            select 1 from public.drinking_window_reference_reviews review
            where review.version_id = p_version_id
              and ((h.kind = 'row' and review.reference_row_id = h.id)
                   or (h.kind = 'group' and review.ageing_group_id = h.id)
                   or (h.kind = 'membership' and review.membership_id = h.id))
              and review.subject_sha256 <> h.current_hash
        )
          and not exists (
              select 1 from current_decisions d
              where d.kind = h.kind and d.id = h.id
          )
        union all
        select 'disputed_review', d.kind, d.id, d.curator_id
        from current_decisions d
        where d.verdict = 'disagree'
    )
    select i.code, i.kind, i.id, i.other_id from issues i
    order by i.kind, i.id, i.code, i.other_id;
end;
$$;

revoke all on function public.drinking_window_review_issues(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_review_issues(uuid)
to service_role;

commit;
