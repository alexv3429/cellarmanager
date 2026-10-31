begin;

-- Distinct package-size estimates may coexist. Exact size outranks a
-- size-neutral row only within the same semantic scope; two rows at the
-- winning scope and size remain ambiguous rather than being guessed.
drop index public.drinking_window_reference_rows_key_unique;
create unique index drinking_window_reference_rows_key_unique
    on public.drinking_window_reference_rows (
        version_id, scope, region_id, wine_color, vintage_year,
        coalesce(producer_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(release_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(appellation_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(ageing_group_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(format_ml, 0)
    );

create or replace function public.create_drinking_window_exact_draft_row(
    p_version_id uuid, p_release_id uuid, p_region_id uuid,
    p_appellation_id uuid, p_wine_color text, p_format_ml integer,
    p_first_trial_year integer, p_best_start_year integer,
    p_best_end_year integer, p_rationale text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    v_release public.wine_reference_releases%rowtype;
    v_producer_id uuid;
    v_row_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    perform 1 from public.drinking_window_reference_versions v
    where v.id = p_version_id and v.status = 'draft';
    if not found then
        raise exception using errcode = '22023', message = 'Choose an unpublished working version';
    end if;
    select r.* into v_release from public.wine_reference_releases r
    where r.id = p_release_id;
    if not found then
        raise exception using errcode = '22023', message = 'Choose a canonical wine and vintage';
    end if;
    select p.producer_id into v_producer_id from public.wine_reference_products p
    where p.id = v_release.product_id;
    if not exists (select 1 from public.enrichment_places p
        where p.id = p_region_id and p.place_type in ('region', 'subregion'))
       or not exists (select 1 from public.enrichment_places p
        where p.id = p_appellation_id and p.place_type = 'appellation')
       or not private.drinking_window_place_contains(p_region_id, p_appellation_id)
       or p_wine_color not in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')
       or p_format_ml is null or p_format_ml not between 50 and 30000
       or p_first_trial_year is null or p_best_start_year is null
       or p_best_end_year is null
       or p_first_trial_year < v_release.vintage_year
       or p_first_trial_year > p_best_start_year
       or p_best_start_year > p_best_end_year
       or p_best_end_year > 2300
       or pg_catalog.length(pg_catalog.btrim(coalesce(p_rationale, ''))) not between 20 and 2000 then
        raise exception using errcode = '22023',
            message = 'Confirm region, appellation, colour, size, three ordered years and reasoning';
    end if;
    if exists (select 1 from public.drinking_window_reference_rows r
        where r.version_id = p_version_id and r.scope = 'release'
          and r.release_id = p_release_id and r.region_id = p_region_id
          and r.appellation_id = p_appellation_id and r.wine_color = p_wine_color
          and r.format_ml = p_format_ml
          ) then
        raise exception using errcode = '23505',
            message = 'This exact wine already has a draft row; correct it instead';
    end if;
    insert into public.drinking_window_reference_rows (
        version_id, scope, producer_id, product_id, release_id,
        appellation_id, region_id, wine_color, vintage_year, format_ml,
        all_at_scope, first_trial_year, best_start_year, best_end_year, rationale
    ) values (
        p_version_id, 'release', v_producer_id, v_release.product_id,
        v_release.id, p_appellation_id, p_region_id, p_wine_color,
        v_release.vintage_year, p_format_ml, true, p_first_trial_year,
        p_best_start_year, p_best_end_year, pg_catalog.btrim(p_rationale)
    ) returning id into v_row_id;
    insert into private.drinking_window_draft_row_authorship
        (version_id, row_id, curator_id)
    values (p_version_id, v_row_id, auth.uid());
    return v_row_id;
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
