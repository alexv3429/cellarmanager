begin;

-- Review drafts are append-only and never become effective drinking-window
-- references. The original workbook candidate remains untouched.
create table private.drinking_window_candidate_review_drafts (
    id uuid primary key default gen_random_uuid(),
    candidate_id uuid not null references public.drinking_window_candidates(id),
    proposed_scope text not null check (proposed_scope in (
        'release', 'producer_appellation', 'producer_region', 'appellation', 'region'
    )),
    first_trial_year integer,
    best_start_year integer,
    best_end_year integer,
    ageing_group_note text not null default '' check (length(ageing_group_note) <= 500),
    rationale text not null check (length(trim(rationale)) between 10 and 2000),
    evidence_urls text[] not null default '{}',
    rights_status text not null check (rights_status in ('unverified', 'reuse-allowed', 'restricted')),
    disposition text not null check (disposition in ('investigate', 'propose', 'reject')),
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    created_at timestamptz not null default now(),
    constraint drinking_window_candidate_review_years_check check (
        (first_trial_year is null or first_trial_year between 1800 and 2300)
        and (best_start_year is null or best_start_year between 1800 and 2300)
        and (best_end_year is null or best_end_year between 1800 and 2300)
        and (first_trial_year is null or best_start_year is null or first_trial_year <= best_start_year)
        and (best_start_year is null or best_end_year is null or best_start_year <= best_end_year)
    )
);
create index drinking_window_candidate_review_latest_idx
    on private.drinking_window_candidate_review_drafts(candidate_id, created_at desc, id desc);
revoke all on private.drinking_window_candidate_review_drafts
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_candidate_review_drafts to service_role;

create function public.get_drinking_window_review_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from public.enrichment_curator_eligibilities curator
        where curator.user_id = auth.uid()
          and curator.eligibility_status = 'active'
          and 'drinking-window' = any(curator.profile_scopes)
    ) then
        return pg_catalog.jsonb_build_object(
            'eligible', false, 'identity_requests', '[]'::jsonb,
            'candidates', '[]'::jsonb
        );
    end if;

    return pg_catalog.jsonb_build_object(
        'eligible', true,
        'identity_requests', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', request.id,
                'requested_at', request.requested_at,
                'producer', request.source_snapshot ->> 'producer',
                'cuvee', request.source_snapshot ->> 'cuvee',
                'vintage', request.source_snapshot -> 'vintage',
                'color', request.source_snapshot ->> 'color',
                'appellation', request.source_snapshot ->> 'appellation',
                'region', request.source_snapshot ->> 'area',
                'source_changed', wine.id is null or wine.merged_into_wine_id is not null
                    or private.wine_reference_source_fingerprint(wine)
                        is distinct from request.source_fingerprint
            ) order by request.requested_at, request.id)
            from (
                select * from private.household_wine_identity_requests
                where status = 'pending'
                order by requested_at, id limit 100
            ) request
            left join public.wines wine on wine.id = request.wine_id
        ), '[]'::jsonb),
        'candidates', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', candidate.id,
                'source_locator', candidate.source_locator,
                'source_identity', candidate.source_identity,
                'candidate_scope', candidate.candidate_scope,
                'review_reason', candidate.review_reason,
                'wine_color', candidate.wine_color,
                'vintage_year', candidate.vintage_year,
                'first_trial_year', candidate.first_trial_year,
                'best_start_year', candidate.best_start_year,
                'best_end_year', candidate.best_end_year,
                'review', case when draft.id is null then null else
                    pg_catalog.jsonb_build_object(
                        'id', draft.id,
                        'proposed_scope', draft.proposed_scope,
                        'first_trial_year', draft.first_trial_year,
                        'best_start_year', draft.best_start_year,
                        'best_end_year', draft.best_end_year,
                        'ageing_group_note', draft.ageing_group_note,
                        'rationale', draft.rationale,
                        'evidence_urls', draft.evidence_urls,
                        'rights_status', draft.rights_status,
                        'disposition', draft.disposition,
                        'created_at', draft.created_at
                    ) end
            ) order by candidate.created_at, candidate.id)
            from (
                select * from public.drinking_window_candidates
                where review_status <> 'rejected'
                order by created_at, id limit 100
            ) candidate
            left join lateral (
                select * from private.drinking_window_candidate_review_drafts review
                where review.candidate_id = candidate.id
                order by review.created_at desc, review.id desc limit 1
            ) draft on true
        ), '[]'::jsonb)
    );
end;
$$;

create function public.save_drinking_window_candidate_review(
    p_candidate_id uuid,
    p_expected_review_id uuid,
    p_proposed_scope text,
    p_first_trial_year integer,
    p_best_start_year integer,
    p_best_end_year integer,
    p_ageing_group_note text,
    p_rationale text,
    p_evidence_urls text[],
    p_rights_status text,
    p_disposition text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_candidate public.drinking_window_candidates%rowtype;
    v_current_id uuid;
    v_review_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select * into v_candidate from public.drinking_window_candidates
    where id = p_candidate_id for update;
    if not found or v_candidate.review_status = 'rejected' then
        raise exception using errcode = '22023', message = 'Reviewable candidate not found';
    end if;
    select id into v_current_id from private.drinking_window_candidate_review_drafts
    where candidate_id = p_candidate_id
    order by created_at desc, id desc limit 1;
    if v_current_id is distinct from p_expected_review_id then
        raise exception using errcode = '40001', message = 'Candidate review changed; refresh before saving';
    end if;
    if p_proposed_scope not in ('release', 'producer_appellation', 'producer_region', 'appellation', 'region')
       or p_rights_status not in ('unverified', 'reuse-allowed', 'restricted')
       or p_disposition not in ('investigate', 'propose', 'reject')
       or p_rationale is null or length(trim(p_rationale)) not between 10 and 2000
       or length(coalesce(p_ageing_group_note, '')) > 500
       or p_evidence_urls is null or cardinality(p_evidence_urls) > 10
       or exists (select 1 from unnest(p_evidence_urls) as url
                  where url is null or length(url) > 1000 or url !~ '^https://[^[:space:]]+$')
       or (p_first_trial_year is not null and p_first_trial_year not between 1800 and 2300)
       or (p_best_start_year is not null and p_best_start_year not between 1800 and 2300)
       or (p_best_end_year is not null and p_best_end_year not between 1800 and 2300)
       or (p_first_trial_year is not null and v_candidate.vintage_year is not null
           and p_first_trial_year < v_candidate.vintage_year)
       or (p_first_trial_year is not null and p_best_start_year is not null
           and p_first_trial_year > p_best_start_year)
       or (p_best_start_year is not null and p_best_end_year is not null
           and p_best_start_year > p_best_end_year)
       or (p_disposition = 'propose' and (
           p_first_trial_year is null or p_best_start_year is null or p_best_end_year is null
           or cardinality(p_evidence_urls) = 0 or p_rights_status <> 'reuse-allowed'
       )) then
        raise exception using errcode = '22023', message = 'Candidate review is incomplete or invalid';
    end if;

    insert into private.drinking_window_candidate_review_drafts (
        candidate_id, proposed_scope, first_trial_year, best_start_year,
        best_end_year, ageing_group_note, rationale, evidence_urls,
        rights_status, disposition, curator_id
    ) values (
        p_candidate_id, p_proposed_scope, p_first_trial_year, p_best_start_year,
        p_best_end_year, coalesce(trim(p_ageing_group_note), ''), trim(p_rationale),
        p_evidence_urls, p_rights_status, p_disposition, auth.uid()
    ) returning id into v_review_id;
    return v_review_id;
end;
$$;

revoke all on function public.get_drinking_window_review_workspace() from public, anon;
revoke all on function public.save_drinking_window_candidate_review(
    uuid, uuid, text, integer, integer, integer, text, text, text[], text, text
) from public, anon;
grant execute on function public.get_drinking_window_review_workspace() to authenticated;
grant execute on function public.save_drinking_window_candidate_review(
    uuid, uuid, text, integer, integer, integer, text, text, text[], text, text
) to authenticated;

commit;
