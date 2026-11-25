-- A reviewed exact release may be found under an explicitly supplied cuvée
-- alias. This is read-time identification, not a change to a household wine.
-- Name histories require separate, vintage-specific review.
create function private.drinking_window_reviewed_cuvee_name_keys(p_cuvee jsonb)
returns text[] language sql immutable set search_path = '' as $$
    with names as (
        select unnest(private.drinking_window_profile_cuvee_name_keys(
            p_cuvee ->> 'name', p_cuvee ->> 'appellation')) as name
        union all
        select private.normalize_wine_reference_text(alias.value #>> '{}')
        from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(p_cuvee -> 'aliases') = 'array'
                 then p_cuvee -> 'aliases' else '[]'::jsonb end) alias
        where pg_catalog.jsonb_typeof(alias.value) = 'string'
          and case when pg_catalog.jsonb_typeof(p_cuvee -> 'name_history') = 'array'
                   then pg_catalog.jsonb_array_length(p_cuvee -> 'name_history') = 0
                   else p_cuvee -> 'name_history' is null end
    )
    select pg_catalog.array_agg(distinct name order by name)
    from names where length(name) >= 3;
$$;
revoke all on function private.drinking_window_reviewed_cuvee_name_keys(jsonb)
from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.drinking_window_reviewed_cuvee_name_keys(jsonb) to postgres;

create or replace function private.record_drinking_window_reviewed_release_anchors(p_batch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
    v_batch private.drinking_window_profile_identity_batches%rowtype;
    v_document jsonb;
    v_plan jsonb;
    v_entry jsonb;
    v_cuvee jsonb;
    v_calibration jsonb;
    v_names text[];
begin
    select * into strict v_batch from private.drinking_window_profile_identity_batches
    where id = p_batch_id;
    select exchange.document into v_document
    from private.drinking_window_profile_exchanges exchange
    where exchange.id = v_batch.exchange_id;
    v_plan := private.drinking_window_profile_identity_plan(
        v_batch.exchange_id, v_batch.identity_map, v_batch.selected_release_keys);
    if v_plan ->> 'status' <> 'ready'
       or v_plan ->> 'document_sha256' <> v_batch.document_sha256 then
        raise exception 'Reviewed identity batch cannot be resolved to its saved profile';
    end if;
    for v_entry in select value from pg_catalog.jsonb_array_elements(v_plan -> 'entries') loop
        select c.value into v_cuvee
        from pg_catalog.jsonb_array_elements(v_document -> 'cuvees') c
        where c.value ->> 'id' = v_entry ->> 'cuvee_id';
        v_names := private.drinking_window_reviewed_cuvee_name_keys(v_cuvee);
        if pg_catalog.cardinality(v_names) is null then
            raise exception 'Reviewed cuvée has no usable name';
        end if;
        for v_calibration in select i.value
            from pg_catalog.jsonb_array_elements(v_document -> 'exact_release_calibrations') i
            where (i.value ->> 'cuvee_id') || '|' || (i.value ->> 'vintage')
                = v_entry ->> 'key'
        loop
            insert into private.drinking_window_reviewed_release_anchors (
                batch_id, release_id, producer_id, product_id, region_id,
                appellation_id, wine_color, vintage_year, format_ml, name_keys
            ) values (
                v_batch.id, (v_entry ->> 'release_id')::uuid,
                (v_plan ->> 'producer_id')::uuid, (v_entry ->> 'product_id')::uuid,
                (v_entry ->> 'region_id')::uuid, (v_entry ->> 'appellation_id')::uuid,
                private.canonical_enrichment_wine_color(v_cuvee ->> 'color'),
                (v_entry ->> 'vintage')::integer,
                (v_calibration ->> 'format_ml')::integer, v_names
            ) on conflict (batch_id, release_id, format_ml) do nothing;
        end loop;
    end loop;
end;
$$;

-- Backfill only when the original reviewed profile identifies exactly one
-- cuvée for this anchor, vintage and format. Never guess between candidates.
with possible as (
    select a.batch_id, a.release_id, a.format_ml, c.value as cuvee
    from private.drinking_window_reviewed_release_anchors a
    join private.drinking_window_profile_identity_batches b on b.id = a.batch_id
    join private.drinking_window_profile_exchanges e on e.id = b.exchange_id
    cross join lateral pg_catalog.jsonb_array_elements(e.document -> 'cuvees') c
    where (c.value ->> 'id') || '|' || a.vintage_year::text = any(b.selected_release_keys)
      and private.drinking_window_profile_cuvee_name_keys(
          c.value ->> 'name', c.value ->> 'appellation') && a.name_keys
      and private.canonical_enrichment_wine_color(c.value ->> 'color') = a.wine_color
      and exists (
          select 1 from pg_catalog.jsonb_array_elements(e.document -> 'exact_release_calibrations') x
          where x.value ->> 'cuvee_id' = c.value ->> 'id'
            and x.value ->> 'vintage' = a.vintage_year::text
            and x.value ->> 'format_ml' = a.format_ml::text
      )
), unique_cuvee as (
    select batch_id, release_id, format_ml, (pg_catalog.array_agg(cuvee))[1] as cuvee
    from possible group by batch_id, release_id, format_ml having count(*) = 1
)
update private.drinking_window_reviewed_release_anchors a
set name_keys = array(
    select distinct name from unnest(a.name_keys ||
        private.drinking_window_reviewed_cuvee_name_keys(u.cuvee)) name order by name)
from unique_cuvee u
where (a.batch_id,a.release_id,a.format_ml) = (u.batch_id,u.release_id,u.format_ml);
