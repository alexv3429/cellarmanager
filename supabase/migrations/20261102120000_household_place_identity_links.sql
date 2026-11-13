begin;

-- Geographic spellings in one cellar are not global aliases. Appellation
-- choices are scoped by the local area spelling to avoid homonyms.
create table private.household_region_identity_links (
    household_id uuid not null references public.households(id) on delete cascade,
    source_area text not null check (source_area <> ''),
    region_id uuid not null references public.enrichment_places(id),
    decided_by uuid not null references auth.users(id),
    decided_at timestamptz not null default now(),
    primary key (household_id, source_area)
);
revoke all on private.household_region_identity_links from public, anon, authenticated, powersync_role;

create table private.household_appellation_identity_links (
    household_id uuid not null references public.households(id) on delete cascade,
    source_area text not null check (source_area <> ''),
    source_appellation text not null check (source_appellation <> ''),
    appellation_id uuid not null references public.enrichment_places(id),
    decided_by uuid not null references auth.users(id),
    decided_at timestamptz not null default now(),
    primary key (household_id, source_area, source_appellation)
);
revoke all on private.household_appellation_identity_links from public, anon, authenticated, powersync_role;

create table private.household_place_identity_decisions (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    household_id uuid not null references public.households(id) on delete cascade,
    kind text not null check (kind in ('region','appellation')),
    source_area text not null,
    source_appellation text,
    previous_place_id uuid,
    place_id uuid,
    action text not null check (action in ('set','remove')),
    decided_by uuid not null references auth.users(id),
    decided_at timestamptz not null default now()
);
revoke all on private.household_place_identity_decisions from public, anon, authenticated, powersync_role;

create function private.household_resolved_region(p_household_id uuid, p_area text)
returns uuid language plpgsql stable set search_path = '' as $$
declare
    v_key text := private.normalize_wine_reference_text(p_area);
    v_id uuid;
    v_count integer;
begin
    if v_key = '' then return null; end if;
    select link.region_id into v_id from private.household_region_identity_links link
    where link.household_id = p_household_id and link.source_area = v_key;
    if found then return v_id; end if;
    select count(*), min(match.id::text)::uuid into v_count, v_id from (
        select place.id from public.enrichment_places place
        where place.place_type in ('region','subregion') and place.normalized_name = v_key
        union
        select place.id from public.enrichment_place_aliases alias
        join public.enrichment_places place on place.id = alias.place_id
        where place.place_type in ('region','subregion') and alias.normalized_value = v_key
    ) match;
    return case when v_count = 1 then v_id else null end;
end;
$$;
revoke all on function private.household_resolved_region(uuid,text)
    from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.household_resolved_region(uuid,text) to postgres;

create function private.household_resolved_appellation(
    p_household_id uuid, p_area text, p_appellation text
) returns uuid language plpgsql stable set search_path = '' as $$
declare
    v_area text := private.normalize_wine_reference_text(p_area);
    v_appellation text := private.normalize_wine_reference_text(p_appellation);
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
    return case when v_count = 1 then v_id else null end;
end;
$$;
revoke all on function private.household_resolved_appellation(uuid,text,text)
    from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.household_resolved_appellation(uuid,text,text) to postgres;

create function public.get_household_place_identity_groups(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can review place identities';
    end if;
    return pg_catalog.jsonb_build_object(
        'regions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'source_area', source.source_area, 'wine_count', source.wine_count,
            'chosen_id', link.region_id, 'resolved_id', place.id,
            'resolved_name', place.canonical_name) order by source.source_area)
            from (select min(wine.area) source_area,
                    private.normalize_wine_reference_text(wine.area) area_key,
                    count(*) wine_count
                from public.wines wine where wine.household_id = p_household_id
                  and wine.merged_into_wine_id is null
                  and private.normalize_wine_reference_text(wine.area) <> ''
                group by private.normalize_wine_reference_text(wine.area)) source
            left join private.household_region_identity_links link
              on link.household_id = p_household_id and link.source_area = source.area_key
            left join public.enrichment_places place
              on place.id = private.household_resolved_region(p_household_id, source.source_area)), '[]'::jsonb),
        'appellations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'source_area', source.source_area,
            'source_appellation', source.source_appellation,
            'wine_count', source.wine_count,
            'chosen_id', link.appellation_id,
            'resolved_id', place.id,
            'resolved_name', place.canonical_name,
            'region_id', private.household_resolved_region(p_household_id, source.source_area),
            'valid', place.id is null or coalesce(private.drinking_window_place_contains(
                private.household_resolved_region(p_household_id, source.source_area), place.id), false)
            ) order by source.source_area, source.source_appellation)
            from (select min(wine.area) source_area, min(wine.appellation) source_appellation,
                    private.normalize_wine_reference_text(wine.area) area_key,
                    private.normalize_wine_reference_text(wine.appellation) appellation_key,
                    count(*) wine_count
                from public.wines wine where wine.household_id = p_household_id
                  and wine.merged_into_wine_id is null
                  and private.normalize_wine_reference_text(wine.area) <> ''
                  and private.normalize_wine_reference_text(wine.appellation) <> ''
                group by private.normalize_wine_reference_text(wine.area),
                    private.normalize_wine_reference_text(wine.appellation)) source
            left join private.household_appellation_identity_links link
              on link.household_id = p_household_id and link.source_area = source.area_key
             and link.source_appellation = source.appellation_key
            left join public.enrichment_places place on place.id =
                private.household_resolved_appellation(p_household_id,
                    source.source_area, source.source_appellation)), '[]'::jsonb));
end;
$$;

create function public.search_household_places(
    p_household_id uuid, p_kind text, p_source_area text, p_query text
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_query text := private.normalize_wine_reference_text(p_query);
    v_region_id uuid;
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can search places';
    end if;
    if p_kind is null or p_kind not in ('region','appellation')
       or length(v_query) not between 2 and 100 then
        raise exception using errcode = '22023', message = 'Invalid place search';
    end if;
    if p_kind = 'appellation' then
        v_region_id := private.household_resolved_region(p_household_id,p_source_area);
        if v_region_id is null then
            raise exception using errcode = '22023', message = 'Link the region before its appellations';
        end if;
    end if;
    return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', candidate.id, 'name', candidate.canonical_name,
        'type', candidate.place_type) order by candidate.canonical_name)
        from (select place.id, place.canonical_name, place.place_type
            from public.enrichment_places place
            where ((p_kind = 'region' and place.place_type in ('region','subregion'))
                or (p_kind = 'appellation' and place.place_type = 'appellation'
                    and private.drinking_window_place_contains(v_region_id,place.id)))
              and (pg_catalog.strpos(place.normalized_name,v_query) > 0
                or exists (select 1 from public.enrichment_place_aliases alias
                    where alias.place_id = place.id
                      and pg_catalog.strpos(alias.normalized_value,v_query) > 0))
            order by place.canonical_name limit 25) candidate), '[]'::jsonb);
end;
$$;

create function public.manage_household_place_identity_link(
    p_household_id uuid, p_kind text, p_source_area text, p_source_appellation text,
    p_action text, p_place_id uuid, p_expected_place_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_area text := private.normalize_wine_reference_text(p_source_area);
    v_appellation text := private.normalize_wine_reference_text(p_source_appellation);
    v_old uuid;
    v_region_id uuid;
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can manage place identities';
    end if;
    if v_area = '' or p_kind is null or p_kind not in ('region','appellation')
       or p_action is null or p_action not in ('set','remove')
       or (p_kind = 'appellation' and v_appellation = '')
       or (p_kind = 'region' and v_appellation <> '') then
        raise exception using errcode = '22023', message = 'Invalid place mapping';
    end if;
    if not exists (select 1 from public.wines wine
        where wine.household_id = p_household_id and wine.merged_into_wine_id is null
          and private.normalize_wine_reference_text(wine.area) = v_area
          and (p_kind = 'region' or private.normalize_wine_reference_text(wine.appellation) = v_appellation)) then
        raise exception using errcode = '22023', message = 'Place is not in this household catalogue';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'household-place|' || p_household_id || '|' || p_kind || '|' ||
        v_area || '|' || v_appellation,0));
    if p_kind = 'region' then
        select link.region_id into v_old from private.household_region_identity_links link
        where link.household_id = p_household_id and link.source_area = v_area for update;
    else
        select link.appellation_id into v_old from private.household_appellation_identity_links link
        where link.household_id = p_household_id and link.source_area = v_area
          and link.source_appellation = v_appellation for update;
    end if;
    if v_old is distinct from p_expected_place_id then
        raise exception using errcode = '40001', message = 'Place mapping changed; refresh before saving';
    end if;
    if p_action = 'set' then
        if p_kind = 'region' and not exists (select 1 from public.enrichment_places place
            where place.id = p_place_id and place.place_type in ('region','subregion')) then
            raise exception using errcode = '22023', message = 'Choose a shared region';
        end if;
        if p_kind = 'appellation' then
            v_region_id := private.household_resolved_region(p_household_id,p_source_area);
            if v_region_id is null or not exists (select 1 from public.enrichment_places place
                where place.id = p_place_id and place.place_type = 'appellation'
                  and private.drinking_window_place_contains(v_region_id,place.id)) then
                raise exception using errcode = '22023', message = 'Choose an appellation in the linked region';
            end if;
        end if;
        if p_kind = 'region' then
            if exists (select 1 from private.household_appellation_identity_links link
                where link.household_id = p_household_id and link.source_area = v_area
                  and not private.drinking_window_place_contains(p_place_id,link.appellation_id)) then
                raise exception using errcode = '22023', message = 'Region conflicts with a linked appellation';
            end if;
            insert into private.household_region_identity_links(
                household_id,source_area,region_id,decided_by)
            values(p_household_id,v_area,p_place_id,auth.uid())
            on conflict (household_id,source_area) do update
              set region_id=excluded.region_id,decided_by=excluded.decided_by,decided_at=now();
        else
            insert into private.household_appellation_identity_links(
                household_id,source_area,source_appellation,appellation_id,decided_by)
            values(p_household_id,v_area,v_appellation,p_place_id,auth.uid())
            on conflict (household_id,source_area,source_appellation) do update
              set appellation_id=excluded.appellation_id,
                  decided_by=excluded.decided_by,decided_at=now();
        end if;
    else
        if p_place_id is not null or v_old is null then
            raise exception using errcode = '22023', message = 'Choose an existing place mapping to remove';
        end if;
        if p_kind = 'region' then
            if exists (select 1 from private.household_appellation_identity_links link
                where link.household_id = p_household_id and link.source_area = v_area) then
                raise exception using errcode = '22023',
                    message = 'Remove linked appellations before removing their region';
            end if;
            delete from private.household_region_identity_links link
            where link.household_id = p_household_id and link.source_area = v_area;
        else
            delete from private.household_appellation_identity_links link
            where link.household_id = p_household_id and link.source_area = v_area
              and link.source_appellation = v_appellation;
        end if;
    end if;
    insert into private.household_place_identity_decisions(
        household_id,kind,source_area,source_appellation,previous_place_id,
        place_id,action,decided_by)
    values(p_household_id,p_kind,v_area,
        case when p_kind = 'appellation' then v_appellation else null end,
        v_old,case when p_action = 'set' then p_place_id else null end,
        p_action,auth.uid());
    return pg_catalog.jsonb_build_object('kind',p_kind,'source_area',v_area,
        'source_appellation',case when p_kind = 'appellation' then v_appellation else null end,
        'place_id',case when p_action = 'set' then p_place_id else null end);
end;
$$;

-- All profile previews and the published selector read this context. A
-- household choice wins over a global spelling match but never over an
-- explicit wine identity. Parent/child geography is still checked.
create or replace function private.drinking_window_wine_context(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_color text;
begin
    select * into v_wine from public.wines
    where id = p_wine_id and merged_into_wine_id is null;
    if not found then return jsonb_build_object('status','wine_not_found'); end if;
    v_color := private.canonical_enrichment_wine_color(v_wine.color);
    if v_wine.vintage is null or v_color is null or v_wine.area is null then
        return jsonb_build_object('status','region_color_and_vintage_required');
    end if;
    v_region_id := private.household_resolved_region(v_wine.household_id,v_wine.area);
    if v_region_id is null then
        return jsonb_build_object('status','region_not_confirmed');
    end if;
    if v_wine.appellation is not null and pg_catalog.btrim(v_wine.appellation) <> '' then
        v_appellation_id := private.household_resolved_appellation(
            v_wine.household_id,v_wine.area,v_wine.appellation);
        if v_appellation_id is null then
            return jsonb_build_object('status','appellation_not_confirmed');
        end if;
        if not private.drinking_window_place_contains(v_region_id,v_appellation_id) then
            return jsonb_build_object('status','appellation_outside_region');
        end if;
    end if;
    select lineage.producer_id,lineage.product_id,lineage.release_id
    into v_producer_id,v_product_id,v_release_id
    from private.drinking_window_wine_reference_lineage(v_wine) lineage;
    return jsonb_build_object(
        'status',case when v_producer_id is null then 'wine_reference_unlinked' else 'ready' end,
        'wine_id',v_wine.id,'household_id',v_wine.household_id,
        'source_fingerprint',private.drinking_window_wine_identity_fingerprint(v_wine),
        'region_id',v_region_id,'appellation_id',v_appellation_id,
        'producer_id',v_producer_id,'product_id',v_product_id,
        'release_id',v_release_id,'wine_color',v_color,'vintage_year',v_wine.vintage);
end;
$$;

revoke all on function public.get_household_place_identity_groups(uuid) from public, anon;
revoke all on function public.search_household_places(uuid,text,text,text) from public, anon;
revoke all on function public.manage_household_place_identity_link(uuid,text,text,text,text,uuid,uuid) from public, anon;
grant execute on function public.get_household_place_identity_groups(uuid) to authenticated;
grant execute on function public.search_household_places(uuid,text,text,text) to authenticated;
grant execute on function public.manage_household_place_identity_link(uuid,text,text,text,text,uuid,uuid) to authenticated;
commit;
