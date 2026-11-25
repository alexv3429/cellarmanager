begin;

-- Reviewed release anchors sometimes retain a fully qualified cuvée name
-- ("Meursault Premier Cru Perrières") whereas the cellar uses "Perrières"
-- and puts "1C" in its appellation. Only strip a verified appellation and an
-- explicit Premier Cru marker; keep all other words and fail closed on ties.
create or replace function private.drinking_window_unique_reviewed_release(
    p_wine public.wines, p_producer_id uuid, p_region_id uuid,
    p_appellation_id uuid, p_color text
) returns table (product_id uuid, release_id uuid)
language sql stable set search_path = '' as $$
    select min(anchor.product_id::text)::uuid, min(anchor.release_id::text)::uuid
    from private.drinking_window_reviewed_release_anchors anchor
    join public.enrichment_places appellation on appellation.id=anchor.appellation_id
    cross join lateral (select pg_catalog.regexp_replace(appellation.normalized_name,
        ' (1c|1er cru|premier cru)$','') as root) app
    where anchor.producer_id=p_producer_id
      and anchor.appellation_id=p_appellation_id
      and private.drinking_window_place_contains(p_region_id,anchor.region_id)
      and anchor.wine_color=p_color and anchor.vintage_year=p_wine.vintage
      and anchor.format_ml=p_wine.format_ml
      and (private.normalize_wine_reference_text(p_wine.cuvee)=any(anchor.name_keys)
        or (private.normalize_wine_reference_text(coalesce(p_wine.appellation,'') || ' ' ||
              coalesce(p_wine.cuvee,'')) ~ '(^| )(1c|1er cru|premier cru)( |$)'
          and exists (select 1 from pg_catalog.unnest(anchor.name_keys) reviewed_name
            where app.root <> '' and pg_catalog.left(reviewed_name,pg_catalog.length(app.root)+1)=app.root || ' '
              and pg_catalog.substr(reviewed_name,pg_catalog.length(app.root)+2) ~ '^(1c|1er cru|premier cru) '
              and pg_catalog.regexp_replace(pg_catalog.regexp_replace(
                pg_catalog.substr(reviewed_name,pg_catalog.length(app.root)+2),
                '^(1c|1er cru|premier cru) ',''),'^les ','')
                =pg_catalog.regexp_replace(private.normalize_wine_reference_text(p_wine.cuvee),'^les ',''))))
      and not exists (
          select 1 from private.drinking_window_reviewed_release_anchors conflicting
          where conflicting.release_id=anchor.release_id
            and (conflicting.appellation_id<>anchor.appellation_id or conflicting.wine_color<>anchor.wine_color)
      )
    having count(distinct anchor.release_id)=1;
$$;
commit;
