-- Read-only canonical reference snapshot for an isolated Gate 4 rehearsal DB.
-- Do not run this against a production connection or commit its output: the
-- snapshot is operational input, not a source of approved drinking dates.
select jsonb_build_object(
    'producers', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.canonical_name,
        'normalized', private.normalize_wine_reference_text(p.canonical_name))
        order by p.id), '[]'::jsonb) from public.wine_reference_producers p),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'producer_id', p.producer_id, 'name', p.canonical_name,
        'normalized', private.normalize_wine_reference_text(p.canonical_name))
        order by p.id), '[]'::jsonb) from public.wine_reference_products p),
    'releases', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'product_id', r.product_id, 'vintage', r.vintage_year)
        order by r.id), '[]'::jsonb) from public.wine_reference_releases r),
    'places', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'parent_id', p.parent_id, 'type', p.place_type,
        'name', p.canonical_name, 'normalized', p.normalized_name)
        order by p.id), '[]'::jsonb) from public.enrichment_places p),
    'producer_aliases', (select coalesce(jsonb_agg(jsonb_build_object(
        'entity_id', a.entity_id, 'normalized', a.normalized_value)
        order by a.id), '[]'::jsonb) from public.wine_reference_aliases a
        where a.entity_type = 'producer'),
    'product_aliases', (select coalesce(jsonb_agg(jsonb_build_object(
        'entity_id', a.entity_id, 'normalized', a.normalized_value)
        order by a.id), '[]'::jsonb) from public.wine_reference_aliases a
        where a.entity_type = 'product'),
    'place_aliases', (select coalesce(jsonb_agg(jsonb_build_object(
        'place_id', a.place_id, 'normalized', a.normalized_value)
        order by a.id), '[]'::jsonb) from public.enrichment_place_aliases a),
    'reference_rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'version_id', v.id, 'version', v.version_number,
        'version_status', v.status,
        'scope', r.scope, 'release_id', r.release_id, 'format_ml', r.format_ml,
        'color', r.wine_color, 'region_id', r.region_id,
        'appellation_id', r.appellation_id, 'first_trial_year', r.first_trial_year,
        'best_start_year', r.best_start_year, 'best_end_year', r.best_end_year,
        'current_approval', coalesce(review.verdict = 'approve'
            and review.subject_sha256 = private.drinking_window_review_subject_hash(
                v.id, 'row', r.id), false))
        order by r.id), '[]'::jsonb)
        from public.drinking_window_reference_rows r
        join public.drinking_window_reference_versions v on v.id = r.version_id
        left join lateral (select x.verdict, x.subject_sha256
            from public.drinking_window_reference_reviews x
            where x.version_id = v.id and x.reference_row_id = r.id
            order by x.decision_sequence desc limit 1) review on true)
);
