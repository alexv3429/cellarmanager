begin;

-- Resolve a climat through *explicit aliases on the same reviewed producer
-- cuvée*, across vintages, without creating a global alias or inventing a
-- release. Historical renamings still require a vintage-specific decision.
create or replace function private.drinking_window_exact_classified_climat(p_wine_id uuid, p_appellation_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
    with terms as (
        select private.normalize_wine_reference_text(w.cuvee) as cuvee,
               private.normalize_wine_reference_text(a.canonical_name) as appellation,
               private.canonical_enrichment_wine_color(w.color) as wine_color,
               lineage.producer_id, lineage.product_id
        from public.wines w
        join public.enrichment_places a on a.id=p_appellation_id and a.place_type='appellation'
        left join lateral private.drinking_window_wine_reference_lineage(w) lineage on true
        where w.id=p_wine_id and w.merged_into_wine_id is null
          and private.drinking_window_wine_requires_cru_classification(w.id)
          and private.household_resolved_appellation(w.household_id,w.area,w.appellation)=a.id
    ), candidates as (
        select p.id from terms t join public.enrichment_places p
          on p.place_type='climat' and private.drinking_window_place_contains(p_appellation_id,p.id)
        cross join lateral (select case when pg_catalog.left(p.normalized_name,
            pg_catalog.length(t.appellation) + 1)=t.appellation || ' '
          then pg_catalog.substr(p.normalized_name,pg_catalog.length(t.appellation) + 2)
          else p.normalized_name end as relative_name) n
        where t.cuvee <> '' and (p.normalized_name=t.cuvee
          or pg_catalog.regexp_replace(n.relative_name,'^les ','')
             = pg_catalog.regexp_replace(t.cuvee,'^les ',''))
        union
        select p.id from terms t join public.enrichment_place_aliases a
          on a.normalized_value=t.cuvee or a.normalized_value=t.appellation || ' ' || t.cuvee
        join public.enrichment_places p on p.id=a.place_id and p.place_type='climat'
          and private.drinking_window_place_contains(p_appellation_id,p.id)
        where t.cuvee <> ''
        union
        select p.id
        from terms t
        join private.drinking_window_reviewed_release_anchors anchor
          on anchor.producer_id=t.producer_id and anchor.appellation_id=p_appellation_id
         and anchor.wine_color=t.wine_color and t.cuvee=any(anchor.name_keys)
         and (t.product_id is null or t.product_id=anchor.product_id)
        join private.drinking_window_profile_identity_batches batch on batch.id=anchor.batch_id
        join private.drinking_window_profile_exchanges exchange on exchange.id=batch.exchange_id
        join lateral (
          select (pg_catalog.array_agg(c.value))[1] as cuvee
          from pg_catalog.jsonb_array_elements(exchange.document -> 'cuvees') c
          where (c.value ->> 'id') || '|' || anchor.vintage_year::text = any(batch.selected_release_keys)
            and private.drinking_window_profile_cuvee_name_keys(c.value ->> 'name',c.value ->> 'appellation') && anchor.name_keys
            and private.canonical_enrichment_wine_color(c.value ->> 'color')=anchor.wine_color
            and exists (select 1 from pg_catalog.jsonb_array_elements(exchange.document -> 'exact_release_calibrations') x
              where x.value ->> 'cuvee_id'=c.value ->> 'id'
                and x.value ->> 'vintage'=anchor.vintage_year::text
                and x.value ->> 'format_ml'=anchor.format_ml::text)
          having count(*)=1
        ) reviewed on true
        cross join lateral pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(reviewed.cuvee -> 'aliases')='array'
               then reviewed.cuvee -> 'aliases' else '[]'::jsonb end) alias
        join public.enrichment_places p on p.place_type='climat'
          and private.drinking_window_place_contains(p_appellation_id,p.id)
          and (p.normalized_name=private.normalize_wine_reference_text(alias.value #>> '{}')
            or p.normalized_name=t.appellation || ' ' || private.normalize_wine_reference_text(alias.value #>> '{}'))
        where t.cuvee <> '' and pg_catalog.jsonb_typeof(alias.value)='string'
          and length(private.normalize_wine_reference_text(alias.value #>> '{}')) >= 3
          and case when pg_catalog.jsonb_typeof(reviewed.cuvee -> 'name_history')='array'
                   then pg_catalog.jsonb_array_length(reviewed.cuvee -> 'name_history')=0
                   else reviewed.cuvee -> 'name_history' is null end
        group by p.id
        having count(distinct anchor.product_id)=1
    )
    select case when count(*)=1 then min(id::text)::uuid else null end from candidates;
$$;

commit;
