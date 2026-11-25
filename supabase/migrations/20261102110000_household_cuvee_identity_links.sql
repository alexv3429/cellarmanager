begin;

-- A cellar spelling belongs to that cellar. One confirmed producer/cuvée
-- relationship can cover many vintages; bounded eras handle renamed wines.
-- These rows never create a global alias or approve a drinking-window date.
create table private.household_cuvee_identity_links (
    household_id uuid not null references public.households(id) on delete cascade,
    source_producer text not null,
    source_cuvee text not null,
    source_appellation text not null,
    source_color text not null,
    first_vintage integer not null check (first_vintage between 1800 and 2200),
    last_vintage integer not null check (last_vintage between 1800 and 2200),
    producer_id uuid not null references public.wine_reference_producers(id),
    product_id uuid not null references public.wine_reference_products(id),
    decided_by uuid not null references auth.users(id),
    decided_at timestamptz not null default now(),
    primary key (household_id, source_producer, source_cuvee,
        source_appellation, source_color, first_vintage),
    check (first_vintage <= last_vintage),
    check (source_producer <> '' and source_cuvee <> '' and source_color <> '')
);
revoke all on private.household_cuvee_identity_links from public, anon, authenticated, powersync_role;

create table private.household_cuvee_identity_decisions (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    household_id uuid not null references public.households(id) on delete cascade,
    source_producer text not null,
    source_cuvee text not null,
    source_appellation text not null,
    source_color text not null,
    first_vintage integer not null,
    last_vintage integer not null,
    previous_product_id uuid,
    product_id uuid,
    action text not null check (action in ('set','remove')),
    decided_by uuid not null references auth.users(id),
    decided_at timestamptz not null default now()
);
revoke all on private.household_cuvee_identity_decisions from public, anon, authenticated, powersync_role;

create function public.get_household_cuvee_identity_groups(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can review cuvée identities';
    end if;
    return coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'source_producer', g.source_producer,
            'source_cuvee', g.source_cuvee,
            'source_appellation', g.source_appellation,
            'source_color', g.source_color,
            'wine_count', g.wine_count,
            'first_seen_vintage', g.first_seen_vintage,
            'last_seen_vintage', g.last_seen_vintage,
            'producer_id', preference.producer_id,
            'producer_name', producer.canonical_name,
            'links', coalesce(links.items, '[]'::jsonb)
        ) order by g.source_producer, g.source_cuvee, g.source_appellation, g.source_color)
        from (
            select min(wine.producer) source_producer, min(wine.cuvee) source_cuvee,
                min(coalesce(wine.appellation,'')) source_appellation,
                min(wine.color) source_color,
                private.normalize_wine_reference_text(wine.producer) producer_key,
                private.normalize_wine_reference_text(wine.cuvee) cuvee_key,
                private.normalize_wine_reference_text(wine.appellation) appellation_key,
                private.canonical_enrichment_wine_color(wine.color) color_key,
                count(*) wine_count, min(wine.vintage) first_seen_vintage,
                max(wine.vintage) last_seen_vintage
            from public.wines wine
            where wine.household_id = p_household_id
              and wine.merged_into_wine_id is null and wine.vintage is not null
              and private.normalize_wine_reference_text(wine.producer) <> ''
              and private.normalize_wine_reference_text(wine.cuvee) <> ''
              and private.canonical_enrichment_wine_color(wine.color) is not null
            group by private.normalize_wine_reference_text(wine.producer),
                private.normalize_wine_reference_text(wine.cuvee),
                private.normalize_wine_reference_text(wine.appellation),
                private.canonical_enrichment_wine_color(wine.color)
        ) g
        left join public.wine_reference_household_producer_preferences preference
          on preference.household_id = p_household_id
         and preference.source_producer_normalized = g.producer_key
        left join public.wine_reference_producers producer on producer.id = preference.producer_id
        left join lateral (
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'first_vintage', link.first_vintage, 'last_vintage', link.last_vintage,
                'product_id', link.product_id, 'product_name', product.canonical_name,
                'active', link.producer_id = preference.producer_id
            ) order by link.first_vintage) items
            from private.household_cuvee_identity_links link
            join public.wine_reference_products product on product.id = link.product_id
            where link.household_id = p_household_id
              and link.source_producer = g.producer_key
              and link.source_cuvee = g.cuvee_key
              and link.source_appellation = g.appellation_key
              and link.source_color = g.color_key
        ) links on true
    ), '[]'::jsonb);
end;
$$;

create function public.search_household_cuvee_products(
    p_household_id uuid, p_source_producer text, p_query text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_producer_id uuid;
    v_query text := private.normalize_wine_reference_text(p_query);
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can review cuvée identities';
    end if;
    if length(v_query) not between 2 and 100 then
        raise exception using errcode = '22023', message = 'Search with 2 to 100 characters';
    end if;
    select preference.producer_id into v_producer_id
    from public.wine_reference_household_producer_preferences preference
    where preference.household_id = p_household_id
      and preference.source_producer_normalized = private.normalize_wine_reference_text(p_source_producer);
    if v_producer_id is null then
        raise exception using errcode = '22023', message = 'Link the producer before its cuvées';
    end if;
    return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', result.id, 'name', result.canonical_name) order by result.canonical_name)
        from (select product.id, product.canonical_name
            from public.wine_reference_products product
            where product.producer_id = v_producer_id
              and (pg_catalog.strpos(private.normalize_wine_reference_text(product.canonical_name), v_query) > 0
                or exists (select 1 from public.wine_reference_aliases alias
                    where alias.entity_id = product.id and alias.entity_type = 'product'
                      and pg_catalog.strpos(alias.normalized_value, v_query) > 0))
            order by product.canonical_name limit 25) result), '[]'::jsonb);
end;
$$;

create function public.manage_household_cuvee_identity_link(
    p_household_id uuid, p_source_producer text, p_source_cuvee text,
    p_source_appellation text, p_source_color text,
    p_first_vintage integer, p_last_vintage integer, p_action text,
    p_product_id uuid, p_expected_product_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_producer_key text := private.normalize_wine_reference_text(p_source_producer);
    v_cuvee_key text := private.normalize_wine_reference_text(p_source_cuvee);
    v_appellation_key text := private.normalize_wine_reference_text(p_source_appellation);
    v_color_key text := private.canonical_enrichment_wine_color(p_source_color);
    v_producer_id uuid;
    v_existing_product_id uuid;
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can manage cuvée identities';
    end if;
    if v_producer_key = '' or v_cuvee_key = '' or v_color_key is null
       or p_first_vintage is null or p_first_vintage not between 1800 and 2200
       or p_last_vintage is null or p_last_vintage not between p_first_vintage and 2200
       or p_action is null or p_action not in ('set','remove') then
        raise exception using errcode = '22023', message = 'Invalid cuvée mapping';
    end if;
    if not exists (select 1 from public.wines wine
        where wine.household_id = p_household_id and wine.merged_into_wine_id is null
          and private.normalize_wine_reference_text(wine.producer) = v_producer_key
          and private.normalize_wine_reference_text(wine.cuvee) = v_cuvee_key
          and private.normalize_wine_reference_text(wine.appellation) = v_appellation_key
          and private.canonical_enrichment_wine_color(wine.color) = v_color_key) then
        raise exception using errcode = '22023', message = 'Cuvée is not in this household catalogue';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'household-cuvee|' || p_household_id || '|' || v_producer_key || '|' ||
        v_cuvee_key || '|' || v_appellation_key || '|' || v_color_key, 0));
    select preference.producer_id into v_producer_id
    from public.wine_reference_household_producer_preferences preference
    where preference.household_id = p_household_id
      and preference.source_producer_normalized = v_producer_key;
    if v_producer_id is null then
        raise exception using errcode = '22023', message = 'Link the producer before its cuvées';
    end if;
    select link.product_id into v_existing_product_id
    from private.household_cuvee_identity_links link
    where link.household_id = p_household_id
      and link.source_producer = v_producer_key and link.source_cuvee = v_cuvee_key
      and link.source_appellation = v_appellation_key and link.source_color = v_color_key
      and link.first_vintage = p_first_vintage for update;
    if v_existing_product_id is distinct from p_expected_product_id then
        raise exception using errcode = '40001', message = 'Cuvée mapping changed; refresh before saving';
    end if;
    if p_action = 'set' then
        if not exists (select 1 from public.wine_reference_products product
            where product.id = p_product_id and product.producer_id = v_producer_id) then
            raise exception using errcode = '22023', message = 'Choose a cuvée of the linked producer';
        end if;
        if exists (select 1 from private.household_cuvee_identity_links link
            where link.household_id = p_household_id
              and link.source_producer = v_producer_key and link.source_cuvee = v_cuvee_key
              and link.source_appellation = v_appellation_key and link.source_color = v_color_key
              and link.first_vintage <> p_first_vintage
              and link.first_vintage <= p_last_vintage
              and p_first_vintage <= link.last_vintage) then
            raise exception using errcode = '22023', message = 'Cuvée vintage ranges overlap';
        end if;
        insert into private.household_cuvee_identity_links (
            household_id, source_producer, source_cuvee, source_appellation,
            source_color, first_vintage, last_vintage, producer_id, product_id, decided_by
        ) values (p_household_id, v_producer_key, v_cuvee_key, v_appellation_key,
            v_color_key, p_first_vintage, p_last_vintage, v_producer_id, p_product_id, auth.uid())
        on conflict (household_id, source_producer, source_cuvee,
            source_appellation, source_color, first_vintage)
        do update set last_vintage = excluded.last_vintage,
            producer_id = excluded.producer_id, product_id = excluded.product_id,
            decided_by = excluded.decided_by, decided_at = now();
    else
        if p_product_id is not null or v_existing_product_id is null then
            raise exception using errcode = '22023', message = 'Choose an existing cuvée mapping to remove';
        end if;
        delete from private.household_cuvee_identity_links link
        where link.household_id = p_household_id
          and link.source_producer = v_producer_key and link.source_cuvee = v_cuvee_key
          and link.source_appellation = v_appellation_key and link.source_color = v_color_key
          and link.first_vintage = p_first_vintage;
    end if;
    insert into private.household_cuvee_identity_decisions (
        household_id, source_producer, source_cuvee, source_appellation,
        source_color, first_vintage, last_vintage, previous_product_id,
        product_id, action, decided_by
    ) values (p_household_id, v_producer_key, v_cuvee_key, v_appellation_key,
        v_color_key, p_first_vintage, p_last_vintage, v_existing_product_id,
        case when p_action = 'set' then p_product_id else null end, p_action, auth.uid());
    return pg_catalog.jsonb_build_object('product_id',
        case when p_action = 'set' then p_product_id else null end,
        'source_producer', v_producer_key, 'source_cuvee', v_cuvee_key,
        'first_vintage', p_first_vintage);
end;
$$;

-- Explicit bottle-level links still win. A confirmed cellar naming rule can
-- resolve future releases without rewriting each local wine card. A producer
-- preference alone supports only deliberately scoped producer-level rows.
create or replace function private.drinking_window_wine_reference_lineage(p_wine public.wines)
returns table (producer_id uuid, product_id uuid, release_id uuid)
language plpgsql stable set search_path = '' as $$
begin
    if p_wine.wine_reference_id is not null then
        return query
        select product.producer_id, product.id, release.id
        from public.wine_reference_releases release
        join public.wine_reference_products product on product.id = release.product_id
        where p_wine.wine_reference_type = 'release'
          and release.id = p_wine.wine_reference_id and release.vintage_year = p_wine.vintage
        union all
        select product.producer_id, product.id, null::uuid
        from public.wine_reference_products product
        where p_wine.wine_reference_type = 'product' and product.id = p_wine.wine_reference_id
        union all
        select product.producer_id, product.id, release.id
        from public.wine_reference_packages package
        join public.wine_reference_releases release on release.id = package.release_id
        join public.wine_reference_products product on product.id = release.product_id
        where p_wine.wine_reference_type = 'package' and package.id = p_wine.wine_reference_id
          and package.volume_ml = p_wine.format_ml and release.vintage_year = p_wine.vintage;
        return;
    end if;
    return query
    select link.producer_id, link.product_id, release.id
    from private.household_cuvee_identity_links link
    join public.wine_reference_household_producer_preferences preference
      on preference.household_id = link.household_id
     and preference.source_producer_normalized = link.source_producer
     and preference.producer_id = link.producer_id
    left join lateral (
        select (array_agg(candidate.id))[1] id
        from public.wine_reference_releases candidate
        where candidate.product_id = link.product_id
          and candidate.vintage_year = p_wine.vintage
        having count(*) = 1
    ) release on true
    where link.household_id = p_wine.household_id
      and link.source_producer = private.normalize_wine_reference_text(p_wine.producer)
      and link.source_cuvee = private.normalize_wine_reference_text(p_wine.cuvee)
      and link.source_appellation = private.normalize_wine_reference_text(p_wine.appellation)
      and link.source_color = private.canonical_enrichment_wine_color(p_wine.color)
      and p_wine.vintage between link.first_vintage and link.last_vintage
    limit 1;
    if found then return; end if;
    return query
    select preference.producer_id, null::uuid, null::uuid
    from public.wine_reference_household_producer_preferences preference
    where preference.household_id = p_wine.household_id
      and preference.source_producer_normalized = private.normalize_wine_reference_text(p_wine.producer);
end;
$$;
revoke all on function private.drinking_window_wine_reference_lineage(public.wines)
    from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.drinking_window_wine_reference_lineage(public.wines) to postgres;

revoke all on function public.get_household_cuvee_identity_groups(uuid) from public, anon;
revoke all on function public.search_household_cuvee_products(uuid,text,text) from public, anon;
revoke all on function public.manage_household_cuvee_identity_link(uuid,text,text,text,text,integer,integer,text,uuid,uuid) from public, anon;
grant execute on function public.get_household_cuvee_identity_groups(uuid) to authenticated;
grant execute on function public.search_household_cuvee_products(uuid,text,text) to authenticated;
grant execute on function public.manage_household_cuvee_identity_link(uuid,text,text,text,text,integer,integer,text,uuid,uuid) to authenticated;
commit;
