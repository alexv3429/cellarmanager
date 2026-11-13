begin;

-- A profile sometimes writes an official classification in its appellation
-- field (for example "Meursault 1er Cru"). Offer the existing classification's
-- *appellation parent* as an import-scoped suggestion. Do not create a place,
-- erase the classification from the source, or accept the mapping for anyone.
create or replace function public.suggest_drinking_window_profile_places(p_id uuid)
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
    ), raw_matches as (
        select n.source_name, p.id, p.canonical_name,
            case when n.source_name ~* '1er[[:space:]]+cru'
                then 'premier_cru_spelling' else 'existing_place_alias' end as reason
        from names n
        join public.enrichment_places p on p.place_type = 'appellation'
        left join public.enrichment_place_aliases a on a.place_id = p.id
        where (n.source_name ~* '1er[[:space:]]+cru'
            and p.normalized_name = private.normalize_wine_reference_text(
                pg_catalog.regexp_replace(n.source_name,
                    '1er[[:space:]]+cru','Premier Cru','gi')))
           or a.normalized_value = private.normalize_wine_reference_text(n.source_name)
        union all
        select n.source_name, parent.id, parent.canonical_name,
            'classification_parent_appellation' as reason
        from names n
        join public.enrichment_places classification
          on classification.place_type = 'classification'
         and classification.normalized_name = private.normalize_wine_reference_text(
             pg_catalog.regexp_replace(n.source_name,
                 '1er[[:space:]]+cru','Premier Cru','gi'))
        join public.enrichment_places parent
          on parent.id = classification.parent_id and parent.place_type = 'appellation'
        where n.source_name ~* '1er[[:space:]]+cru|premier[[:space:]]+cru'
    ), distinct_matches as (
        select distinct on (source_name, id)
            source_name, id, canonical_name, reason
        from raw_matches
        order by source_name, id, reason
    ), matches as (
        select m.*,
            count(m.id) over (partition by m.source_name) as candidate_count
        from distinct_matches m
        where not exists (
            select 1 from public.enrichment_places exact_place
            where exact_place.place_type = 'appellation'
              and exact_place.normalized_name =
                  private.normalize_wine_reference_text(m.source_name))
    )
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'source_name',source_name,'target_id',id,'target_name',canonical_name,
        'kind','appellation','reason',reason) order by source_name), '[]'::jsonb)
    into v_appellations from matches where candidate_count = 1;

    return pg_catalog.jsonb_build_object('regions',v_regions,'appellations',v_appellations);
end;
$$;

commit;
