begin;

-- Use the indexed full producer name to build a small pool before applying
-- the more expensive distinctive-term comparison introduced above.
create or replace function public.get_enrichment_research_producer_candidates(
    p_household_id uuid,
    p_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine public.wines%rowtype;
    v_source_producer text;
    v_source_terms text;
    v_candidates jsonb;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Household access is required';
    end if;

    select wine.*
    into v_wine
    from public.enrichment_research_cases research_case
    join public.enrichment_research_subscriptions subscription
      on subscription.case_id = research_case.id
     and subscription.household_id = p_household_id
    join public.wines wine
      on wine.id = subscription.exemplar_wine_id
     and wine.household_id = subscription.household_id
    where research_case.id = p_case_id
      and research_case.case_status = 'needs-identity-review'
      and research_case.subject_type = 'producer-profile';

    if not found then
        raise exception using errcode = '22023', message = 'Producer identity review is not available';
    end if;

    v_source_producer := private.normalize_wine_reference_text(v_wine.producer);
    v_source_terms := private.wine_reference_producer_identity_terms(
        v_wine.producer
    );

    with pool as materialized (
        select entry.*
        from public.wine_reference_lwin_entries entry
        join public.wine_reference_lwin_snapshots snapshot
          on snapshot.id = entry.snapshot_id
        where snapshot.source_key = 'liv-ex-lwin'
          and snapshot.import_status = 'active'
          and entry.source_status = 'live'
          and (
              entry.producer_search OPERATOR(extensions.%) v_source_producer
              or entry.producer_search like '%' || v_source_producer || '%'
              or v_source_producer like '%' || entry.producer_search || '%'
          )
    ), grouped as (
        select
            pool.producer_search as producer_key,
            min(pool.producer_name) as canonical_name,
            max(greatest(
                extensions.similarity(v_source_producer, pool.producer_search),
                extensions.similarity(
                    v_source_terms,
                    private.wine_reference_producer_identity_terms(
                        pool.producer_search
                    )
                )
            )) as score
        from pool
        where v_source_terms <> ''
          and private.wine_reference_producer_identity_terms(
              pool.producer_search
          ) <> ''
          and extensions.similarity(
              v_source_terms,
              private.wine_reference_producer_identity_terms(
                  pool.producer_search
              )
          ) >= 0.25
        group by pool.producer_search
    ), ranked as (
        select grouped.*
        from grouped
        where grouped.score >= 0.25
        order by grouped.score desc, grouped.canonical_name
        limit 5
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'producer_key', ranked.producer_key,
        'canonical_name', ranked.canonical_name,
        'score', round(ranked.score::numeric, 3),
        'examples', coalesce(examples.items, '[]'::jsonb)
    ) order by ranked.score desc, ranked.canonical_name), '[]'::jsonb)
    into v_candidates
    from ranked
    left join lateral (
        select jsonb_agg(sample.display_name order by sample.display_name) as items
        from (
            select distinct pool.display_name
            from pool
            where pool.producer_search = ranked.producer_key
              and nullif(trim(pool.display_name), '') is not null
            order by pool.display_name
            limit 3
        ) sample
    ) examples on true;

    return jsonb_build_object(
        'status', 'available',
        'candidates', v_candidates
    );
end;
$$;

commit;
