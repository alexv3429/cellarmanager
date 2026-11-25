begin;

-- One reviewed household link can point to a product, vintage release, or
-- package. A package is an exact release plus format, not an unrelated wine.
-- Never infer this lineage from a similar free-text cellar label.
create function private.drinking_window_wine_reference_lineage(p_wine public.wines)
returns table (producer_id uuid, product_id uuid, release_id uuid)
language sql stable set search_path = '' as $$
    select product.producer_id, product.id, release.id
    from public.wine_reference_releases release
    join public.wine_reference_products product on product.id = release.product_id
    where p_wine.wine_reference_type = 'release'
      and release.id = p_wine.wine_reference_id
      and release.vintage_year = p_wine.vintage
    union all
    select product.producer_id, product.id, null::uuid
    from public.wine_reference_products product
    where p_wine.wine_reference_type = 'product'
      and product.id = p_wine.wine_reference_id
    union all
    select product.producer_id, product.id, release.id
    from public.wine_reference_packages package
    join public.wine_reference_releases release on release.id = package.release_id
    join public.wine_reference_products product on product.id = release.product_id
    where p_wine.wine_reference_type = 'package'
      and package.id = p_wine.wine_reference_id
      and package.volume_ml = p_wine.format_ml
      and release.vintage_year = p_wine.vintage;
$$;
revoke all on function private.drinking_window_wine_reference_lineage(public.wines)
    from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.drinking_window_wine_reference_lineage(public.wines)
    to postgres;

create or replace function private.drinking_window_wine_context(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_color text;
begin
    select * into v_wine from public.wines
    where id = p_wine_id and merged_into_wine_id is null;
    if not found then
        return jsonb_build_object('status', 'wine_not_found');
    end if;
    v_color := private.canonical_enrichment_wine_color(v_wine.color);
    if v_wine.vintage is null or v_color is null or v_wine.area is null then
        return jsonb_build_object('status', 'region_color_and_vintage_required');
    end if;
    select array_agg(distinct p.id) into v_region_ids from (
        select place.id from public.enrichment_places place
        where place.place_type in ('region', 'subregion')
          and place.normalized_name = private.normalize_wine_reference_text(v_wine.area)
        union
        select place.id from public.enrichment_place_aliases alias
        join public.enrichment_places place on place.id = alias.place_id
        where place.place_type in ('region', 'subregion')
          and alias.normalized_value = private.normalize_wine_reference_text(v_wine.area)
    ) p;
    if coalesce(cardinality(v_region_ids), 0) <> 1 then
        return jsonb_build_object('status', 'region_not_confirmed');
    end if;
    v_region_id := v_region_ids[1];
    if v_wine.appellation is not null and trim(v_wine.appellation) <> '' then
        select array_agg(distinct p.id) into v_appellation_ids from (
            select place.id from public.enrichment_places place
            where place.place_type = 'appellation'
              and place.normalized_name = private.normalize_wine_reference_text(v_wine.appellation)
            union
            select place.id from public.enrichment_place_aliases alias
            join public.enrichment_places place on place.id = alias.place_id
            where place.place_type = 'appellation'
              and alias.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
        ) p;
        if coalesce(cardinality(v_appellation_ids), 0) <> 1 then
            return jsonb_build_object('status', 'appellation_not_confirmed');
        end if;
        v_appellation_id := v_appellation_ids[1];
        if not private.drinking_window_place_contains(v_region_id, v_appellation_id) then
            return jsonb_build_object('status', 'appellation_outside_region');
        end if;
    end if;
    select lineage.producer_id, lineage.product_id, lineage.release_id
    into v_producer_id, v_product_id, v_release_id
    from private.drinking_window_wine_reference_lineage(v_wine) lineage;
    return jsonb_build_object(
        'status', case when v_producer_id is null
            then 'wine_reference_unlinked' else 'ready' end,
        'wine_id', v_wine.id, 'household_id', v_wine.household_id,
        'source_fingerprint', private.drinking_window_wine_identity_fingerprint(v_wine),
        'region_id', v_region_id, 'appellation_id', v_appellation_id,
        'producer_id', v_producer_id, 'product_id', v_product_id,
        'release_id', v_release_id, 'wine_color', v_color,
        'vintage_year', v_wine.vintage
    );
end;
$$;

create or replace function private.drinking_window_producer_rule_identity(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_context jsonb := private.drinking_window_wine_context(p_wine_id);
    v_producer_id uuid;
    v_product_id uuid;
    v_region_id uuid;
    v_appellation_id uuid;
begin
    if v_context ->> 'status' = 'wine_not_found' then
        return jsonb_build_object('status', 'wine_not_found');
    end if;
    if v_context ->> 'status' <> 'ready' then
        return jsonb_build_object('status', 'canonical_identity_required');
    end if;
    v_producer_id := (v_context ->> 'producer_id')::uuid;
    v_product_id := (v_context ->> 'product_id')::uuid;
    v_region_id := (v_context ->> 'region_id')::uuid;
    v_appellation_id := (v_context ->> 'appellation_id')::uuid;
    return jsonb_build_object(
        'status', 'ok', 'household_id', v_context ->> 'household_id',
        'producer_id', v_producer_id, 'product_id', v_product_id,
        'appellation_id', v_appellation_id, 'region_id', v_region_id,
        'wine_color', v_context ->> 'wine_color',
        'vintage_year', (v_context ->> 'vintage_year')::integer,
        'producer_name', (select canonical_name from public.wine_reference_producers
            where id = v_producer_id),
        'product_name', (select canonical_name from public.wine_reference_products
            where id = v_product_id),
        'appellation_name', (select canonical_name from public.enrichment_places
            where id = v_appellation_id),
        'region_name', (select canonical_name from public.enrichment_places
            where id = v_region_id)
    );
end;
$$;

create or replace function private.drinking_window_active_match(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_version public.drinking_window_reference_versions%rowtype;
    v_context jsonb;
    v_match record;
    v_rationale text;
begin
    select * into v_wine from public.wines w
    where w.id = p_wine_id and w.merged_into_wine_id is null;
    if not found then
        return jsonb_build_object('status', 'missing_key', 'reason', 'wine_not_found');
    end if;
    select v.* into v_version
    from private.drinking_window_runtime_switch s
    join public.drinking_window_reference_versions v on v.id = s.version_id
    join private.drinking_window_publications p on p.version_id = v.id
        and p.content_sha256 = v.content_sha256
    where s.singleton and s.enabled and v.status = 'active';
    if not found then
        return jsonb_build_object('status', 'unpublished');
    end if;
    v_context := private.drinking_window_wine_context(p_wine_id);
    if v_context ->> 'status' not in ('ready', 'wine_reference_unlinked') then
        return jsonb_build_object(
            'status', case when v_context ->> 'status' = 'appellation_outside_region'
                then 'identity_conflict' else 'missing_key' end,
            'reason', v_context ->> 'status');
    end if;
    if v_context ->> 'status' = 'wine_reference_unlinked'
       and v_wine.wine_reference_id is not null then
        return jsonb_build_object('status', 'identity_conflict',
            'reason', 'wine_reference_mismatch');
    end if;
    select * into v_match from private.drinking_window_preview_draft_match_for_wine(
        p_wine_id, v_version.id,
        (v_context ->> 'producer_id')::uuid,
        (v_context ->> 'product_id')::uuid,
        (v_context ->> 'release_id')::uuid,
        (v_context ->> 'appellation_id')::uuid,
        (v_context ->> 'region_id')::uuid,
        v_context ->> 'wine_color',
        (v_context ->> 'vintage_year')::integer, null
    );
    if v_match.status <> 'draft_match' then
        return jsonb_build_object('status', v_match.status,
            'reason', case when v_match.status = 'no_match'
                then 'no_applicable_published_row' else v_match.reason end);
    end if;
    select r.rationale into v_rationale from public.drinking_window_reference_rows r
    where r.id = v_match.reference_row_id and r.version_id = v_version.id;
    return jsonb_build_object(
        'status', 'match', 'version_id', v_version.id,
        'version_number', v_version.version_number,
        'version_sha256', v_version.content_sha256,
        'reference_row_id', v_match.reference_row_id,
        'matched_scope', v_match.matched_scope,
        'first_trial_year', v_match.first_trial_year,
        'best_start_year', v_match.best_start_year,
        'best_end_year', v_match.best_end_year,
        'rationale', v_rationale
    );
end;
$$;

commit;
