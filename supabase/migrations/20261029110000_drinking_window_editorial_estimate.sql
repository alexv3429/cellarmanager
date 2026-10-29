begin;

-- Imported research usually does not quote a source that states all three
-- proposed years. A curator may adopt a synthesis as a first-party estimate,
-- with explicit cross-household consent and retained source pointers. It is
-- never labelled as a producer/critic-published window.
create table private.drinking_window_editorial_estimates (
    evidence_id uuid primary key references public.enrichment_evidence(id),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    row_id uuid not null references public.drinking_window_reference_rows(id),
    author_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    rationale text not null check (length(pg_catalog.btrim(rationale)) between 30 and 2000),
    supporting_urls text[] not null check (cardinality(supporting_urls) between 1 and 10),
    consent_text text not null,
    consented_at timestamptz not null default now(),
    first_trial_year integer not null,
    best_start_year integer not null,
    best_end_year integer not null
);
revoke all on private.drinking_window_editorial_estimates
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_editorial_estimates to service_role;

create function public.attest_drinking_window_editorial_estimate(
    p_version_id uuid, p_row_id uuid, p_expected_hash text,
    p_rationale text, p_supporting_urls text[], p_adopt_and_share boolean
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    v_row public.drinking_window_reference_rows%rowtype;
    v_url text;
    v_note_id uuid := pg_catalog.gen_random_uuid();
    v_source_id uuid := pg_catalog.gen_random_uuid();
    v_policy_id uuid := pg_catalog.gen_random_uuid();
    v_evidence_id uuid := pg_catalog.gen_random_uuid();
    v_note_url text;
    v_consent text := 'I have reviewed and adopt these three dates as my own editorial estimate for the shared CellarManager reference. I authorize its display and reuse across households. The linked external pages are context, not publications of these exact dates.';
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    select r.* into v_row from public.drinking_window_reference_rows r
    join public.drinking_window_reference_versions v on v.id = r.version_id
    where r.id = p_row_id and r.version_id = p_version_id
      and v.status = 'draft' for update of r;
    if not found then
        raise exception using errcode = '22023', message = 'Choose an unpublished reference window';
    end if;
    if p_expected_hash is distinct from private.drinking_window_review_subject_hash(
        p_version_id, 'row', p_row_id) then
        raise exception using errcode = '40001', message = 'This window changed; refresh before attesting';
    end if;
    if p_adopt_and_share is distinct from true
       or length(pg_catalog.btrim(coalesce(p_rationale, ''))) not between 30 and 2000
       or p_supporting_urls is null or pg_catalog.cardinality(p_supporting_urls) not between 1 and 10
       or pg_catalog.array_position(p_supporting_urls, null) is not null then
        raise exception using errcode = '22023',
            message = 'Review the estimate, give context links, and explicitly authorize shared reuse';
    end if;
    foreach v_url in array p_supporting_urls loop
        if length(v_url) > 1000 or v_url !~ '^https://[^[:space:]]+$' then
            raise exception using errcode = '22023', message = 'Only HTTPS context links are accepted';
        end if;
    end loop;
    v_note_url := 'https://cellarmanager.cellarcloud.workers.dev/catalog?editorial-evidence=' || v_evidence_id::text;
    insert into public.enrichment_sources (id, source_key, source_name, source_kind, homepage_url)
    values (v_source_id, 'dw-editorial-' || replace(v_note_id::text, '-', ''),
        'CellarManager editorial estimate (not producer-published)', 'cellarmanager',
        'https://cellarmanager.cellarcloud.workers.dev/');
    insert into public.enrichment_source_policies (
        id, source_id, policy_version, status, effective_from, terms_checked_on,
        evidence_url, display_right, normalized_storage_right, raw_payload_storage_right,
        offline_sync_right, retention_right, cross_household_reuse_right,
        attribution_text, notes
    ) values (
        v_policy_id, v_source_id, 1, 'reviewed', current_date, current_date,
        v_note_url, 'allowed', 'allowed', 'prohibited', 'prohibited', 'allowed', 'allowed',
        'CellarManager editorial estimate', v_consent
    );
    insert into public.enrichment_evidence (
        id, source_id, source_policy_id, source_record_id, source_record_url,
        content_mode, claim_type, scope_level, release_id, place_id, producer_id,
        vintage_year, wine_color, claim_value, review_status, reviewed_by, reviewed_at
    ) values (
        v_evidence_id, v_source_id, v_policy_id, 'editorial-' || v_note_id::text, v_note_url,
        'normalized-claim', 'maturity-window',
        case when v_row.scope = 'release' then 'release' else 'vintage' end,
        case when v_row.scope = 'release' then v_row.release_id else null end,
        case when v_row.scope = 'release' then null else coalesce(v_row.appellation_id, v_row.region_id) end,
        null,
        case when v_row.scope = 'release' then null else v_row.vintage_year end,
        v_row.wine_color,
        pg_catalog.jsonb_build_object('first_trial_year', v_row.first_trial_year,
            'best_start_year', v_row.best_start_year, 'best_end_year', v_row.best_end_year,
            'editorial_estimate', true, 'rationale', pg_catalog.btrim(p_rationale)),
        'reviewed', auth.uid(), now()
    );
    insert into private.drinking_window_editorial_estimates (
        evidence_id, version_id, row_id, author_id, rationale,
        supporting_urls, consent_text, first_trial_year, best_start_year, best_end_year
    ) values (
        v_evidence_id, p_version_id, p_row_id, auth.uid(), pg_catalog.btrim(p_rationale),
        p_supporting_urls, v_consent, v_row.first_trial_year,
        v_row.best_start_year, v_row.best_end_year
    );
    insert into public.drinking_window_reference_evidence (
        version_id, reference_row_id, evidence_id, claim_part, evidence_role
    ) values
        (p_version_id, p_row_id, v_evidence_id, 'first_trial', 'supports'),
        (p_version_id, p_row_id, v_evidence_id, 'optimal_period', 'supports');
    return pg_catalog.jsonb_build_object('evidence_id', v_evidence_id,
        'source_url', v_note_url, 'published', false);
end;
$$;
revoke all on function public.attest_drinking_window_editorial_estimate(uuid,uuid,text,text,text[],boolean)
from public, anon;
grant execute on function public.attest_drinking_window_editorial_estimate(uuid,uuid,text,text,text[],boolean)
to authenticated;

create function public.get_drinking_window_editorial_estimate(p_evidence_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_note private.drinking_window_editorial_estimates%rowtype;
begin
    if auth.uid() is null then
        raise exception using errcode = '42501', message = 'Sign in to read this shared estimate';
    end if;
    select * into v_note from private.drinking_window_editorial_estimates
    where evidence_id = p_evidence_id;
    if not found or not exists (
        select 1 from public.drinking_window_reference_evidence l
        join public.drinking_window_reference_versions v on v.id = l.version_id
        where l.evidence_id = p_evidence_id and v.status = 'active'
    ) and not exists (
        select 1 from public.enrichment_curator_eligibilities c
        where c.user_id = auth.uid() and c.eligibility_status = 'active'
          and 'drinking-window' = any(c.profile_scopes)
    ) then
        raise exception using errcode = '22023', message = 'Estimate not available';
    end if;
    return pg_catalog.jsonb_build_object(
        'first_trial_year', v_note.first_trial_year,
        'best_start_year', v_note.best_start_year,
        'best_end_year', v_note.best_end_year,
        'rationale', v_note.rationale,
        'supporting_urls', to_jsonb(v_note.supporting_urls),
        'attribution', 'CellarManager editorial estimate; not a producer-published window',
        'consented_at', v_note.consented_at
    );
end;
$$;
revoke all on function public.get_drinking_window_editorial_estimate(uuid) from public, anon;
grant execute on function public.get_drinking_window_editorial_estimate(uuid) to authenticated;

-- The linked editorial claim must always refer to the current three years.
-- A date edit invalidates the link until fresh editorial attestation is made.
create function private.drinking_window_editorial_date_issues(p_version_id uuid)
returns table (issue_code text, subject_kind text, subject_id uuid, related_id uuid)
language sql stable set search_path = ''
as $$
    select 'editorial_claim_dates_changed'::text, 'row'::text, r.id, n.evidence_id
    from private.drinking_window_editorial_estimates n
    join public.drinking_window_reference_evidence l on l.evidence_id = n.evidence_id
    join public.drinking_window_reference_rows r on r.id = l.reference_row_id
    where l.version_id = p_version_id
      and (n.first_trial_year, n.best_start_year, n.best_end_year)
          is distinct from (r.first_trial_year, r.best_start_year, r.best_end_year)
    group by r.id, n.evidence_id;
$$;
revoke all on function private.drinking_window_editorial_date_issues(uuid)
from public, anon, authenticated;

create or replace function public.drinking_window_publication_issues(p_version_id uuid)
returns table (check_name text, issue_code text, subject_kind text,
    subject_id uuid, related_id uuid)
language plpgsql stable set search_path = ''
as $$
begin
    -- A published version was already checked at publication. Owners must
    -- still be able to compare or opt into it afterwards; editorial checks
    -- apply only to mutable drafts.
    if exists (select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status in ('active', 'superseded')
          and v.content_sha256 is not null) then
        return;
    end if;
    if not exists (select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft') then
        raise exception using errcode = '22023', message = 'A draft reference version is required';
    end if;
    return query
    select 'structure'::text, i.issue_code, i.subject_kind, i.subject_id, i.related_id
    from public.drinking_window_draft_issues(p_version_id) i
    union all
    select 'eligibility'::text, i.issue_code, i.subject_kind, i.subject_id, i.related_id
    from public.drinking_window_eligibility_issues(p_version_id) i
    union all
    select 'evidence_fit'::text, i.issue_code, i.subject_kind, i.subject_id, i.related_id
    from public.drinking_window_evidence_fit_issues(p_version_id) i
    union all
    select 'editorial'::text, i.issue_code, i.subject_kind, i.subject_id, i.related_id
    from private.drinking_window_editorial_date_issues(p_version_id) i
    union all
    select 'review'::text, i.issue_code, i.subject_kind, i.subject_id, i.related_id
    from public.drinking_window_review_issues(p_version_id) i;
end;
$$;

commit;
