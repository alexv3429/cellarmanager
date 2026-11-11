begin;

-- A cellar spelling can identify a shared climat only through a unique exact
-- name (or explicitly curated alias) under the resolved appellation. There is
-- no fuzzy matching and no change to the cellar's own wine name.
create function private.drinking_window_exact_classified_climat(p_wine_id uuid, p_appellation_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
    with terms as (
        select private.normalize_wine_reference_text(w.cuvee) as cuvee,
               private.normalize_wine_reference_text(a.canonical_name) as appellation
        from public.wines w
        join public.enrichment_places a on a.id=p_appellation_id and a.place_type='appellation'
        where w.id=p_wine_id and w.merged_into_wine_id is null
          and private.drinking_window_wine_requires_cru_classification(w.id)
    ), candidates as (
        select p.id from terms t join public.enrichment_places p
          on p.place_type='climat' and private.drinking_window_place_contains(p_appellation_id,p.id)
        cross join lateral (select case when pg_catalog.left(p.normalized_name,
            pg_catalog.length(t.appellation) + 1)=t.appellation || ' '
          then pg_catalog.substr(p.normalized_name,pg_catalog.length(t.appellation) + 2)
          else p.normalized_name end as relative_name) n
        where t.cuvee <> '' and (p.normalized_name=t.cuvee
          or pg_catalog.regexp_replace(n.relative_name,'^(les|le|la|l) ','')
             = pg_catalog.regexp_replace(t.cuvee,'^(les|le|la|l) ',''))
        union
        select p.id from terms t join public.enrichment_place_aliases a
          on a.normalized_value=t.cuvee or a.normalized_value=t.appellation || ' ' || t.cuvee
        join public.enrichment_places p on p.id=a.place_id and p.place_type='climat'
          and private.drinking_window_place_contains(p_appellation_id,p.id)
        where t.cuvee <> ''
    )
    select case when count(*)=1 then min(id::text)::uuid else null end from candidates;
$$;
revoke all on function private.drinking_window_exact_classified_climat(uuid,uuid)
from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.drinking_window_exact_classified_climat(uuid,uuid) to postgres;

-- A village/region place membership does not establish that a Premier Cru
-- belongs in the same ageing group. Product, release, explicitly selected
-- groups, and a verified classification or climat place remain eligible.
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
    if p_place_id is null and p_wine_id is not null and p_appellation_id is not null then
        p_place_id := private.drinking_window_exact_classified_climat(p_wine_id,p_appellation_id);
    end if;
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
                        (m.member_kind = 'place' and (
                            not private.drinking_window_wine_is_premier_cru(p_wine_id)
                            or (p_place_id is not null and exists (
                                select 1 from public.enrichment_places classification
                                where classification.id = m.member_place_id
                                  and classification.place_type in ('classification', 'climat')
                            ))
                        ))
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

