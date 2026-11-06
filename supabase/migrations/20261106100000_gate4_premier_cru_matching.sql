begin;

-- Resolve an abbreviated Premier Cru only to a unique parent within the
-- household's region. The original cellar label remains unchanged.
create or replace function private.household_resolved_appellation(
    p_household_id uuid, p_area text, p_appellation text
) returns uuid language plpgsql stable set search_path = '' as $$
declare
    v_area text := private.normalize_wine_reference_text(p_area);
    v_appellation text := private.normalize_wine_reference_text(p_appellation);
    v_base text;
    v_region_id uuid;
    v_id uuid;
    v_count integer;
begin
    if v_area = '' or v_appellation = '' then return null; end if;
    select link.appellation_id into v_id from private.household_appellation_identity_links link
    where link.household_id = p_household_id and link.source_area = v_area
      and link.source_appellation = v_appellation;
    if found then return v_id; end if;
    select count(*), min(match.id::text)::uuid into v_count, v_id from (
        select place.id from public.enrichment_places place
        where place.place_type = 'appellation' and place.normalized_name = v_appellation
        union
        select place.id from public.enrichment_place_aliases alias
        join public.enrichment_places place on place.id = alias.place_id
        where place.place_type = 'appellation' and alias.normalized_value = v_appellation
    ) match;
    if v_count = 1 then return v_id; end if;
    if v_count <> 0 or v_appellation !~ ' (1c|1er cru|premier cru)$' then return null; end if;
    v_base := pg_catalog.regexp_replace(v_appellation, ' (1c|1er cru|premier cru)$', '');
    v_region_id := private.household_resolved_region(p_household_id, p_area);
    if v_base = '' or v_region_id is null then return null; end if;
    select count(*), min(match.id::text)::uuid into v_count, v_id from (
        select place.id from public.enrichment_places place
        where place.place_type = 'appellation' and place.normalized_name = v_base
          and private.drinking_window_place_contains(v_region_id, place.id)
        union
        select place.id from public.enrichment_place_aliases alias
        join public.enrichment_places place on place.id = alias.place_id
        where place.place_type = 'appellation' and alias.normalized_value = v_base
          and private.drinking_window_place_contains(v_region_id, place.id)
    ) match;
    return case when v_count = 1 then v_id else null end;
end;
$$;

-- Unclassified broad estimates do not automatically apply to Premier Cru.
-- Exact-release and explicitly eligible group windows remain eligible.
create function private.drinking_window_wine_is_premier_cru(p_wine_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select coalesce((
        select private.normalize_wine_reference_text(
            coalesce(w.appellation, '') || ' ' || coalesce(w.cuvee, ''))
            ~ '(^| )(1c|1er cru|premier cru)( |$)'
        from public.wines w where w.id = p_wine_id
    ), false);
$$;
revoke all on function private.drinking_window_wine_is_premier_cru(uuid)
from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.drinking_window_wine_is_premier_cru(uuid) to postgres;

create or replace function private.drinking_window_preview_draft_match_for_wine(
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
          and (r.format_ml is null or r.format_ml = (
              select wine.format_ml from public.wines wine
              where wine.id = p_wine_id
          ))
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
              (r.all_at_scope and (r.scope = 'release'
                  or not private.drinking_window_wine_is_premier_cru(p_wine_id)))
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
        select c.*, count(*) over (partition by c.priority, (c.format_ml is null)) as ties
        from candidates c
    )
    select r.id, r.scope, r.first_trial_year, r.best_start_year,
        r.best_end_year, r.ties
    into v_match
    from ranked r
    order by r.priority, (r.format_ml is null), r.id
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

commit;
