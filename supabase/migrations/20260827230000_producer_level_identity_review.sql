begin;

-- Producer-profile research needs a canonical producer, not necessarily an
-- exact LWIN product. This bounded review path keeps exact-wine matching strict
-- while allowing the owner to confirm one producer name already present in
-- the active LWIN dictionary.
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

    with grouped as (
        select
            entry.producer_search as producer_key,
            min(entry.producer_name) as canonical_name,
            max(greatest(
                extensions.similarity(v_source_producer, entry.producer_search),
                extensions.word_similarity(v_source_producer, entry.producer_search),
                extensions.word_similarity(entry.producer_search, v_source_producer)
            )) as score
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
              or extensions.word_similarity(
                  v_source_producer,
                  entry.producer_search
              ) >= 0.25
              or extensions.word_similarity(
                  entry.producer_search,
                  v_source_producer
              ) >= 0.25
          )
        group by entry.producer_search
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
            select distinct entry.display_name
            from public.wine_reference_lwin_entries entry
            join public.wine_reference_lwin_snapshots snapshot
              on snapshot.id = entry.snapshot_id
            where snapshot.source_key = 'liv-ex-lwin'
              and snapshot.import_status = 'active'
              and entry.source_status = 'live'
              and entry.producer_search = ranked.producer_key
              and nullif(trim(entry.display_name), '') is not null
            order by entry.display_name
            limit 3
        ) sample
    ) examples on true;

    return jsonb_build_object(
        'status', 'available',
        'candidates', v_candidates
    );
end;
$$;

revoke all
on function public.get_enrichment_research_producer_candidates(uuid, uuid)
from public, anon;

grant execute
on function public.get_enrichment_research_producer_candidates(uuid, uuid)
to authenticated;


create or replace function public.confirm_enrichment_research_producer_identity(
    p_household_id uuid,
    p_case_id uuid,
    p_producer_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine public.wines%rowtype;
    v_source_producer text;
    v_producer_key text := private.normalize_wine_reference_text(p_producer_key);
    v_canonical_name text;
    v_score real;
    v_producer_id uuid;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if p_producer_key <> v_producer_key
       or length(v_producer_key) not between 2 and 200
    then
        raise exception using errcode = '22023', message = 'Producer identity key is invalid';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
          and member.role = 'owner'
    ) then
        raise exception using errcode = '42501', message = 'Only household owners can confirm producer identities';
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
      and research_case.subject_type = 'producer-profile'
    for update of research_case, subscription, wine;

    if not found then
        raise exception using errcode = '22023', message = 'Producer identity review is not available';
    end if;

    v_source_producer := private.normalize_wine_reference_text(v_wine.producer);

    select
        min(entry.producer_name),
        max(greatest(
            extensions.similarity(v_source_producer, entry.producer_search),
            extensions.word_similarity(v_source_producer, entry.producer_search),
            extensions.word_similarity(entry.producer_search, v_source_producer)
        ))
    into v_canonical_name, v_score
    from public.wine_reference_lwin_entries entry
    join public.wine_reference_lwin_snapshots snapshot
      on snapshot.id = entry.snapshot_id
    where snapshot.source_key = 'liv-ex-lwin'
      and snapshot.import_status = 'active'
      and entry.source_status = 'live'
      and entry.producer_search = v_producer_key;

    if v_canonical_name is null or v_score < 0.25 then
        raise exception using errcode = '22023', message = 'Producer identity is not a plausible active LWIN candidate';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'confirm-lwin-producer|' || v_producer_key,
            0
        )
    );

    select producer.id
    into v_producer_id
    from public.wine_reference_producers producer
    where private.normalize_wine_reference_text(
        producer.canonical_name
    ) = v_producer_key
    order by producer.id
    limit 1;

    if v_producer_id is null then
        v_producer_id := gen_random_uuid();

        insert into public.wine_reference_entities (id, entity_type)
        values (v_producer_id, 'producer');

        insert into public.wine_reference_producers (
            id,
            entity_type,
            canonical_name
        ) values (
            v_producer_id,
            'producer',
            v_canonical_name
        );
    end if;

    insert into public.wine_reference_household_producer_preferences (
        household_id,
        source_producer_normalized,
        source_producer_text,
        producer_id,
        decided_by
    ) values (
        p_household_id,
        v_source_producer,
        v_wine.producer,
        v_producer_id,
        v_user_id
    )
    on conflict (household_id, source_producer_normalized)
    do update set
        source_producer_text = excluded.source_producer_text,
        producer_id = excluded.producer_id,
        decided_by = excluded.decided_by,
        updated_at = now();

    return public.get_household_enrichment_research_inbox(p_household_id);
end;
$$;

revoke all
on function public.confirm_enrichment_research_producer_identity(uuid, uuid, text)
from public, anon;

grant execute
on function public.confirm_enrichment_research_producer_identity(uuid, uuid, text)
to authenticated;

commit;
