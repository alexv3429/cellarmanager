begin;

-- A shared product can already exist in more than one catalogue name order.
-- Consider both exact orders before claiming a unique suggestion. This only
-- changes curator previews; it creates no aliases, products, dates or links.
create or replace function public.suggest_drinking_window_profile_identities(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_document jsonb;
    v_producer_id uuid;
    v_producer_count integer;
    v_producer_names text[];
    v_cuvee jsonb;
    v_cuvee_names text[];
    v_composite_names text[];
    v_product_id uuid;
    v_product_count integer;
    v_duplicate_product text;
    v_duplicate_cuvee text;
    v_cuvees jsonb := '{}'::jsonb;
    v_ambiguous jsonb := '[]'::jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select exchange.document into v_document
    from private.drinking_window_profile_exchanges exchange
    where exchange.id = p_id and exchange.profile_kind = 'producer';
    if not found then
        raise exception using errcode = '22023', message = 'Choose an imported producer profile';
    end if;
    select pg_catalog.array_agg(distinct private.normalize_wine_reference_text(name))
    into v_producer_names
    from (
        select v_document #>> '{producer,name}' name
        union all
        select value from pg_catalog.jsonb_array_elements_text(
            case when pg_catalog.jsonb_typeof(v_document #> '{producer,aliases}') = 'array'
                then v_document #> '{producer,aliases}' else '[]'::jsonb end)
    ) names where private.normalize_wine_reference_text(name) <> '';
    select count(distinct producer.id), min(producer.id::text)::uuid
    into v_producer_count, v_producer_id
    from public.wine_reference_producers producer
    where private.normalize_wine_reference_text(producer.canonical_name) = any(v_producer_names)
       or exists (select 1 from public.wine_reference_aliases alias
           where alias.entity_id = producer.id and alias.entity_type = 'producer'
             and alias.normalized_value = any(v_producer_names));
    if v_producer_count <> 1 then v_producer_id := null; end if;
    if v_producer_id is not null then
        for v_cuvee in select value from pg_catalog.jsonb_array_elements(v_document -> 'cuvees') loop
            select pg_catalog.array_agg(distinct private.normalize_wine_reference_text(name))
            into v_cuvee_names
            from (
                select v_cuvee ->> 'name' name
                union all
                select value from pg_catalog.jsonb_array_elements_text(
                    case when pg_catalog.jsonb_typeof(v_cuvee -> 'aliases') = 'array'
                        then v_cuvee -> 'aliases' else '[]'::jsonb end)
            ) names where private.normalize_wine_reference_text(name) <> '';

            -- Prefix removal is exact and bounded by a space: it is not a
            -- fuzzy comparison, and preserves distinguishing words (James).
            with parts as (
                select producer_name, cuvee_name,
                    private.normalize_wine_reference_text(v_cuvee ->> 'appellation') appellation
                from pg_catalog.unnest(v_producer_names) producer_name
                cross join pg_catalog.unnest(v_cuvee_names) cuvee_name
            ), names as (
                select producer_name, cuvee_name, appellation,
                    case when appellation <> '' and pg_catalog.left(cuvee_name,
                        pg_catalog.length(appellation) + 1) = appellation || ' '
                        then pg_catalog.substr(cuvee_name, pg_catalog.length(appellation) + 2)
                        else cuvee_name end short_cuvee
                from parts
            )
            select pg_catalog.array_agg(distinct composite)
            into v_composite_names
            from names cross join lateral (values
                (producer_name || ' ' || cuvee_name),
                (producer_name || ' ' || appellation || ' ' || short_cuvee),
                (producer_name || ' ' || short_cuvee || ' ' || appellation)
            ) variants(composite);

            select count(distinct product.id), min(product.id::text)::uuid
            into v_product_count, v_product_id
            from public.wine_reference_products product
            where product.producer_id = v_producer_id
              and (private.normalize_wine_reference_text(product.canonical_name) = any(v_cuvee_names)
                or private.normalize_wine_reference_text(product.canonical_name) = any(v_composite_names)
                or exists (select 1 from public.wine_reference_aliases alias
                    where alias.entity_id = product.id and alias.entity_type = 'product'
                      and alias.normalized_value = any(v_cuvee_names)));
            if v_product_count = 1 then
                v_cuvees := v_cuvees || pg_catalog.jsonb_build_object(v_cuvee ->> 'id', v_product_id);
            elsif v_product_count > 1 then
                v_ambiguous := v_ambiguous || pg_catalog.jsonb_build_array(v_cuvee ->> 'id');
            end if;
        end loop;
        for v_duplicate_product in
            select target.value from pg_catalog.jsonb_each_text(v_cuvees) target
            group by target.value having count(*) > 1
        loop
            for v_duplicate_cuvee in
                select target.key from pg_catalog.jsonb_each_text(v_cuvees) target
                where target.value = v_duplicate_product
            loop
                v_cuvees := v_cuvees - v_duplicate_cuvee;
                v_ambiguous := v_ambiguous || pg_catalog.jsonb_build_array(v_duplicate_cuvee);
            end loop;
        end loop;
    end if;
    return pg_catalog.jsonb_build_object('profile_id', p_id,
        'producer_id', v_producer_id, 'producer_matches', v_producer_count,
        'cuvees', v_cuvees, 'ambiguous_cuvees', v_ambiguous,
        'published', false, 'wines_linked', 0);
end;
$$;

commit;
