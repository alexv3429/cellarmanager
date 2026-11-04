begin;

-- Read-only, import-scoped suggestions from unique existing places/aliases.
-- These never create an alias or make a mapping decision:
-- the curator must explicitly accept them, and the existing identity/staging
-- previews still validate every region/appellation relationship.
create function public.suggest_drinking_window_profile_places(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_document jsonb;
    v_regions jsonb;
    v_appellations jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select document into v_document
    from private.drinking_window_profile_exchanges
    where id = p_id and profile_kind = 'producer';
    if v_document is null then
        raise exception using errcode = '22023', message = 'Choose a saved producer profile';
    end if;

    with names as (
        select distinct pg_catalog.btrim(c.value ->> 'region') as source_name
        from pg_catalog.jsonb_array_elements(v_document -> 'cuvees') c
    ), matches as (
        select n.source_name, p.id, p.canonical_name,
            count(p.id) over (partition by n.source_name) as candidate_count
        from names n
        join lateral (
            select distinct p.id, p.canonical_name
            from public.enrichment_places p
            left join public.enrichment_place_aliases a on a.place_id = p.id
            where p.place_type = 'region'
              and (p.normalized_name = private.normalize_wine_reference_text(
                  pg_catalog.split_part(n.source_name, ' — ', 1))
                or a.normalized_value = private.normalize_wine_reference_text(
                  pg_catalog.split_part(n.source_name, ' — ', 1)))
        ) p on true
        where not exists (
            select 1 from public.enrichment_places exact_place
            where exact_place.place_type in ('region','subregion')
              and exact_place.normalized_name =
                  private.normalize_wine_reference_text(n.source_name))
    )
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'source_name',source_name,'target_id',id,'target_name',canonical_name,
        'kind','region','reason',case when pg_catalog.strpos(source_name,' — ') > 0
            then 'parent_region_prefix' else 'existing_place_alias' end)
            order by source_name), '[]'::jsonb)
    into v_regions from matches where candidate_count = 1;

    with names as (
        select distinct pg_catalog.btrim(c.value ->> 'appellation') as source_name
        from pg_catalog.jsonb_array_elements(v_document -> 'cuvees') c
    ), matches as (
        select n.source_name, p.id, p.canonical_name,
            count(p.id) over (partition by n.source_name) as candidate_count
        from names n
        join lateral (
            select distinct p.id, p.canonical_name
            from public.enrichment_places p
            left join public.enrichment_place_aliases a on a.place_id = p.id
            where p.place_type = 'appellation'
              and ((n.source_name ~* '1er[[:space:]]+cru'
                and p.normalized_name = private.normalize_wine_reference_text(
                  pg_catalog.regexp_replace(n.source_name,
                      '1er[[:space:]]+cru','Premier Cru','gi')))
                or a.normalized_value = private.normalize_wine_reference_text(n.source_name))
        ) p on true
        where not exists (
            select 1 from public.enrichment_places exact_place
            where exact_place.place_type = 'appellation'
              and exact_place.normalized_name =
                  private.normalize_wine_reference_text(n.source_name))
    )
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'source_name',source_name,'target_id',id,'target_name',canonical_name,
        'kind','appellation','reason',case when source_name ~* '1er[[:space:]]+cru'
            then 'premier_cru_spelling' else 'existing_place_alias' end)
            order by source_name), '[]'::jsonb)
    into v_appellations from matches where candidate_count = 1;

    return pg_catalog.jsonb_build_object('regions',v_regions,'appellations',v_appellations);
end;
$$;
revoke all on function public.suggest_drinking_window_profile_places(uuid) from public, anon;
grant execute on function public.suggest_drinking_window_profile_places(uuid) to authenticated;

commit;
