begin;

-- An identity batch confirms that a named release exists. It does not approve
-- its proposed drinking dates or make a household spelling a global alias.
create table private.drinking_window_reviewed_release_anchors (
    batch_id uuid not null references private.drinking_window_profile_identity_batches(id),
    release_id uuid not null references public.wine_reference_releases(id),
    producer_id uuid not null references public.wine_reference_producers(id),
    product_id uuid not null references public.wine_reference_products(id),
    region_id uuid not null references public.enrichment_places(id),
    appellation_id uuid not null references public.enrichment_places(id),
    wine_color text not null,
    vintage_year integer not null,
    format_ml integer not null,
    name_keys text[] not null,
    primary key (batch_id, release_id, format_ml),
    check (pg_catalog.cardinality(name_keys) > 0)
);
revoke all on private.drinking_window_reviewed_release_anchors
from public, anon, authenticated, powersync_role, service_role;
create index drinking_window_reviewed_release_anchors_lookup_idx
on private.drinking_window_reviewed_release_anchors
(producer_id, appellation_id, wine_color, vintage_year, format_ml);

-- A profile may spell a cuvée "Volnay 1er cru Les Caillerets" while a cellar
-- calls it "Caillerets". Remove only its *confirmed* appellation prefix and
-- optional article; geography is independently required at lookup time.
create function private.drinking_window_profile_cuvee_name_keys(
    p_name text, p_appellation text
) returns text[] language sql immutable set search_path = '' as $$
    with source_name as (
        select private.normalize_wine_reference_text(p_name) name
    ), prefix as (
        select private.normalize_wine_reference_text(p_appellation) name
    ), variants as (
        select s.name from source_name s
        union
        select pg_catalog.btrim(pg_catalog.substr(s.name, length(p.name) + 2))
        from source_name s cross join prefix p
        where p.name <> '' and s.name like p.name || ' %'
        union
        select pg_catalog.regexp_replace(s.name, '^(le|la|les|l) ', '')
        from source_name s
        union
        select pg_catalog.regexp_replace(
            pg_catalog.btrim(pg_catalog.substr(s.name, length(p.name) + 2)),
            '^(le|la|les|l) ', '')
        from source_name s cross join prefix p
        where p.name <> '' and s.name like p.name || ' %'
    )
    select pg_catalog.array_agg(distinct name order by name)
    from variants where length(name) >= 3;
$$;
revoke all on function private.drinking_window_profile_cuvee_name_keys(text,text)
from public, anon, authenticated, powersync_role, service_role;

create function private.record_drinking_window_reviewed_release_anchors(p_batch_id uuid)
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
        v_names := private.drinking_window_profile_cuvee_name_keys(
            v_cuvee ->> 'name', v_cuvee ->> 'appellation');
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
revoke all on function private.record_drinking_window_reviewed_release_anchors(uuid)
from public, anon, authenticated, powersync_role, service_role;
create function private.record_drinking_window_reviewed_release_anchors_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    perform private.record_drinking_window_reviewed_release_anchors(new.id);
    return new;
end;
$$;
revoke all on function private.record_drinking_window_reviewed_release_anchors_trigger()
from public, anon, authenticated, powersync_role, service_role;
create trigger record_drinking_window_reviewed_release_anchors
after insert on private.drinking_window_profile_identity_batches
for each row execute function private.record_drinking_window_reviewed_release_anchors_trigger();

-- Existing batches were already curator-confirmed under the same workflow.
do $$
declare v_batch private.drinking_window_profile_identity_batches%rowtype;
begin
    for v_batch in select * from private.drinking_window_profile_identity_batches loop
        perform private.record_drinking_window_reviewed_release_anchors(v_batch.id);
    end loop;
end;
$$;

-- Only a single, exact reviewed release can enrich the household's existing
-- producer choice. An incorrect appellation, vintage, color, format, or
-- homonymous cuvée fails closed. Nothing is written to the household wine.
create function private.drinking_window_unique_reviewed_release(
    p_wine public.wines, p_producer_id uuid, p_region_id uuid,
    p_appellation_id uuid, p_color text
) returns table (product_id uuid, release_id uuid)
language sql stable set search_path = '' as $$
    select min(anchor.product_id::text)::uuid, min(anchor.release_id::text)::uuid
    from private.drinking_window_reviewed_release_anchors anchor
    where anchor.producer_id = p_producer_id
      and anchor.appellation_id = p_appellation_id
      and private.drinking_window_place_contains(p_region_id, anchor.region_id)
      and anchor.wine_color = p_color
      and anchor.vintage_year = p_wine.vintage
      and anchor.format_ml = p_wine.format_ml
      and private.normalize_wine_reference_text(p_wine.cuvee) = any(anchor.name_keys)
    having count(distinct anchor.release_id) = 1;
$$;
revoke all on function private.drinking_window_unique_reviewed_release(
    public.wines,uuid,uuid,uuid,text)
from public, anon, authenticated, powersync_role, service_role;

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
    if v_producer_id is not null and v_product_id is null
       and v_appellation_id is not null then
        select candidate.product_id,candidate.release_id
        into v_product_id,v_release_id
        from private.drinking_window_unique_reviewed_release(
            v_wine,v_producer_id,v_region_id,v_appellation_id,v_color) candidate;
    end if;
    return jsonb_build_object(
        'status',case when v_producer_id is null then 'wine_reference_unlinked' else 'ready' end,
        'wine_id',v_wine.id,'household_id',v_wine.household_id,
        'source_fingerprint',private.drinking_window_wine_identity_fingerprint(v_wine),
        'region_id',v_region_id,'appellation_id',v_appellation_id,
        'producer_id',v_producer_id,'product_id',v_product_id,
        'release_id',v_release_id,'wine_color',v_color,'vintage_year',v_wine.vintage);
end;
$$;

commit;
