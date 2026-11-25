begin;

-- A curator can explicitly reconcile a profile's place wording with an
-- existing canonical place. This is an import-scoped choice, not a global
-- alias; the selected appellation must still belong to the selected region.
create or replace function public.preview_drinking_window_profile_exchange(
    p_id uuid, p_version_id uuid, p_identity_map jsonb default '{}'::jsonb
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_profile private.drinking_window_profile_exchanges%rowtype;
    v_item jsonb;
    v_cuvee jsonb;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_region_id uuid;
    v_appellation_id uuid;
    v_existing public.drinking_window_reference_rows%rowtype;
    v_count integer;
    v_status text;
    v_reason text;
    v_results jsonb := '[]'::jsonb;
    v_key text;
    v_year integer;
    v_format integer;
    v_first integer;
    v_start integer;
    v_end integer;
    v_color text;
    v_urls jsonb;
    v_allowed_urls text[];
    v_rationale text;
    v_mapped_region text;
    v_mapped_appellation text;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select * into v_profile from private.drinking_window_profile_exchanges where id = p_id;
    if not found then
        raise exception using errcode = '22023', message = 'Choose an imported profile';
    end if;
    if not exists (select 1 from public.drinking_window_reference_versions
        where id = p_version_id and status = 'draft') then
        raise exception using errcode = '22023', message = 'Choose an unpublished working version';
    end if;
    if v_profile.profile_kind <> 'producer' then
        raise exception using errcode = '22023', message = 'Place profile staging is not available yet';
    end if;
    if p_identity_map is null or pg_catalog.jsonb_typeof(p_identity_map) <> 'object'
       or (p_identity_map ? 'regions' and pg_catalog.jsonb_typeof(p_identity_map -> 'regions') <> 'object')
       or (p_identity_map ? 'appellations' and pg_catalog.jsonb_typeof(p_identity_map -> 'appellations') <> 'object') then
        raise exception using errcode = '22023', message = 'Invalid identity mapping';
    end if;
    if p_identity_map ? 'producer_id' then
        select count(*), min(p.id::text)::uuid into v_count, v_producer_id
        from public.wine_reference_producers p
        where p.id = (p_identity_map ->> 'producer_id')::uuid;
    else
        select count(*), min(p.id::text)::uuid into v_count, v_producer_id
        from public.wine_reference_producers p
        where private.normalize_wine_reference_text(p.canonical_name)
            = private.normalize_wine_reference_text(v_profile.document #>> '{producer,name}');
    end if;
    if v_count <> 1 then v_producer_id := null; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(
        v_profile.document -> 'exact_release_calibrations') loop
        v_key := coalesce(v_item ->> 'cuvee_id', '?') || ' · '
            || coalesce(v_item ->> 'vintage', '?') || ' · '
            || coalesce(v_item ->> 'format_ml', '?') || ' ml';
        v_status := 'quarantined'; v_reason := null;
        v_product_id := null; v_release_id := null;
        v_region_id := null; v_appellation_id := null;
        v_existing := null;
        v_cuvee := null;
        select c.value into v_cuvee from pg_catalog.jsonb_array_elements(
            v_profile.document -> 'cuvees') c
        where c.value ->> 'id' = v_item ->> 'cuvee_id';
        if v_cuvee is null then
            v_reason := 'Unknown cuvée ID in profile';
        elsif v_producer_id is null then
            v_reason := 'Producer has no unique canonical identity';
        else
            if p_identity_map #>> array['cuvees',v_item ->> 'cuvee_id'] is not null then
                select count(*), min(p.id::text)::uuid into v_count, v_product_id
                from public.wine_reference_products p
                where p.id = (p_identity_map #>> array['cuvees',v_item ->> 'cuvee_id'])::uuid
                  and p.producer_id = v_producer_id;
            else
                select count(*), min(p.id::text)::uuid into v_count, v_product_id
                from public.wine_reference_products p
                where p.producer_id = v_producer_id
                  and private.normalize_wine_reference_text(p.canonical_name)
                    = private.normalize_wine_reference_text(v_cuvee ->> 'name');
            end if;
            if v_count <> 1 then
                v_product_id := null;
                v_reason := 'Cuvée has no unique canonical identity';
            end if;
        end if;
        if v_reason is null then
            v_mapped_region := p_identity_map #>> array['regions',v_cuvee ->> 'region'];
            if v_mapped_region is not null then
                select count(*), min(p.id::text)::uuid into v_count, v_region_id
                from public.enrichment_places p
                where p.id = v_mapped_region::uuid
                  and p.place_type in ('region','subregion');
            else
                select count(*), min(p.id::text)::uuid into v_count, v_region_id
                from public.enrichment_places p
                where p.place_type in ('region','subregion')
                  and p.normalized_name = private.normalize_wine_reference_text(v_cuvee ->> 'region');
            end if;
            if v_count <> 1 then
                v_region_id := null;
                v_reason := 'Region has no unique canonical identity';
            end if;
        end if;
        if v_reason is null then
            v_mapped_appellation := p_identity_map #>> array['appellations',v_cuvee ->> 'appellation'];
            if v_mapped_appellation is not null then
                select count(*), min(p.id::text)::uuid into v_count, v_appellation_id
                from public.enrichment_places p
                where p.id = v_mapped_appellation::uuid
                  and p.place_type = 'appellation'
                  and private.drinking_window_place_contains(v_region_id, p.id);
            else
                select count(*), min(p.id::text)::uuid into v_count, v_appellation_id
                from public.enrichment_places p
                where p.place_type = 'appellation'
                  and p.normalized_name = private.normalize_wine_reference_text(v_cuvee ->> 'appellation')
                  and private.drinking_window_place_contains(v_region_id, p.id);
            end if;
            if v_count <> 1 then
                v_appellation_id := null;
                v_reason := 'Appellation has no unique canonical identity in this region';
            end if;
        end if;
        if v_reason is null then
            if coalesce(v_item ->> 'vintage','') !~ '^[0-9]{4}$'
               or coalesce(v_item ->> 'format_ml','') !~ '^[0-9]{2,5}$'
               or coalesce(v_item #>> '{proposal,first_trial_year}','') !~ '^[0-9]{4}$'
               or coalesce(v_item #>> '{proposal,best_start_year}','') !~ '^[0-9]{4}$'
               or coalesce(v_item #>> '{proposal,best_end_year}','') !~ '^[0-9]{4}$' then
                v_reason := 'Malformed vintage, format or window';
            else
                v_year := (v_item ->> 'vintage')::integer;
                v_format := (v_item ->> 'format_ml')::integer;
                v_first := (v_item #>> '{proposal,first_trial_year}')::integer;
                v_start := (v_item #>> '{proposal,best_start_year}')::integer;
                v_end := (v_item #>> '{proposal,best_end_year}')::integer;
                v_color := v_cuvee ->> 'color';
                v_rationale := pg_catalog.btrim(coalesce(v_item #>> '{proposal,rationale}',''));
                v_urls := v_item #> '{proposal,supporting_source_urls}';
                v_allowed_urls := private.drinking_window_profile_source_urls(
                    v_profile.document,v_item #> '{proposal,supporting_source_ids}');
                if v_year not between 1800 and 2200 or v_format not between 50 and 30000
                   or v_first < v_year or v_first > v_start or v_start > v_end or v_end > 2300
                   or v_color not in ('red','white','rose','sparkling','sweet','fortified','other')
                   or length(v_rationale) not between 30 and 2000
                   or pg_catalog.jsonb_typeof(v_urls) is distinct from 'array'
                   or pg_catalog.jsonb_array_length(coalesce(v_urls,'[]'::jsonb)) not between 1 and 10
                   or v_allowed_urls is null
                   or exists (select 1 from pg_catalog.jsonb_array_elements_text(
                       coalesce(v_urls,'[]'::jsonb)) u where u.value !~ '^https://[^[:space:]]+$'
                       or length(u.value) > 1000
                       or not (u.value = any(v_allowed_urls))) then
                    v_reason := 'Window, rationale or context links need correction';
                end if;
            end if;
        end if;
        if v_reason is null then
            select count(*), min(r.id::text)::uuid into v_count, v_release_id
            from public.wine_reference_releases r
            where r.product_id = v_product_id and r.vintage_year = v_year;
            if v_count <> 1 then
                v_release_id := null;
                v_reason := 'Release has no unique canonical identity';
            end if;
        end if;
        if v_reason is null then
            select r.* into v_existing from public.drinking_window_reference_rows r
            where r.version_id = p_version_id and r.scope = 'release'
              and r.release_id = v_release_id and r.format_ml = v_format
              and r.wine_color = v_color and r.region_id = v_region_id
              and r.appellation_id = v_appellation_id;
            if found then
                if v_existing.first_trial_year = v_first
                   and v_existing.best_start_year = v_start
                   and v_existing.best_end_year = v_end then
                    v_status := 'unchanged';
                else
                    v_reason := 'Conflicting window already exists in this draft';
                end if;
            else
                v_status := 'ready';
            end if;
        end if;
        v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'key',v_key,'status',v_status,'reason',v_reason,
            'producer_id',v_producer_id,'product_id',v_product_id,
            'release_id',v_release_id,'region_id',v_region_id,
            'appellation_id',v_appellation_id,
            'cuvee',v_cuvee ->> 'name','color',v_cuvee ->> 'color',
            'vintage',v_item ->> 'vintage','format_ml',v_item ->> 'format_ml',
            'first_trial_year',v_item #>> '{proposal,first_trial_year}',
            'best_start_year',v_item #>> '{proposal,best_start_year}',
            'best_end_year',v_item #>> '{proposal,best_end_year}',
            'rationale',v_item #>> '{proposal,rationale}',
            'source_urls',v_urls,'existing_row_id',v_existing.id));
    end loop;
    return pg_catalog.jsonb_build_object('profile_id',p_id,
        'profile_hash',v_profile.document_sha256,'version_id',p_version_id,
        'profile_kind',v_profile.profile_kind,'profile_name',v_profile.profile_name,
        'preview_sha256',pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(v_results::text,'UTF8'),'sha256'),'hex'),
        'rows',v_results);
end;
$$;

commit;
