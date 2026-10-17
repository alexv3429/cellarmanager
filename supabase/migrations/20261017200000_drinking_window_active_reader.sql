begin;

-- Resolve only the one atomically published version. Draft candidates, OCR
-- strings, and similar producer names are never consulted here.
create function private.drinking_window_active_match(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_version public.drinking_window_reference_versions%rowtype;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_color text;
    v_match record;
begin
    select * into v_version from public.drinking_window_reference_versions
    where status = 'active';
    if not found then
        return jsonb_build_object('status', 'unpublished');
    end if;
    if not exists (
        select 1 from private.drinking_window_runtime_switch s
        where s.singleton and s.enabled and s.version_id = v_version.id
    ) then
        return jsonb_build_object('status', 'unpublished');
    end if;
    select * into v_wine from public.wines w
    where w.id = p_wine_id and w.merged_into_wine_id is null;
    if not found then
        return jsonb_build_object('status', 'missing_key',
            'reason', 'wine_not_found');
    end if;
    v_color := private.canonical_enrichment_wine_color(v_wine.color);
    if v_wine.vintage is null or v_color is null or v_wine.area is null then
        return jsonb_build_object('status', 'missing_key',
            'reason', 'region_color_and_vintage_required');
    end if;
    select array_agg(distinct p.id) into v_region_ids
    from (
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
        return jsonb_build_object('status', 'missing_key',
            'reason', 'region_not_confirmed');
    end if;
    v_region_id := v_region_ids[1];

    if v_wine.appellation is not null and trim(v_wine.appellation) <> '' then
        select array_agg(distinct p.id) into v_appellation_ids
        from (
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
            return jsonb_build_object('status', 'missing_key',
                'reason', 'appellation_not_confirmed');
        end if;
        v_appellation_id := v_appellation_ids[1];
        if not private.drinking_window_place_contains(
            v_region_id, v_appellation_id
        ) then
            return jsonb_build_object('status', 'identity_conflict',
                'reason', 'appellation_outside_region');
        end if;
    end if;

    if v_wine.wine_reference_type = 'release' then
        select release.id, product.id, product.producer_id
        into v_release_id, v_product_id, v_producer_id
        from public.wine_reference_releases release
        join public.wine_reference_products product
          on product.id = release.product_id
        where release.id = v_wine.wine_reference_id
          and release.vintage_year = v_wine.vintage;
    elsif v_wine.wine_reference_type = 'product' then
        select product.id, product.producer_id
        into v_product_id, v_producer_id
        from public.wine_reference_products product
        where product.id = v_wine.wine_reference_id;
    end if;
    if v_wine.wine_reference_id is not null and v_producer_id is null then
        return jsonb_build_object('status', 'identity_conflict',
            'reason', 'wine_reference_mismatch');
    end if;

    with candidates as (
        select r.*,
            case r.scope when 'release' then 1
                when 'producer_appellation' then 2
                when 'producer_region' then 3
                when 'appellation' then 4 else 5 end as priority
        from public.drinking_window_reference_rows r
        where r.version_id = v_version.id
          and r.region_id = v_region_id
          and r.wine_color = v_color
          and r.vintage_year = v_wine.vintage
          and (
              (r.scope = 'release' and r.release_id = v_release_id
                  and r.product_id = v_product_id
                  and r.producer_id = v_producer_id
                  and r.appellation_id = v_appellation_id)
              or (r.scope = 'producer_appellation'
                  and r.producer_id = v_producer_id
                  and r.appellation_id = v_appellation_id)
              or (r.scope = 'producer_region'
                  and r.producer_id = v_producer_id)
              or (r.scope = 'appellation'
                  and r.appellation_id = v_appellation_id)
              or r.scope = 'region'
          )
          and (r.all_at_scope or exists (
              select 1 from public.drinking_window_ageing_groups g
              join public.drinking_window_ageing_group_memberships m
                on m.group_id = g.id and m.version_id = g.version_id
              where g.id = r.ageing_group_id and g.version_id = r.version_id
                and g.producer_id is not distinct from r.producer_id
                and g.appellation_id is not distinct from r.appellation_id
                and (m.first_vintage_year is null
                     or m.first_vintage_year <= v_wine.vintage)
                and (m.last_vintage_year is null
                     or m.last_vintage_year >= v_wine.vintage)
                and private.drinking_window_place_contains(
                    m.member_place_id, coalesce(v_appellation_id, v_region_id)
                )
                and (m.member_kind = 'place'
                    or (m.member_kind = 'product'
                        and m.member_product_id = v_product_id)
                    or (m.member_kind = 'release'
                        and m.member_release_id = v_release_id))
          ))
    ), ranked as (
        select c.*, count(*) over (partition by c.priority) as ties
        from candidates c
    )
    select * into v_match from ranked
    order by priority, id limit 1;
    if not found then
        return jsonb_build_object('status', 'no_match',
            'reason', 'no_applicable_published_row');
    end if;
    if v_match.ties > 1 then
        return jsonb_build_object('status', 'ambiguous',
            'reason', 'multiple_rows_at_same_scope');
    end if;
    return jsonb_build_object(
        'status', 'match', 'version_id', v_version.id,
        'version_number', v_version.version_number,
        'version_sha256', v_version.content_sha256,
        'reference_row_id', v_match.id, 'matched_scope', v_match.scope,
        'first_trial_year', v_match.first_trial_year,
        'best_start_year', v_match.best_start_year,
        'best_end_year', v_match.best_end_year,
        'rationale', v_match.rationale
    );
end;
$$;
revoke all on function private.drinking_window_active_match(uuid)
from public, anon, authenticated, powersync_role, service_role;

-- Preserve the existing security checks and model payload. The selected
-- three-date reference is a separate, explicit result, never a patchwork of
-- reference and model dates. Manual overrides remain first in the readers.
alter function public.get_wine_maturity(uuid)
    rename to get_wine_maturity_before_references;
revoke all on function public.get_wine_maturity_before_references(uuid)
from public, anon, authenticated, powersync_role, service_role;

create function public.get_wine_maturity(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_result jsonb;
    v_match jsonb;
begin
    v_result := public.get_wine_maturity_before_references(p_wine_id);
    v_match := private.drinking_window_active_match(p_wine_id);
    if v_match ->> 'status' = 'match' then
        v_result := v_result || jsonb_build_object('reference', v_match,
            'effective_source', case when v_result -> 'override' <> 'null'::jsonb
                then 'manual' else 'reviewed_reference' end);
        if v_result -> 'calibration' <> 'null'::jsonb then
            v_result := jsonb_set(v_result, '{calibration,active}', 'false'::jsonb);
        end if;
    elsif v_match ->> 'status' in ('identity_conflict', 'ambiguous') then
        v_result := v_result || jsonb_build_object('reference_status', v_match,
            'effective_source', case when v_result -> 'override' <> 'null'::jsonb
                then 'manual' else 'unavailable' end);
    else
        v_result := v_result || jsonb_build_object('effective_source',
            case when v_result -> 'override' <> 'null'::jsonb then 'manual'
                when v_result -> 'projection' <> 'null'::jsonb then 'model_estimate'
                else 'unavailable' end);
    end if;
    return v_result;
end;
$$;
revoke all on function public.get_wine_maturity(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.get_wine_maturity(uuid)
to authenticated, service_role;

alter function public.get_household_maturity_overview(uuid)
    rename to get_household_maturity_overview_before_references;
revoke all on function public.get_household_maturity_overview_before_references(uuid)
from public, anon, authenticated, powersync_role, service_role;

create function public.get_household_maturity_overview(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_rows jsonb;
    v_row jsonb;
    v_result jsonb := '[]'::jsonb;
    v_match jsonb;
    v_state text;
    v_year integer := extract(year from current_date)::integer;
begin
    v_rows := public.get_household_maturity_overview_before_references(p_household_id);
    for v_row in select value from jsonb_array_elements(v_rows) loop
        v_match := private.drinking_window_active_match((v_row ->> 'wine_id')::uuid);
        if v_row ->> 'is_override' = 'true' then
            v_row := v_row || jsonb_build_object('effective_source', 'manual');
        elsif v_match ->> 'status' = 'match' then
            v_state := case
                when v_year < (v_match ->> 'first_trial_year')::integer then 'hold'
                when v_year < (v_match ->> 'best_start_year')::integer then 'assess'
                when v_year <= (v_match ->> 'best_end_year')::integer then 'ready'
                else 'assess-now' end;
            v_row := v_row || jsonb_build_object(
                'effective_source', 'reviewed_reference',
                'reference_row_id', v_match ->> 'reference_row_id',
                'reference_version_number', (v_match ->> 'version_number')::integer,
                'is_personalized', false,
                'first_trial_year', (v_match ->> 'first_trial_year')::integer,
                'best_start_year', (v_match ->> 'best_start_year')::integer,
                'best_end_year', (v_match ->> 'best_end_year')::integer,
                'drink_by_year', null,
                'state', v_state,
                'state_label', private.maturity_state_label(v_state),
                'urgency', private.maturity_urgency(v_state),
                'urgency_score', private.maturity_urgency_score(v_state),
                'headline', 'Reviewed reference window',
                'confidence', 1, 'confidence_label', 'reviewed reference',
                'specificity', v_match ->> 'matched_scope',
                'profile_layers', jsonb_build_array(v_match ->> 'matched_scope'),
                'profile_warnings', '[]'::jsonb
            );
        elsif v_match ->> 'status' in ('identity_conflict', 'ambiguous') then
            v_row := v_row || jsonb_build_object(
                'effective_source', 'unavailable',
                'first_trial_year', null, 'best_start_year', null,
                'best_end_year', null, 'drink_by_year', null,
                'state', null, 'state_label', null, 'urgency', null,
                'urgency_score', 0, 'headline', null,
                'confidence', null, 'confidence_label', null,
                'profile_warnings', jsonb_build_array(v_match ->> 'reason')
            );
        else
            v_row := v_row || jsonb_build_object('effective_source',
                case when v_row -> 'projection_id' <> 'null'::jsonb
                    then 'model_estimate' else 'unavailable' end);
        end if;
        v_result := v_result || jsonb_build_array(v_row);
    end loop;
    return v_result;
end;
$$;
revoke all on function public.get_household_maturity_overview(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.get_household_maturity_overview(uuid)
to authenticated, service_role;

commit;
