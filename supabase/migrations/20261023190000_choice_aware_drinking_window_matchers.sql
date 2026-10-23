begin;

-- The existing diagnostic preview keeps its public signature. A separate
-- private selector accepts a household wine and substitutes only an explicit,
-- current local choice at that row's scope for reviewed membership.
create function private.drinking_window_preview_draft_match_for_wine(
    p_wine_id uuid,
    p_version_id uuid,
    p_producer_id uuid,
    p_product_id uuid,
    p_release_id uuid,
    p_appellation_id uuid,
    p_region_id uuid,
    p_wine_color text,
    p_vintage_year integer,
    p_place_id uuid default null
)
returns table (
    status text,
    matched_scope text,
    reference_row_id uuid,
    first_trial_year integer,
    best_start_year integer,
    best_end_year integer,
    reason text
)
language plpgsql
stable
set search_path = ''
as $$
declare
    v_wine_place_id uuid;
    v_match record;
begin
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status in ('draft', 'active', 'superseded')
    ) then
        raise exception using errcode = '22023',
            message = 'A draft or published drinking-window reference version is required';
    end if;

    if p_region_id is null or p_wine_color is null or p_vintage_year is null then
        status := 'missing_key';
        reason := 'region_color_and_vintage_required';
        return next;
        return;
    end if;
    if p_vintage_year not between 1800 and 2200
       or p_wine_color not in (
           'red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other'
       ) then
        status := 'identity_conflict';
        reason := 'invalid_color_or_vintage';
        return next;
        return;
    end if;
    if not exists (
        select 1 from public.enrichment_places p
        where p.id = p_region_id and p.place_type in ('region', 'subregion')
    ) then
        status := 'identity_conflict';
        reason := 'invalid_region';
        return next;
        return;
    end if;
    if p_appellation_id is not null and not exists (
        select 1 from public.enrichment_places p
        where p.id = p_appellation_id and p.place_type = 'appellation'
          and private.drinking_window_place_contains(p_region_id, p.id)
    ) then
        status := 'identity_conflict';
        reason := 'appellation_outside_region';
        return next;
        return;
    end if;
    if p_place_id is not null and not private.drinking_window_place_contains(
        coalesce(p_appellation_id, p_region_id), p_place_id
    ) then
        status := 'identity_conflict';
        reason := 'place_outside_wine';
        return next;
        return;
    end if;
    if p_producer_id is not null and not exists (
        select 1 from public.wine_reference_producers p where p.id = p_producer_id
    ) then
        status := 'identity_conflict';
        reason := 'unknown_producer';
        return next;
        return;
    end if;
    if p_product_id is not null and not exists (
        select 1 from public.wine_reference_products p
        where p.id = p_product_id
          and (p_producer_id is null or p.producer_id = p_producer_id)
    ) then
        status := 'identity_conflict';
        reason := 'product_producer_mismatch';
        return next;
        return;
    end if;
    if p_release_id is not null and not exists (
        select 1 from public.wine_reference_releases r
        where r.id = p_release_id and r.vintage_year = p_vintage_year
          and (p_product_id is null or r.product_id = p_product_id)
          and (p_producer_id is null or exists (
              select 1 from public.wine_reference_products p
              where p.id = r.product_id and p.producer_id = p_producer_id
          ))
    ) then
        status := 'identity_conflict';
        reason := 'release_identity_mismatch';
        return next;
        return;
    end if;

    v_wine_place_id := coalesce(p_place_id, p_appellation_id, p_region_id);
    with candidates as (
        select r.*,
            case r.scope when 'release' then 1
                when 'producer_appellation' then 2
                when 'producer_region' then 3
                when 'appellation' then 4
                else 5 end as priority
        from public.drinking_window_reference_rows r
        where r.version_id = p_version_id
          and r.region_id = p_region_id
          and r.wine_color = p_wine_color
          and r.vintage_year = p_vintage_year
          and (
              (r.scope = 'release'
                  and r.release_id = p_release_id
                  and r.product_id = p_product_id
                  and r.producer_id = p_producer_id
                  and r.appellation_id = p_appellation_id)
              or (r.scope = 'producer_appellation'
                  and r.producer_id = p_producer_id
                  and r.appellation_id = p_appellation_id)
              or (r.scope = 'producer_region'
                  and r.producer_id = p_producer_id)
              or (r.scope = 'appellation'
                  and r.appellation_id = p_appellation_id)
              or r.scope = 'region'
          )
          and (
              r.all_at_scope
              or private.drinking_window_group_eligible(
                  p_wine_id, p_version_id, r.ageing_group_id, exists (
                  select 1 from public.drinking_window_ageing_groups g
                  join public.drinking_window_ageing_group_memberships m
                    on m.group_id = g.id and m.version_id = g.version_id
                  where g.id = r.ageing_group_id
                    and g.version_id = r.version_id
                    and g.producer_id is not distinct from r.producer_id
                    and g.appellation_id is not distinct from r.appellation_id
                    and (m.first_vintage_year is null
                         or m.first_vintage_year <= p_vintage_year)
                    and (m.last_vintage_year is null
                         or m.last_vintage_year >= p_vintage_year)
                    and private.drinking_window_place_contains(
                        m.member_place_id, v_wine_place_id
                    )
                    and (
                        m.member_kind = 'place'
                        or (m.member_kind = 'product'
                            and m.member_product_id = p_product_id)
                        or (m.member_kind = 'release'
                            and m.member_release_id = p_release_id)
                    )
              ))
          )
    ), ranked as (
        select c.*, count(*) over (partition by c.priority) as ties
        from candidates c
    )
    select r.id, r.scope, r.first_trial_year, r.best_start_year,
        r.best_end_year, r.ties
    into v_match
    from ranked r
    order by r.priority, r.id
    limit 1;

    if not found then
        status := 'no_match';
        reason := 'no_applicable_draft_row';
        return next;
        return;
    end if;
    if v_match.ties > 1 then
        status := 'ambiguous';
        reason := 'multiple_rows_at_same_scope';
        return next;
        return;
    end if;

    status := 'draft_match';
    matched_scope := v_match.scope;
    reference_row_id := v_match.id;
    first_trial_year := v_match.first_trial_year;
    best_start_year := v_match.best_start_year;
    best_end_year := v_match.best_end_year;
    return next;
end;
$$;
revoke all on function private.drinking_window_preview_draft_match_for_wine(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, integer, uuid)
    from public, anon, authenticated, powersync_role, service_role;

-- The published reader uses the same private choice rule. With no current
-- choice, its reviewed-membership behavior is unchanged.
create or replace function private.drinking_window_active_match(p_wine_id uuid)
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
    select * into v_wine from public.wines w
    where w.id = p_wine_id and w.merged_into_wine_id is null;
    if not found then
        return jsonb_build_object('status', 'missing_key',
            'reason', 'wine_not_found');
    end if;
    if not exists (
        select 1 from private.drinking_window_runtime_switch s
        where s.singleton and s.enabled
    ) then
        return jsonb_build_object('status', 'unpublished');
    end if;
    select v.* into v_version
    from private.drinking_window_household_rollouts h
    join public.drinking_window_reference_versions v on v.id = h.version_id
    join private.drinking_window_publications p on p.version_id = v.id
    where h.household_id = v_wine.household_id and h.enabled
      and v.status in ('active', 'superseded')
      and p.content_sha256 = v.content_sha256;
    if not found then
        return jsonb_build_object('status', 'unpublished');
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
          and (r.all_at_scope or private.drinking_window_group_eligible(
              p_wine_id, v_version.id, r.ageing_group_id, exists (
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
          )))
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

commit;
