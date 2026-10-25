begin;

-- Preserve the historic regional draft, its evidence/reviews, and any private
-- ageing choices. It must never be reviewed or published after replacement.
alter table public.drinking_window_reference_versions
    drop constraint drinking_window_reference_versions_status_check;
alter table public.drinking_window_reference_versions
    add constraint drinking_window_reference_versions_status_check
    check (status in ('draft', 'active', 'superseded', 'withdrawn'));

create or replace function private.block_drinking_window_reference_publication()
returns trigger language plpgsql set search_path = '' as $$
begin
    if tg_op = 'INSERT' then
        if new.status <> 'draft' or new.published_at is not null
           or new.content_sha256 is not null then
            raise exception using errcode = '23514',
                message = 'A drinking-window version must start as a draft';
        end if;
    elsif old.status = 'draft' and new.status = 'draft' then
        if new.published_at is not null or new.content_sha256 is not null then
            raise exception using errcode = '23514',
                message = 'A draft cannot carry publication metadata';
        end if;
    elsif current_user = 'postgres'
          and pg_catalog.current_setting('app.drinking_window_withdrawal', true) = 'on'
          and old.status = 'draft' and new.status = 'withdrawn'
          and new.published_at is null and new.content_sha256 is null then
        null;
    elsif current_user = 'postgres'
          and pg_catalog.current_setting('app.drinking_window_publication', true) = 'on'
          and old.status = 'draft' and new.status = 'active'
          and new.content_sha256 ~ '^[0-9a-f]{64}$'
          and new.published_at is not null then
        null;
    elsif current_user = 'postgres'
          and pg_catalog.current_setting('app.drinking_window_publication', true) = 'on'
          and old.status = 'active' and new.status = 'superseded'
          and new.content_sha256 = old.content_sha256
          and new.published_at = old.published_at then
        null;
    else
        raise exception using errcode = '23514',
            message = 'Drinking-window reference lifecycle requires a trusted operator';
    end if;
    return new;
end;
$$;

-- A format-specific release must not be applied to a magnum merely because
-- its canonical wine/release identity matches a 750 ml research observation.
alter table public.drinking_window_reference_rows
    add column format_ml integer check (format_ml is null or format_ml > 0);
alter table public.drinking_window_reference_rows
    add constraint drinking_window_reference_rows_format_scope_check
    check (format_ml is null or scope = 'release');

-- The original nine-argument diagnostic safely excludes format-specific
-- rows. Callers with a known bottle size use the ten-argument overload.


create or replace function public.drinking_window_preview_draft_match(
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
          and r.format_ml is null
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
              or exists (
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
              )
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

create or replace function public.drinking_window_preview_draft_match(
    p_version_id uuid,
    p_producer_id uuid,
    p_product_id uuid,
    p_release_id uuid,
    p_appellation_id uuid,
    p_region_id uuid,
    p_wine_color text,
    p_vintage_year integer,
    p_place_id uuid,
    p_format_ml integer
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
          and (r.format_ml is null or r.format_ml = p_format_ml)
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
              or exists (
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
              )
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

revoke all on function public.drinking_window_preview_draft_match(
    uuid, uuid, uuid, uuid, uuid, uuid, text, integer, uuid, integer
) from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_preview_draft_match(
    uuid, uuid, uuid, uuid, uuid, uuid, text, integer, uuid, integer
) to service_role;

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
          and (r.format_ml is null or r.format_ml = v_wine.format_ml)
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

create or replace function public.drinking_window_shadow_compare_before_owner_timing(
    p_version_id uuid, p_household_id uuid, p_wine_ids uuid[]
)
returns table (
    wine_id uuid,
    draft_sha256 text,
    draft_issue_count bigint,
    identity_status text,
    draft_status text,
    comparison_status text,
    current_source text,
    current_projection_id uuid,
    current_first_trial_year integer,
    current_best_start_year integer,
    current_best_end_year integer,
    reference_row_id uuid,
    matched_scope text,
    proposed_first_trial_year integer,
    proposed_best_start_year integer,
    proposed_best_end_year integer,
    first_trial_delta integer,
    best_start_delta integer,
    best_end_delta integer,
    reason text
)
language plpgsql
stable
set search_path = ''
as $$
declare
    v_wine_id uuid;
    v_wine public.wines%rowtype;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_projection public.wine_enrichment_projections%rowtype;
    v_override public.wine_maturity_overrides%rowtype;
    v_match record;
    v_current_reference jsonb;
    v_hash text;
    v_issues bigint;
    v_identity_status text;
    v_current_source text;
    v_current_first integer;
    v_current_start integer;
    v_current_end integer;
    v_comparison text;
begin
    if p_household_id is null or p_wine_ids is null
       or cardinality(p_wine_ids) not between 1 and 250
       or array_position(p_wine_ids, null) is not null
       or (select count(distinct id) from unnest(p_wine_ids) as ids(id))
          <> cardinality(p_wine_ids) then
        raise exception using errcode = '22023',
            message = 'Provide one household and 1 to 250 distinct wine IDs';
    end if;

    -- These checks do not approve a draft. They make an unready comparison
    -- unmistakable and bind every row of the report to the same draft state.
    v_hash := public.drinking_window_draft_fingerprint(p_version_id);
    select count(*) into v_issues
    from public.drinking_window_publication_issues(p_version_id);

    foreach v_wine_id in array p_wine_ids loop
        select * into v_wine from public.wines w
        where w.id = v_wine_id and w.household_id = p_household_id
          and w.merged_into_wine_id is null;
        if not found then
            raise exception using errcode = '22023',
                message = 'Every wine must be active and belong to the requested household';
        end if;

        v_region_id := null;
        v_appellation_id := null;
        v_producer_id := null;
        v_product_id := null;
        v_release_id := null;
        v_identity_status := 'exact_place_and_reference';

        -- A text label resolves only when its normalized canonical name or
        -- reviewed alias identifies exactly one place of the right kind.
        select array_agg(distinct candidate.id) into v_region_ids
        from (
            select p.id from public.enrichment_places p
            where p.place_type in ('region', 'subregion')
              and p.normalized_name = private.normalize_wine_reference_text(v_wine.area)
            union
            select p.id from public.enrichment_place_aliases a
            join public.enrichment_places p on p.id = a.place_id
            where p.place_type in ('region', 'subregion')
              and a.normalized_value = private.normalize_wine_reference_text(v_wine.area)
        ) candidate;
        if cardinality(v_region_ids) = 1 then
            v_region_id := v_region_ids[1];
        else
            v_identity_status := 'region_unresolved';
        end if;

        if v_wine.appellation is not null then
            select array_agg(distinct candidate.id) into v_appellation_ids
            from (
                select p.id from public.enrichment_places p
                where p.place_type = 'appellation'
                  and p.normalized_name = private.normalize_wine_reference_text(v_wine.appellation)
                union
                select p.id from public.enrichment_place_aliases a
                join public.enrichment_places p on p.id = a.place_id
                where p.place_type = 'appellation'
                  and a.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
            ) candidate;
            if cardinality(v_appellation_ids) = 1 then
                v_appellation_id := v_appellation_ids[1];
            elsif v_identity_status = 'exact_place_and_reference' then
                v_identity_status := 'appellation_unresolved';
            end if;
        end if;

        -- Only an existing household link supplies producer/product/release.
        -- Never infer those identities from a similar-looking OCR string.
        if v_wine.wine_reference_type = 'release' then
            select r.id, p.id, p.producer_id
            into v_release_id, v_product_id, v_producer_id
            from public.wine_reference_releases r
            join public.wine_reference_products p on p.id = r.product_id
            where r.id = v_wine.wine_reference_id
              and r.vintage_year = v_wine.vintage;
        elsif v_wine.wine_reference_type = 'product' then
            select p.id, p.producer_id into v_product_id, v_producer_id
            from public.wine_reference_products p
            where p.id = v_wine.wine_reference_id;
        end if;
        if v_producer_id is null and v_identity_status = 'exact_place_and_reference' then
            v_identity_status := 'wine_reference_unlinked';
        end if;

        select * into v_override from public.wine_maturity_overrides o
        where o.household_id = p_household_id and o.wine_id = v_wine_id;
        select * into v_projection from public.wine_enrichment_projections p
        where p.household_id = p_household_id and p.wine_id = v_wine_id
          and p.projection_type = 'maturity' and p.context_key = ''
          and p.status = 'current';

        v_current_source := 'none';
        v_current_first := null;
        v_current_start := null;
        v_current_end := null;
        if v_override.wine_id is not null then
            v_current_source := 'manual_override';
            v_current_first := v_override.first_trial_year;
            v_current_start := v_override.best_start_year;
            v_current_end := v_override.best_end_year;
        elsif v_projection.id is not null then
            v_current_source := case
                when v_projection.valid_until <= now() then 'expired_model'
                else 'model' end;
            v_current_first := (v_projection.recommendation ->> 'first_trial_year')::integer;
            v_current_start := (v_projection.recommendation ->> 'best_start_year')::integer;
            v_current_end := (v_projection.recommendation ->> 'best_end_year')::integer;
        end if;

        select * into v_match
        from public.drinking_window_preview_draft_match(
            p_version_id, v_producer_id, v_product_id, v_release_id,
            v_appellation_id, v_region_id,
            private.canonical_enrichment_wine_color(v_wine.color),
            v_wine.vintage, null::uuid, v_wine.format_ml
        );

        -- Compare a new version with the household's currently selected
        -- published version, not merely with the old model projection.
        if v_current_source <> 'manual_override' then
            v_current_reference := private.drinking_window_active_match(v_wine_id);
            if v_current_reference ->> 'status' = 'match' then
                v_current_source := 'reviewed_reference';
                v_current_first := (v_current_reference ->> 'first_trial_year')::integer;
                v_current_start := (v_current_reference ->> 'best_start_year')::integer;
                v_current_end := (v_current_reference ->> 'best_end_year')::integer;
            end if;
        end if;

        v_comparison := case
            when v_current_source = 'manual_override' then 'manual_preserved'
            when v_match.status <> 'draft_match' then v_match.status
            when v_current_source = 'none' then 'new_reference_no_baseline'
            when v_current_source = 'expired_model' then 'expired_baseline'
            when (v_current_first, v_current_start, v_current_end)
                 = (v_match.first_trial_year, v_match.best_start_year,
                    v_match.best_end_year) then 'unchanged'
            else 'changed'
        end;

        return query select v_wine_id, v_hash, v_issues,
            v_identity_status, v_match.status, v_comparison,
            v_current_source, case when v_current_source = 'reviewed_reference'
                then null::uuid else v_projection.id end,
            v_current_first, v_current_start, v_current_end,
            v_match.reference_row_id, v_match.matched_scope,
            v_match.first_trial_year, v_match.best_start_year,
            v_match.best_end_year,
            case when v_match.status = 'draft_match' and v_current_first is not null
                then v_match.first_trial_year - v_current_first else null end,
            case when v_match.status = 'draft_match' and v_current_start is not null
                then v_match.best_start_year - v_current_start else null end,
            case when v_match.status = 'draft_match' and v_current_end is not null
                then v_match.best_end_year - v_current_end else null end,
            v_match.reason;
    end loop;
end;
$$;

create or replace function public.get_drinking_window_reference_drafts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from public.enrichment_curator_eligibilities curator
        where curator.user_id = auth.uid()
          and curator.eligibility_status = 'active'
          and 'drinking-window' = any(curator.profile_scopes)
    ) then
        return pg_catalog.jsonb_build_object('eligible', false, 'drafts', '[]'::jsonb);
    end if;

    return pg_catalog.jsonb_build_object(
        'eligible', true,
        'drafts', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'version_id', version.id,
                'version_number', version.version_number,
                'subjects', coalesce((
                    with review_issues as materialized (
                        select issue.issue_code, issue.subject_kind, issue.subject_id
                        from public.drinking_window_review_issues(version.id) issue
                    )
                    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'kind', subject.kind,
                        'id', subject.id,
                        'hash', hash.current_hash,
                        'title', subject.title,
                        'details', subject.details,
                        'rationale', subject.rationale,
                        'evidence', coalesce((
                            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'claim_part', link.claim_part,
                                'evidence_role', link.evidence_role,
                                'source_name', source.source_name,
                                'source_url', evidence.source_record_url,
                                'review_status', evidence.review_status,
                                'cross_household_reuse_right', policy.cross_household_reuse_right
                            ) order by link.claim_part, link.id)
                            from public.drinking_window_reference_evidence link
                            join public.enrichment_evidence evidence on evidence.id = link.evidence_id
                            join public.enrichment_sources source on source.id = evidence.source_id
                            join public.enrichment_source_policies policy on policy.id = evidence.source_policy_id
                            where link.version_id = version.id
                              and ((subject.kind = 'row' and link.reference_row_id = subject.id)
                                or (subject.kind = 'group' and link.ageing_group_id = subject.id)
                                or (subject.kind = 'membership' and link.membership_id = subject.id))
                        ), '[]'::jsonb),
                        'reviews', coalesce((
                            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'verdict', latest.verdict,
                                'rationale', latest.rationale,
                                'decided_at', latest.decided_at,
                                'curator_id', latest.curator_id
                            ) order by latest.decided_at desc, latest.curator_id)
                            from (
                                select distinct on (review.curator_id) review.*
                                from public.drinking_window_reference_reviews review
                                join public.enrichment_curator_eligibilities curator
                                  on curator.user_id = review.curator_id
                                where review.version_id = version.id
                                  and review.subject_sha256 = hash.current_hash
                                  and review.decided_at >= curator.granted_at
                                  and curator.eligibility_status = 'active'
                                  and 'drinking-window' = any(curator.profile_scopes)
                                  and ((subject.kind = 'row' and review.reference_row_id = subject.id)
                                    or (subject.kind = 'group' and review.ageing_group_id = subject.id)
                                    or (subject.kind = 'membership' and review.membership_id = subject.id))
                                order by review.curator_id, review.decision_sequence desc
                            ) latest
                        ), '[]'::jsonb),
                        'issues', coalesce((
                            select pg_catalog.jsonb_agg(issue.issue_code order by issue.issue_code)
                            from review_issues issue
                            where issue.subject_kind = subject.kind and issue.subject_id = subject.id
                        ), '[]'::jsonb)
                    ) order by subject.sort_order, subject.title, subject.id)
                    from (
                        select 'row'::text kind, 1 sort_order, row.id,
                            place.canonical_name || ' · ' || row.vintage_year::text || ' · ' || row.wine_color title,
                            pg_catalog.jsonb_build_object(
                                'scope', row.scope, 'first_trial_year', row.first_trial_year,
                                'best_start_year', row.best_start_year,
                                'best_end_year', row.best_end_year,
                                'format_ml', row.format_ml,
                                'ageing_group_id', row.ageing_group_id) details,
                            row.rationale
                        from public.drinking_window_reference_rows row
                        join public.enrichment_places place on place.id = row.region_id
                        where row.version_id = version.id
                        union all
                        select 'group', 2, group_row.id,
                            place.canonical_name || ' · ' || group_row.group_key,
                            pg_catalog.jsonb_build_object(
                                'scope', group_row.scope, 'wine_color', group_row.wine_color),
                            group_row.definition
                        from public.drinking_window_ageing_groups group_row
                        join public.enrichment_places place on place.id = group_row.region_id
                        where group_row.version_id = version.id
                        union all
                        select 'membership', 3, member.id,
                            coalesce(producer.canonical_name || ' · ' || product.canonical_name ||
                                ' · ' || release.vintage_year::text, place.canonical_name, 'Unknown member'),
                            pg_catalog.jsonb_build_object(
                                'member_kind', member.member_kind,
                                'first_vintage_year', member.first_vintage_year,
                                'last_vintage_year', member.last_vintage_year,
                                'group_id', member.group_id),
                            member.rationale
                        from public.drinking_window_ageing_group_memberships member
                        left join public.wine_reference_releases release on release.id = member.member_release_id
                        left join public.wine_reference_products product
                          on product.id = coalesce(member.member_product_id, release.product_id)
                        left join public.wine_reference_producers producer on producer.id = product.producer_id
                        left join public.enrichment_places place on place.id = member.member_place_id
                        where member.version_id = version.id
                    ) subject
                    cross join lateral (
                        select private.drinking_window_review_subject_hash(
                            version.id, subject.kind, subject.id) current_hash
                    ) hash
                ), '[]'::jsonb)
            ) order by version.version_number)
            from public.drinking_window_reference_versions version
            where version.status = 'draft'
        ), '[]'::jsonb)
    );
end;
$$;


-- Batch coverage uses the same format-aware matcher. A missing format is
-- conservative: it cannot match a size-specific release row.
create or replace function public.drinking_window_preview_draft_batch(
    p_version_id uuid, p_wines jsonb
)
returns table (
    input_index integer, status text, matched_scope text,
    reference_row_id uuid, first_trial_year integer,
    best_start_year integer, best_end_year integer, reason text
)
language plpgsql stable set search_path = '' as $$
declare
    v_wine jsonb;
    v_index bigint;
    v_field text;
begin
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft'
    ) then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;
    if p_wines is null or jsonb_typeof(p_wines) <> 'array'
       or jsonb_array_length(p_wines) > 250 then
        raise exception using errcode = '22023',
            message = 'Provide an array of at most 250 canonical lookup keys';
    end if;
    for v_wine, v_index in
        select item.value, item.ordinality
        from jsonb_array_elements(p_wines) with ordinality as item(value, ordinality)
    loop
        if jsonb_typeof(v_wine) <> 'object' then
            raise exception using errcode = '22023',
                message = 'Each drinking-window lookup must be an object';
        end if;
        if exists (
            select 1 from jsonb_object_keys(v_wine) as key(name)
            where key.name not in (
                'producer_id', 'product_id', 'release_id', 'appellation_id',
                'region_id', 'place_id', 'wine_color', 'vintage_year',
                'format_ml'
            )
        ) then
            raise exception using errcode = '22023',
                message = 'Only canonical drinking-window lookup fields are accepted';
        end if;
        foreach v_field in array array[
            'producer_id', 'product_id', 'release_id', 'appellation_id',
            'region_id', 'place_id', 'wine_color'
        ] loop
            if v_wine ? v_field and jsonb_typeof(v_wine -> v_field)
                not in ('string', 'null') then
                raise exception using errcode = '22023',
                    message = 'Canonical IDs and colour must be strings or null';
            end if;
        end loop;
        if v_wine ? 'vintage_year' and jsonb_typeof(v_wine -> 'vintage_year')
            not in ('number', 'null') then
            raise exception using errcode = '22023',
                message = 'Vintage must be a numeric year or null';
        end if;
        if v_wine ? 'format_ml' and jsonb_typeof(v_wine -> 'format_ml')
            not in ('number', 'null') then
            raise exception using errcode = '22023',
                message = 'Bottle format must be a numeric millilitre value or null';
        end if;
        begin
            if jsonb_typeof(v_wine -> 'format_ml') = 'number'
               and ((v_wine ->> 'format_ml')::numeric not between 1 and 20000
                    or (v_wine ->> 'format_ml')::numeric
                        <> trunc((v_wine ->> 'format_ml')::numeric)) then
                raise exception using errcode = '22023',
                    message = 'Bottle format must be a positive whole millilitre value';
            end if;
            return query
            select v_index::integer, result.status, result.matched_scope,
                result.reference_row_id, result.first_trial_year,
                result.best_start_year, result.best_end_year, result.reason
            from public.drinking_window_preview_draft_match(
                p_version_id,
                (v_wine ->> 'producer_id')::uuid,
                (v_wine ->> 'product_id')::uuid,
                (v_wine ->> 'release_id')::uuid,
                (v_wine ->> 'appellation_id')::uuid,
                (v_wine ->> 'region_id')::uuid,
                v_wine ->> 'wine_color',
                (v_wine ->> 'vintage_year')::integer,
                (v_wine ->> 'place_id')::uuid,
                (v_wine ->> 'format_ml')::integer
            ) as result;
        exception
            when invalid_text_representation or numeric_value_out_of_range then
                raise exception using errcode = '22023',
                    message = 'Canonical lookup contains a malformed ID, vintage, or format';
        end;
    end loop;
end;
$$;

-- The old draft cannot be published, but its rows and private choices remain
-- for audit. The new draft has one exact release/format row and no group.
do $$
declare
    v_old_id uuid := private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:version');
    v_new_id uuid := private.enrichment_seed_uuid('drinking-window:burgaud-cote-du-py-2022-750:v2');
    v_row_id uuid := private.enrichment_seed_uuid('drinking-window:burgaud-cote-du-py-2022-750:row');
    v_evidence_id uuid := private.enrichment_seed_uuid('evidence:burgaud-cote-du-py-2022-750:owner-window');
    v_source_id uuid := private.enrichment_seed_uuid('source:cellarmanager-owner-window-review-2022');
    v_policy_id uuid := private.enrichment_seed_uuid('source-policy:cellarmanager-owner-window-review-2022:v1');
    v_review_url text := 'https://github.com/alexv3429/cellarmanager/blob/main/docs/drinking-window-first-shared-draft.md';
    v_old_row public.drinking_window_reference_rows%rowtype;
    v_cote_release_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_appellation_id uuid;
    v_region_id uuid;
begin
    select r.* into strict v_old_row
    from public.drinking_window_reference_rows r
    where r.id = private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:row')
      and r.version_id = v_old_id;
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = v_old_id and v.version_number = 1 and v.status = 'draft'
          and v.published_at is null and v.content_sha256 is null
    ) or v_old_row.scope <> 'region'
      or (v_old_row.first_trial_year, v_old_row.best_start_year,
          v_old_row.best_end_year) <> (2025, 2028, 2035)
      or (select count(*) from public.drinking_window_ageing_group_memberships m
          where m.version_id = v_old_id) <> 2 then
        raise exception using errcode = '23514',
            message = 'Burgaud regional draft changed; review before replacing';
    end if;
    if exists (select 1 from private.drinking_window_publications p
               where p.version_id = v_old_id) then
        raise exception using errcode = '23514',
            message = 'Published Burgaud draft cannot be withdrawn';
    end if;
    select release.id, product.id, product.producer_id
    into strict v_cote_release_id, v_product_id, v_producer_id
    from public.wine_reference_releases release
    join public.wine_reference_products product on product.id = release.product_id
    where product.canonical_name = 'Jean-Marc Burgaud, Côte du Py, Morgon'
      and release.vintage_year = 2022;
    select place.id, place.parent_id
    into strict v_appellation_id, v_region_id
    from public.enrichment_places place
    where place.id = private.enrichment_seed_uuid('place:morgon')
      and place.canonical_name = 'Morgon';
    if v_region_id <> v_old_row.region_id
       or v_appellation_id <> private.enrichment_seed_uuid('place:morgon')
       or v_old_row.wine_color <> 'red'
       or not exists (select 1 from public.enrichment_sources s
                      where s.id = v_source_id and s.source_kind = 'owner')
       or not exists (select 1 from public.enrichment_source_policies p
                      where p.id = v_policy_id and p.source_id = v_source_id
                        and p.status = 'reviewed'
                        and p.cross_household_reuse_right = 'allowed') then
        raise exception using errcode = '23514',
            message = 'Burgaud identity or owner-source rights need review';
    end if;

    perform pg_catalog.set_config('app.drinking_window_withdrawal', 'on', true);
    update public.drinking_window_reference_versions
    set status = 'withdrawn' where id = v_old_id;
    perform pg_catalog.set_config('app.drinking_window_withdrawal', 'off', true);

    insert into public.drinking_window_reference_versions (id, version_number)
    values (v_new_id, 2);
    insert into public.drinking_window_reference_rows (
        id, version_id, scope, producer_id, product_id, release_id,
        appellation_id, region_id, wine_color, vintage_year, format_ml,
        all_at_scope, first_trial_year, best_start_year, best_end_year,
        rationale
    ) values (
        v_row_id, v_new_id, 'release', v_producer_id, v_product_id,
        v_cote_release_id, v_appellation_id, v_region_id, 'red', 2022, 750,
        true, 2025, 2028, 2040,
        'Owner-authored provisional Côte du Py 2022 / 750 ml estimate: start tasting 2025, probable optimum 2028–2040. Exact-release retailer drinking horizons conflict; 2040 is the owner-selected estimate, not a producer- or critic-published optimum end. Requires curator and cellar-owner review before publication.'
    );
    insert into public.enrichment_evidence (
        id, source_id, source_policy_id, source_record_id, source_record_url,
        content_mode, claim_type, scope_level, place_id, release_id,
        vintage_year, wine_color, review_status, reviewed_at
    ) values (
        v_evidence_id, v_source_id, v_policy_id,
        'owner-cote-du-py-2022-750-three-milestones', v_review_url,
        'pointer-only', 'maturity-window', 'release', null, v_cote_release_id,
        null, 'red', 'reviewed', now()
    );
    insert into public.drinking_window_reference_evidence (
        version_id, reference_row_id, evidence_id, claim_part
    ) values
        (v_new_id, v_row_id, v_evidence_id, 'first_trial'),
        (v_new_id, v_row_id, v_evidence_id, 'optimal_period');
end;
$$;

commit;
