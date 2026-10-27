begin;

-- A cellar owner may contribute an exact-release suggestion without gaining
-- curator or publication privileges. The existing candidate queue remains
-- inert: a curator review draft is not a shared reference version.
alter table public.drinking_window_candidates
    add column submitted_by uuid references auth.users(id) on delete set null;

create unique index drinking_window_candidates_owner_submission_unique
    on public.drinking_window_candidates(submitted_by, source_sha256)
    where submitted_by is not null;

-- Keep new owner submissions visible even while the historical workbook
-- backlog fills the older, 100-row curator queue. The remainder of the
-- workspace contract is unchanged.
create or replace function public.get_drinking_window_review_workspace()
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
            ) order by (candidate.submitted_by is not null) desc,
                       candidate.created_at desc, candidate.id desc)
            from (
                select * from public.drinking_window_candidates
                where review_status <> 'rejected'
                order by (submitted_by is not null) desc,
                         created_at desc, id desc limit 100
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

create function public.submit_drinking_window_candidate_for_wine(
    p_wine_id uuid,
    p_first_trial_year integer,
    p_best_start_year integer,
    p_best_end_year integer,
    p_rationale text,
    p_evidence_urls text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wine public.wines%rowtype;
    v_release public.wine_reference_releases%rowtype;
    v_producer text;
    v_cuvee text;
    v_identity jsonb;
    v_hash text;
    v_id uuid := pg_catalog.gen_random_uuid();
    v_existing uuid;
begin
    if auth.uid() is null then
        raise exception using errcode = '42501', message = 'Sign in to suggest shared dates';
    end if;
    select * into v_wine from public.wines where id = p_wine_id;
    if not found or v_wine.merged_into_wine_id is not null or not exists (
        select 1 from public.household_members member
        where member.household_id = v_wine.household_id
          and member.user_id = auth.uid() and member.role = 'owner'
    ) then
        raise exception using errcode = '42501',
            message = 'Only a current cellar owner may suggest dates for this wine';
    end if;
    if v_wine.wine_reference_type is distinct from 'release'
       or v_wine.wine_reference_id is null
       or v_wine.vintage is null
       or v_wine.format_ml is null
       or v_wine.format_ml not between 50 and 30000
       or v_wine.color not in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other') then
        raise exception using errcode = '22023',
            message = 'Confirm an exact release, vintage, color and bottle size first';
    end if;
    select * into v_release from public.wine_reference_releases release
    where release.id = v_wine.wine_reference_id;
    if not found or v_release.vintage_year is distinct from v_wine.vintage then
        raise exception using errcode = '22023',
            message = 'The confirmed release must match the wine vintage';
    end if;
    select producer.canonical_name, product.canonical_name
    into v_producer, v_cuvee
    from public.wine_reference_products product
    join public.wine_reference_producers producer on producer.id = product.producer_id
    where product.id = v_release.product_id;
    if p_first_trial_year is null or p_best_start_year is null
       or p_best_end_year is null
       or p_first_trial_year < v_wine.vintage
       or p_first_trial_year > p_best_start_year
       or p_best_start_year > p_best_end_year
       or p_best_end_year > 2300
       or p_rationale is null or length(trim(p_rationale)) not between 20 and 2000
       or p_evidence_urls is null or cardinality(p_evidence_urls) > 10
       or exists (
           select 1 from unnest(p_evidence_urls) as url
           where url is null or length(url) > 1000
              or url !~ '^https://[^[:space:]]+$'
       ) then
        raise exception using errcode = '22023',
            message = 'Provide three ordered years, a reason and valid HTTPS evidence links';
    end if;

    v_identity := pg_catalog.jsonb_build_object(
        'origin', 'cellar-owner-proposal',
        'release_id', v_release.id,
        'format_ml', v_wine.format_ml,
        'producer', v_producer,
        'cuvee', v_cuvee,
        'appellation', v_wine.appellation,
        'region', v_wine.area,
        'color', v_wine.color,
        'rationale', trim(p_rationale),
        'evidence_urls', to_jsonb(p_evidence_urls)
    );
    v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
            'author', auth.uid(), 'identity', v_identity,
            'first_trial_year', p_first_trial_year,
            'best_start_year', p_best_start_year,
            'best_end_year', p_best_end_year
        )::text, 'UTF8'), 'sha256'), 'hex');
    select id into v_existing from public.drinking_window_candidates
    where submitted_by = auth.uid() and source_sha256 = v_hash;
    if v_existing is not null then
        return v_existing;
    end if;
    if (select count(*) from public.drinking_window_candidates
        where submitted_by = auth.uid() and review_status <> 'rejected') >= 20 then
        raise exception using errcode = '23514',
            message = 'Too many open suggestions; wait for review before adding more';
    end if;

    insert into public.drinking_window_candidates (
        id, source_sha256, source_locator, candidate_scope, source_identity,
        wine_color, vintage_year, first_trial_year, best_start_year,
        best_end_year, review_reason, submitted_by
    ) values (
        v_id, v_hash, 'cellar-owner-proposal:' || v_id::text, 'release',
        v_identity, v_wine.color, v_wine.vintage, p_first_trial_year,
        p_best_start_year, p_best_end_year,
        'Owner-submitted proposal: identity, source rights and dates need independent review.',
        auth.uid()
    ) on conflict do nothing returning id into v_existing;
    if v_existing is null then
        select id into v_existing from public.drinking_window_candidates
        where submitted_by = auth.uid() and source_sha256 = v_hash;
    end if;
    return v_existing;
end;
$$;

create function public.get_my_drinking_window_candidates_for_wine(p_wine_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_wine public.wines%rowtype;
begin
    select * into v_wine from public.wines where id = p_wine_id;
    if auth.uid() is null or not found or v_wine.merged_into_wine_id is not null
       or not exists (
           select 1 from public.household_members member
           where member.household_id = v_wine.household_id
             and member.user_id = auth.uid() and member.role = 'owner'
       ) then
        raise exception using errcode = '42501',
            message = 'Only a current cellar owner may see their suggestions';
    end if;
    if v_wine.wine_reference_type is distinct from 'release'
       or v_wine.wine_reference_id is null or v_wine.format_ml is null then
        return '[]'::jsonb;
    end if;
    return coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', candidate.id,
            'created_at', candidate.created_at,
            'review_status', candidate.review_status,
            'review_disposition', review.disposition,
            'first_trial_year', candidate.first_trial_year,
            'best_start_year', candidate.best_start_year,
            'best_end_year', candidate.best_end_year
        ) order by candidate.created_at desc, candidate.id desc)
        from public.drinking_window_candidates candidate
        left join lateral (
            select draft.disposition
            from private.drinking_window_candidate_review_drafts draft
            where draft.candidate_id = candidate.id
            order by draft.created_at desc, draft.id desc limit 1
        ) review on true
        where candidate.submitted_by = auth.uid()
          and candidate.source_identity ->> 'release_id' = v_wine.wine_reference_id::text
          and candidate.source_identity ->> 'format_ml' = v_wine.format_ml::text
    ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_drinking_window_review_workspace()
    from public, anon;
grant execute on function public.get_drinking_window_review_workspace()
    to authenticated;
revoke all on function public.submit_drinking_window_candidate_for_wine(
    uuid, integer, integer, integer, text, text[]) from public, anon;
revoke all on function public.get_my_drinking_window_candidates_for_wine(uuid)
    from public, anon;
grant execute on function public.submit_drinking_window_candidate_for_wine(
    uuid, integer, integer, integer, text, text[]) to authenticated;
grant execute on function public.get_my_drinking_window_candidates_for_wine(uuid)
    to authenticated;

commit;
