begin;

-- The review list must identify the actual scope, not merely its parent
-- region. This changes display labels only, never dates or reference hashes.
create or replace function public.get_drinking_window_reference_drafts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_workspace jsonb;
    v_drafts jsonb := '[]'::jsonb;
    v_draft jsonb;
    v_subjects jsonb;
    v_subject jsonb;
    v_title text;
    v_format integer;
begin
    v_workspace := private.get_drinking_window_reference_drafts();
    if v_workspace ->> 'eligible' <> 'true' then return v_workspace; end if;
    for v_draft in select value from pg_catalog.jsonb_array_elements(v_workspace -> 'drafts') loop
        v_subjects := '[]'::jsonb;
        for v_subject in select value from pg_catalog.jsonb_array_elements(v_draft -> 'subjects') loop
            v_title := null;
            if v_subject ->> 'kind' = 'row' then
                select case when row.scope = 'release' then
                    producer.canonical_name || ' · ' || product.canonical_name || ' · '
                    || row.vintage_year::text || ' · ' || row.wine_color
                    || case when row.format_ml is null then '' else ' · ' || row.format_ml::text || ' ml' end
                  when row.scope in ('appellation','producer_appellation') then
                    case when row.scope = 'producer_appellation' then producer.canonical_name || ' · ' else '' end
                    || appellation.canonical_name || ' · ' || row.vintage_year::text || ' · ' || row.wine_color
                  when row.scope = 'producer_region' then
                    producer.canonical_name || ' · ' || region.canonical_name || ' · '
                    || row.vintage_year::text || ' · ' || row.wine_color
                  else null end, row.format_ml
                into v_title, v_format
                from public.drinking_window_reference_rows row
                left join public.wine_reference_products product on product.id = row.product_id
                left join public.wine_reference_producers producer on producer.id = row.producer_id
                left join public.enrichment_places appellation on appellation.id = row.appellation_id
                left join public.enrichment_places region on region.id = row.region_id
                where row.id = (v_subject ->> 'id')::uuid;
                v_subject := pg_catalog.jsonb_set(v_subject, '{details}',
                    (v_subject -> 'details') || pg_catalog.jsonb_build_object('format_ml', v_format));
            elsif v_subject ->> 'kind' = 'group' then
                select case when g.scope in ('appellation','producer_appellation') then
                    case when g.scope = 'producer_appellation' then producer.canonical_name || ' · ' else '' end
                    || appellation.canonical_name || ' · ' || g.group_key
                  when g.scope = 'producer_region' then
                    producer.canonical_name || ' · ' || region.canonical_name || ' · ' || g.group_key
                  else null end into v_title
                from public.drinking_window_ageing_groups g
                left join public.wine_reference_producers producer on producer.id = g.producer_id
                left join public.enrichment_places appellation on appellation.id = g.appellation_id
                left join public.enrichment_places region on region.id = g.region_id
                where g.id = (v_subject ->> 'id')::uuid;
            end if;
            if v_title is not null then
                v_subject := pg_catalog.jsonb_set(v_subject, '{title}', pg_catalog.to_jsonb(v_title));
            end if;
            v_subjects := v_subjects || pg_catalog.jsonb_build_array(v_subject);
        end loop;
        v_drafts := v_drafts || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_set(v_draft, '{subjects}', v_subjects));
    end loop;
    return pg_catalog.jsonb_set(v_workspace, '{drafts}', v_drafts);
end;
$$;
revoke all on function public.get_drinking_window_reference_drafts() from public, anon;
grant execute on function public.get_drinking_window_reference_drafts() to authenticated;
commit;
