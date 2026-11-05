begin;

-- One owner-confirmed reference link can identify the same local cuvée in
-- other vintages. This is a read-time inference, not a new household or
-- global alias. A conflicting confirmed product makes the inference empty.
create function private.drinking_window_confirmed_sibling_cuvee_lineage(p_wine public.wines)
returns table (producer_id uuid, product_id uuid, release_id uuid)
language sql stable set search_path = '' as $$
    with sibling_products as (
        select distinct product.producer_id, product.id product_id
        from public.wines sibling
        join public.wine_reference_match_decisions decision
          on decision.household_id = sibling.household_id
         and decision.wine_id = sibling.id
         and decision.decision = 'confirmed'
         and decision.reference_id = sibling.wine_reference_id
         and decision.reference_type = sibling.wine_reference_type
        join public.wine_reference_household_producer_preferences preference
          on preference.household_id = sibling.household_id
         and preference.source_producer_normalized =
             private.normalize_wine_reference_text(sibling.producer)
        join lateral (
            select p.producer_id, p.id
            from public.wine_reference_products p
            where sibling.wine_reference_type = 'product'
              and p.id = sibling.wine_reference_id
            union all
            select p.producer_id, p.id
            from public.wine_reference_releases r
            join public.wine_reference_products p on p.id = r.product_id
            where sibling.wine_reference_type = 'release'
              and r.id = sibling.wine_reference_id
              and r.vintage_year = sibling.vintage
            union all
            select p.producer_id, p.id
            from public.wine_reference_packages package
            join public.wine_reference_releases r on r.id = package.release_id
            join public.wine_reference_products p on p.id = r.product_id
            where sibling.wine_reference_type = 'package'
              and package.id = sibling.wine_reference_id
              and package.volume_ml = sibling.format_ml
              and r.vintage_year = sibling.vintage
        ) product on product.producer_id = preference.producer_id
        where sibling.household_id = p_wine.household_id
          and sibling.id <> p_wine.id
          and sibling.merged_into_wine_id is null
          and private.normalize_wine_reference_text(sibling.producer)
              = private.normalize_wine_reference_text(p_wine.producer)
          and private.normalize_wine_reference_text(sibling.cuvee)
              = private.normalize_wine_reference_text(p_wine.cuvee)
          and private.normalize_wine_reference_text(sibling.appellation)
              = private.normalize_wine_reference_text(p_wine.appellation)
          and private.canonical_enrichment_wine_color(sibling.color)
              = private.canonical_enrichment_wine_color(p_wine.color)
    ), unique_product as (
        select min(s.producer_id::text)::uuid producer_id,
            min(s.product_id::text)::uuid product_id
        from sibling_products s
        having count(distinct s.product_id) = 1
    )
    select unique_product.producer_id, unique_product.product_id, release.id
    from unique_product
    left join lateral (
        select min(r.id::text)::uuid id
        from public.wine_reference_releases r
        where r.product_id = unique_product.product_id
          and r.vintage_year = p_wine.vintage
        having count(*) = 1
    ) release on true;
$$;
revoke all on function private.drinking_window_confirmed_sibling_cuvee_lineage(public.wines)
from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.drinking_window_confirmed_sibling_cuvee_lineage(public.wines)
to postgres;

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
    select inferred.producer_id, inferred.product_id, inferred.release_id
    from private.drinking_window_confirmed_sibling_cuvee_lineage(p_wine) inferred;
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

commit;
