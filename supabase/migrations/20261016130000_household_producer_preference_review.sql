begin;

-- Owner decisions are deliberately separate from reusable producer identities.
-- A spelling in one household must never become a global alias by accident.
create or replace function public.get_household_producer_preference_review(
    p_household_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can review producer preferences';
    end if;

    return pg_catalog.jsonb_build_object(
        'household_id', p_household_id,
        'sources', coalesce((
            select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'source_text', source.source_text,
                    'normalized', source.normalized,
                    'wine_count', source.wine_count,
                    'producer_id', preference.producer_id,
                    'canonical_name', producer.canonical_name
                ) order by source.source_text)
            from (
                select
                    private.normalize_wine_reference_text(wine.producer) as normalized,
                    min(pg_catalog.btrim(wine.producer)) as source_text,
                    count(*) as wine_count
                from public.wines wine
                where wine.household_id = p_household_id
                group by private.normalize_wine_reference_text(wine.producer)
            ) source
            left join public.wine_reference_household_producer_preferences preference
              on preference.household_id = p_household_id
             and preference.source_producer_normalized = source.normalized
            left join public.wine_reference_producers producer
              on producer.id = preference.producer_id
        ), '[]'::jsonb)
    );
end;
$$;

create or replace function public.search_household_reference_producers(
    p_household_id uuid,
    p_query text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_query text := private.normalize_wine_reference_text(p_query);
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can search producer references';
    end if;
    if pg_catalog.length(v_query) not between 2 and 100 then
        raise exception using errcode = '22023', message = 'Search with 2 to 100 characters';
    end if;

    return coalesce((
        select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'id', result.id,
                'canonical_name', result.canonical_name
            ) order by result.canonical_name)
        from (
            select producer.id, producer.canonical_name
            from public.wine_reference_producers producer
            where pg_catalog.strpos(
                private.normalize_wine_reference_text(producer.canonical_name), v_query
            ) > 0
            order by producer.canonical_name
            limit 25
        ) result
    ), '[]'::jsonb);
end;
$$;

create or replace function public.manage_household_producer_preference(
    p_household_id uuid,
    p_source_text text,
    p_action text,
    p_producer_id uuid default null,
    p_expected_producer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_source_text text := pg_catalog.btrim(p_source_text);
    v_normalized text := private.normalize_wine_reference_text(p_source_text);
    v_current_producer_id uuid;
    v_name text;
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can manage producer preferences';
    end if;
    if pg_catalog.length(v_source_text) not between 1 and 200
       or pg_catalog.length(v_normalized) < 1
       or p_action is null
       or p_action not in ('set', 'remove') then
        raise exception using errcode = '22023', message = 'Invalid producer preference request';
    end if;
    if not exists (
        select 1 from public.wines wine
        where wine.household_id = p_household_id
          and private.normalize_wine_reference_text(wine.producer) = v_normalized
    ) then
        raise exception using errcode = '22023', message = 'Producer name is not in this household catalogue';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'household-producer-preference|' || p_household_id::text || '|' || v_normalized,
            0
        )
    );
    select preference.producer_id into v_current_producer_id
    from public.wine_reference_household_producer_preferences preference
    where preference.household_id = p_household_id
      and preference.source_producer_normalized = v_normalized
    for update;

    if v_current_producer_id is distinct from p_expected_producer_id then
        raise exception using errcode = '40001', message = 'Producer preference changed; refresh before saving';
    end if;

    if p_action = 'remove' then
        if p_producer_id is not null then
            raise exception using errcode = '22023', message = 'Remove does not accept a producer';
        end if;
        delete from public.wine_reference_household_producer_preferences preference
        where preference.household_id = p_household_id
          and preference.source_producer_normalized = v_normalized;
        return pg_catalog.jsonb_build_object('source_text', v_source_text, 'producer_id', null);
    end if;

    select producer.canonical_name into v_name
    from public.wine_reference_producers producer
    where producer.id = p_producer_id;
    if v_name is null then
        raise exception using errcode = '22023', message = 'Choose an existing shared producer';
    end if;

    insert into public.wine_reference_household_producer_preferences (
        household_id, source_producer_normalized, source_producer_text, producer_id, decided_by
    ) values (
        p_household_id, v_normalized, v_source_text, p_producer_id, auth.uid()
    )
    on conflict (household_id, source_producer_normalized)
    do update set
        source_producer_text = excluded.source_producer_text,
        producer_id = excluded.producer_id,
        decided_by = excluded.decided_by,
        updated_at = now();

    return pg_catalog.jsonb_build_object(
        'source_text', v_source_text,
        'producer_id', p_producer_id,
        'canonical_name', v_name
    );
end;
$$;

revoke all on function public.get_household_producer_preference_review(uuid) from public, anon;
revoke all on function public.search_household_reference_producers(uuid, text) from public, anon;
revoke all on function public.manage_household_producer_preference(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.get_household_producer_preference_review(uuid) to authenticated;
grant execute on function public.search_household_reference_producers(uuid, text) to authenticated;
grant execute on function public.manage_household_producer_preference(uuid, text, text, uuid, uuid) to authenticated;

commit;
