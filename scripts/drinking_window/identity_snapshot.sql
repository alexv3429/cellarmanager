-- Read-only shared reference identities only. No household, bottle, price,
-- location, or private note table is queried.
select jsonb_build_object(
  'generated_at', now(),
  'producers', coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'canonical_name', canonical_name) order by id)
    from public.wine_reference_producers), '[]'::jsonb),
  'products', coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'producer_id', producer_id, 'canonical_name', canonical_name) order by id)
    from public.wine_reference_products), '[]'::jsonb),
  'releases', coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'product_id', product_id, 'vintage_year', vintage_year) order by id)
    from public.wine_reference_releases), '[]'::jsonb),
  'places', coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'parent_id', parent_id, 'place_type', place_type,
    'canonical_name', canonical_name) order by id)
    from public.enrichment_places), '[]'::jsonb),
  'place_aliases', coalesce((select jsonb_agg(jsonb_build_object(
    'place_id', place_id, 'alias_value', alias_value) order by id)
    from public.enrichment_place_aliases), '[]'::jsonb),
  'wine_aliases', coalesce((select jsonb_agg(jsonb_build_object(
    'entity_id', entity_id, 'entity_type', entity_type, 'alias_value', alias_value) order by id)
    from public.wine_reference_aliases), '[]'::jsonb)
) as snapshot;
