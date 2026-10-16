begin;

-- The owner confirmed the 2023 Sur la Roche as Daniel Barraud's
-- Pouilly-Fuissé Premier Cru. Independent identity checks:
-- https://www.skurnik.com/producer/daniel-et-julien-barraud/
-- https://www.bourgogne-wines.com/wine-and-terroir/bourgogne-and-its-appellations/gallery_files/site/321/402/57644/71032.pdf
-- This seeds identities only: no household mapping, global alias, eligibility,
-- drinking-window year, or publication decision follows from the name.
do $$
declare
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_product_ids uuid[];
    v_release_ids uuid[];
    v_name text := 'Pouilly-Fuissé Premier Cru Sur la Roche';
begin
    v_producer_id := private.ensure_hierarchy_producer(
        'daniel-barraud', 'Daniel Barraud'
    );
    if not exists (
        select 1 from public.wine_reference_producers producer
        where producer.id = v_producer_id
          and producer.canonical_name = 'Daniel Barraud'
    ) then
        raise exception using errcode = '23505',
            message = 'Barraud producer identity needs curator review';
    end if;

    select array_agg(product.id order by product.id)
    into v_product_ids
    from public.wine_reference_products product
    where product.producer_id = v_producer_id
      and private.normalize_wine_reference_text(product.canonical_name) =
          private.normalize_wine_reference_text(v_name);
    if cardinality(v_product_ids) > 1 then
        raise exception using errcode = '21000',
            message = 'Barraud Sur la Roche product identity is ambiguous';
    end if;
    v_product_id := v_product_ids[1];

    if v_product_id is null then
        -- A differently worded existing wine might be the same cuvée. Do not
        -- silently duplicate or merge it on a substring match.
        if exists (
            select 1 from public.wine_reference_products product
            where product.producer_id = v_producer_id
              and pg_catalog.strpos(
                  private.normalize_wine_reference_text(product.canonical_name),
                  'sur la roche'
              ) > 0
        ) then
            raise exception using errcode = '23505',
                message = 'Barraud Sur la Roche product spelling needs curator review';
        end if;
        v_product_id := private.ensure_hierarchy_product(
            'daniel-barraud-pouilly-fuisse-premier-cru-sur-la-roche',
            v_producer_id, v_name
        );
    end if;
    if not exists (
        select 1 from public.wine_reference_products product
        where product.id = v_product_id
          and product.producer_id = v_producer_id
          and private.normalize_wine_reference_text(product.canonical_name) =
              private.normalize_wine_reference_text(v_name)
    ) then
        raise exception using errcode = '23505',
            message = 'Barraud Sur la Roche product seed conflicts with an existing identity';
    end if;

    select array_agg(release.id order by release.id)
    into v_release_ids
    from public.wine_reference_releases release
    where release.product_id = v_product_id
      and release.vintage_year = 2023;
    if cardinality(v_release_ids) > 1 then
        raise exception using errcode = '21000',
            message = 'Barraud Sur la Roche 2023 release is ambiguous';
    end if;
    v_release_id := v_release_ids[1];
    if v_release_id is not null and exists (
        select 1 from public.wine_reference_releases release
        where release.id = v_release_id
          and (release.release_designator is not null
            or release.base_vintage_year is not null
            or release.disgorged_on is not null
            or release.lot_code is not null)
    ) then
        raise exception using errcode = '23505',
            message = 'Barraud Sur la Roche 2023 has a qualified release needing review';
    end if;
    if v_release_id is null then
        v_release_id := private.ensure_hierarchy_release(
            'daniel-barraud-pouilly-fuisse-premier-cru-sur-la-roche-2023',
            v_product_id, 2023
        );
    end if;

    if not exists (
        select 1 from public.wine_reference_releases release
        where release.id = v_release_id
          and release.product_id = v_product_id
          and release.vintage_year = 2023
    ) then
        raise exception using errcode = '23505',
            message = 'Barraud Sur la Roche 2023 seed conflicts with an existing identity';
    end if;
end;
$$;

commit;
