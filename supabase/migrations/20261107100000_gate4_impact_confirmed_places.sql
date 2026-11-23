begin;

-- Impact previews must use exactly the place mappings accepted by the live
-- reader. The prior preview repeated global name lookups and could disregard
-- a household-confirmed appellation or region when a producer was unlinked.
do $migration$
declare
    v_definition text;
    v_before text := $before$        if v_context ->> 'status' = 'wine_reference_unlinked' then
            select pg_catalog.array_agg(distinct p.id) into v_region_ids from (
                select place.id from public.enrichment_places place
                where place.place_type in ('region', 'subregion')
                  and place.normalized_name = private.normalize_wine_reference_text(v_wine.area)
                union
                select place.id from public.enrichment_place_aliases alias
                join public.enrichment_places place on place.id = alias.place_id
                where place.place_type in ('region', 'subregion')
                  and alias.normalized_value = private.normalize_wine_reference_text(v_wine.area)
            ) p;
            if pg_catalog.cardinality(v_region_ids) = 1 then
                v_appellation_ids := null;
                if v_wine.appellation is not null and pg_catalog.btrim(v_wine.appellation) <> '' then
                    select pg_catalog.array_agg(distinct p.id) into v_appellation_ids from (
                        select place.id from public.enrichment_places place
                        where place.place_type = 'appellation'
                          and place.normalized_name = private.normalize_wine_reference_text(v_wine.appellation)
                        union
                        select place.id from public.enrichment_place_aliases alias
                        join public.enrichment_places place on place.id = alias.place_id
                        where place.place_type = 'appellation'
                          and alias.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
                    ) p;
                end if;
                if v_wine.appellation is null or pg_catalog.btrim(v_wine.appellation) = ''
                   or pg_catalog.cardinality(v_appellation_ids) = 1
                      and private.drinking_window_place_contains(v_region_ids[1], v_appellation_ids[1]) then
                    v_context := pg_catalog.jsonb_build_object(
                        'status', 'ready', 'region_id', v_region_ids[1],
                        'appellation_id', v_appellation_ids[1],
                        'wine_color', private.canonical_enrichment_wine_color(v_wine.color),
                        'vintage_year', v_wine.vintage
                    );
                end if;
            end if;
        end if;
$before$;
    v_after text := $after$        if v_context ->> 'status' = 'wine_reference_unlinked'
           and v_wine.wine_reference_id is null then
            -- The context already contains uniquely resolved household places.
            -- Match the live reader; never replace a confirmed local mapping
            -- with a second, global-name-only lookup.
            v_context := pg_catalog.jsonb_set(v_context, '{status}', '"ready"'::jsonb);
        end if;
$after$;
    v_function regprocedure;
begin
    foreach v_function in array array[
      'public.preview_drinking_window_publication_impact(uuid)'::regprocedure,
      'public.continue_drinking_window_impact_preview(uuid)'::regprocedure
    ] loop
        select pg_catalog.pg_get_functiondef(v_function) into v_definition;
        if (length(v_definition)-length(replace(v_definition,v_before,'')))<>length(v_before) then
            raise exception 'Impact preview changed; refusing an unsafe replacement';
        end if;
        execute replace(v_definition,v_before,v_after);
    end loop;
end;
$migration$;

commit;

