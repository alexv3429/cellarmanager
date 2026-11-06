begin;

-- Some producers changed geographical indications between vintages. A
-- curator's release-specific decision wins over a profile-wide place mapping;
-- both paths still validate that the appellation belongs to the region.
-- Conflicting reviewed anchors for the same shared release must not let the
-- cellar silently choose whichever appellation happens to match its label.
create or replace function private.drinking_window_unique_reviewed_release(
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
      and not exists (
          select 1 from private.drinking_window_reviewed_release_anchors conflicting
          where conflicting.release_id = anchor.release_id
            and (conflicting.appellation_id <> anchor.appellation_id
                 or conflicting.wine_color <> anchor.wine_color)
      )
    having count(distinct anchor.release_id) = 1;
$$;

create or replace function private.drinking_window_profile_identity_plan(
    p_id uuid, p_identity_map jsonb, p_release_keys text[]
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_profile private.drinking_window_profile_exchanges%rowtype;
    v_producer_id uuid;
    v_producer_status text;
    v_producer_name text;
    v_item jsonb;
    v_cuvee jsonb;
    v_key text;
    v_product_id uuid;
    v_product_status text;
    v_release_id uuid;
    v_release_status text;
    v_region_id uuid;
    v_appellation_id uuid;
    v_region_name text;
    v_appellation_name text;
    v_count integer;
    v_reason text;
    v_urls jsonb;
    v_entries jsonb := '[]'::jsonb;
    v_plan jsonb;
    v_status text := 'ready';
begin
    if p_id is null or p_identity_map is null
       or pg_catalog.jsonb_typeof(p_identity_map) <> 'object'
       or (p_identity_map ? 'cuvees' and pg_catalog.jsonb_typeof(p_identity_map -> 'cuvees') <> 'object')
       or (p_identity_map ? 'regions' and pg_catalog.jsonb_typeof(p_identity_map -> 'regions') <> 'object')
       or (p_identity_map ? 'appellations' and pg_catalog.jsonb_typeof(p_identity_map -> 'appellations') <> 'object')
       or (p_identity_map ? 'release_appellations' and pg_catalog.jsonb_typeof(p_identity_map -> 'release_appellations') <> 'object')
       or p_release_keys is null or pg_catalog.cardinality(p_release_keys) not between 1 and 100
       or pg_catalog.cardinality(p_release_keys) <>
          (select count(distinct k) from pg_catalog.unnest(p_release_keys) k)
       or exists (select 1 from pg_catalog.unnest(p_release_keys) k
           where k is null or length(k) not between 3 and 150) then
        raise exception using errcode = '22023', message = 'Choose distinct profile releases and a valid identity map';
    end if;
    select * into v_profile from private.drinking_window_profile_exchanges
    where id = p_id and profile_kind = 'producer';
    if not found then
        raise exception using errcode = '22023', message = 'Choose an imported producer profile';
    end if;
    v_producer_name := pg_catalog.btrim(coalesce(v_profile.document #>> '{producer,name}', ''));
    if length(v_producer_name) not between 2 and 200
       or pg_catalog.jsonb_typeof(v_profile.document -> 'cuvees') is distinct from 'array'
       or pg_catalog.jsonb_typeof(v_profile.document -> 'exact_release_calibrations') is distinct from 'array'
       or pg_catalog.jsonb_typeof(v_profile.document -> 'sources') is distinct from 'array' then
        raise exception using errcode = '22023', message = 'Incomplete producer profile';
    end if;
    if p_identity_map ? 'producer_id' then
        select count(*), min(p.id::text)::uuid into v_count, v_producer_id
        from public.wine_reference_producers p
        where p.id = (p_identity_map ->> 'producer_id')::uuid;
    else
        select count(*), min(p.id::text)::uuid into v_count, v_producer_id
        from public.wine_reference_producers p
        where private.normalize_wine_reference_text(p.canonical_name)
            = private.normalize_wine_reference_text(v_producer_name);
    end if;
    if v_count = 1 then
        v_producer_status := 'existing';
    elsif v_count = 0 and not (p_identity_map ? 'producer_id') then
        v_producer_status := 'create';
    else
        v_producer_status := 'blocked';
        v_status := 'blocked';
    end if;
    for v_key in select k from pg_catalog.unnest(p_release_keys) k order by k loop
        v_reason := null;
        v_item := null;
        v_cuvee := null;
        v_product_id := null; v_release_id := null;
        v_region_id := null; v_appellation_id := null;
        v_product_status := 'blocked'; v_release_status := 'blocked';
        v_urls := '[]'::jsonb;
        select i.value into v_item
        from pg_catalog.jsonb_array_elements(v_profile.document -> 'exact_release_calibrations') i
        where ((i.value ->> 'cuvee_id') || '|' || (i.value ->> 'vintage')) = v_key
        limit 1;
        if v_item is null then
            v_reason := 'Release key is absent from this profile';
        elsif (select count(*) from pg_catalog.jsonb_array_elements(
            v_profile.document -> 'exact_release_calibrations') i
            where ((i.value ->> 'cuvee_id') || '|' || (i.value ->> 'vintage')) = v_key
            and (case when coalesce(i.value ->> 'format_ml','') ~ '^[0-9]{2,5}$'
                then (i.value ->> 'format_ml')::integer not between 50 and 30000
                else true end)) > 0 then
            v_reason := 'Release format is invalid';
        end if;
        if v_item is not null then
            select c.value into v_cuvee from pg_catalog.jsonb_array_elements(
                v_profile.document -> 'cuvees') c
            where c.value ->> 'id' = v_item ->> 'cuvee_id';
            if v_cuvee is null then v_reason := 'Unknown cuvée ID in profile'; end if;
            select coalesce(pg_catalog.jsonb_agg(distinct s.value ->> 'url'
                order by s.value ->> 'url'), '[]'::jsonb)
            into v_urls from pg_catalog.jsonb_array_elements(v_profile.document -> 'sources') s
            where s.value ->> 'id' in (
                select x.value from pg_catalog.jsonb_array_elements(
                    v_profile.document -> 'exact_release_calibrations') i
                cross join lateral pg_catalog.jsonb_array_elements_text(
                    coalesce(i.value #> '{release_existence,source_ids}', '[]'::jsonb)) x
                where ((i.value ->> 'cuvee_id') || '|' || (i.value ->> 'vintage')) = v_key
            ) and s.value ->> 'url' ~ '^https?://';
            if v_reason is null and pg_catalog.jsonb_array_length(v_urls) = 0 then
                v_reason := 'Release existence needs a source pointer';
            end if;
        end if;
        if v_reason is null and v_producer_status = 'blocked' then
            v_reason := 'Producer has no unique canonical identity';
        end if;
        if v_reason is null then
            v_region_name := v_cuvee ->> 'region';
            v_appellation_name := v_cuvee ->> 'appellation';
            if p_identity_map #>> array['regions',v_region_name] is not null then
                select count(*), min(p.id::text)::uuid into v_count, v_region_id
                from public.enrichment_places p
                where p.id = (p_identity_map #>> array['regions',v_region_name])::uuid
                  and p.place_type in ('region','subregion');
            else
                select count(*), min(p.id::text)::uuid into v_count, v_region_id
                from public.enrichment_places p
                where p.place_type in ('region','subregion')
                  and p.normalized_name = private.normalize_wine_reference_text(v_region_name);
            end if;
            if v_count <> 1 then v_reason := 'Region has no unique canonical identity'; end if;
        end if;
        if v_reason is null then
            if coalesce(p_identity_map #>> array['release_appellations',v_key],
                p_identity_map #>> array['appellations',v_appellation_name]) is not null then
                select count(*), min(p.id::text)::uuid into v_count, v_appellation_id
                from public.enrichment_places p
                where p.id = coalesce(p_identity_map #>> array['release_appellations',v_key],
                    p_identity_map #>> array['appellations',v_appellation_name])::uuid
                  and p.place_type = 'appellation'
                  and private.drinking_window_place_contains(v_region_id, p.id);
            else
                select count(*), min(p.id::text)::uuid into v_count, v_appellation_id
                from public.enrichment_places p
                where p.place_type = 'appellation'
                  and p.normalized_name = private.normalize_wine_reference_text(v_appellation_name)
                  and private.drinking_window_place_contains(v_region_id, p.id);
            end if;
            if v_count <> 1 then v_reason := 'Appellation has no unique canonical identity in this region'; end if;
        end if;
        if v_reason is null then
            if p_identity_map #>> array['cuvees',v_cuvee ->> 'id'] is not null then
                select count(*), min(p.id::text)::uuid into v_count, v_product_id
                from public.wine_reference_products p
                where p.id = (p_identity_map #>> array['cuvees',v_cuvee ->> 'id'])::uuid
                  and p.producer_id = v_producer_id;
            elsif v_producer_id is not null then
                select count(*), min(p.id::text)::uuid into v_count, v_product_id
                from public.wine_reference_products p
                where p.producer_id = v_producer_id
                  and private.normalize_wine_reference_text(p.canonical_name)
                    = private.normalize_wine_reference_text(v_cuvee ->> 'name');
            else
                v_count := 0;
            end if;
            if v_count = 1 then
                v_product_status := 'existing';
            elsif v_count = 0 and p_identity_map #>> array['cuvees',v_cuvee ->> 'id'] is null
              and length(pg_catalog.btrim(coalesce(v_cuvee ->> 'name',''))) between 2 and 200
              and not exists (select 1 from pg_catalog.jsonb_array_elements(
                  v_profile.document -> 'cuvees') c
                  where c.value ->> 'id' <> v_cuvee ->> 'id'
                    and private.normalize_wine_reference_text(c.value ->> 'name')
                      = private.normalize_wine_reference_text(v_cuvee ->> 'name')) then
                v_product_status := 'create';
            else
                v_reason := 'Cuvée is ambiguous; choose an existing shared identity';
            end if;
        end if;
        if v_reason is null then
            if coalesce(v_item ->> 'vintage','') !~ '^[0-9]{4}$'
               or (v_item ->> 'vintage')::integer not between 1800 and 2200 then
                v_reason := 'Invalid release vintage';
            elsif v_product_id is null then
                v_release_status := 'create';
            else
                select count(*), min(r.id::text)::uuid into v_count, v_release_id
                from public.wine_reference_releases r
                where r.product_id = v_product_id
                  and r.vintage_year = (v_item ->> 'vintage')::integer;
                if v_count = 1 then v_release_status := 'existing';
                elsif v_count = 0 then v_release_status := 'create';
                else v_reason := 'Several canonical releases exist for this vintage'; end if;
            end if;
        end if;
        if v_reason is not null then v_status := 'blocked'; end if;
        v_entries := v_entries || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'key', v_key, 'cuvee_id', v_cuvee ->> 'id', 'cuvee_name', v_cuvee ->> 'name',
            'vintage', v_item ->> 'vintage', 'region_id', v_region_id,
            'appellation_id', v_appellation_id,
            'product_id', v_product_id, 'product_status', v_product_status,
            'release_id', v_release_id, 'release_status', v_release_status,
            'source_urls', v_urls, 'reason', v_reason));
    end loop;
    v_plan := pg_catalog.jsonb_build_object(
        'profile_id', p_id, 'document_sha256', v_profile.document_sha256,
        'producer_name', v_producer_name, 'producer_id', v_producer_id,
        'producer_status', v_producer_status, 'status', v_status,
        'release_keys', to_jsonb((select pg_catalog.array_agg(k order by k)
            from pg_catalog.unnest(p_release_keys) k)), 'entries', v_entries);
    return v_plan || pg_catalog.jsonb_build_object('plan_sha256',
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_plan::text,'UTF8'),'sha256'),'hex'));
end;
$$;

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
       or (p_identity_map ? 'appellations' and pg_catalog.jsonb_typeof(p_identity_map -> 'appellations') <> 'object')
       or (p_identity_map ? 'release_appellations' and pg_catalog.jsonb_typeof(p_identity_map -> 'release_appellations') <> 'object') then
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
            v_mapped_appellation := coalesce(
                p_identity_map #>> array['release_appellations',
                    (v_item ->> 'cuvee_id') || '|' || (v_item ->> 'vintage')],
                p_identity_map #>> array['appellations',v_cuvee ->> 'appellation']);
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

-- A database sequence preserves decision order even when two batches are
-- confirmed in the same transaction and therefore share a timestamp.
alter table private.drinking_window_profile_identity_batches
    add column if not exists sequence_no bigint generated always as identity;

-- Restore only choices that were actually included in a confirmed identity
-- batch. A later batch for the same release supersedes an earlier choice.
create or replace function public.get_reviewed_profile_release_appellations(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if not exists (select 1 from private.drinking_window_profile_exchanges e
        where e.id=p_id and e.profile_kind='producer') then
        raise exception using errcode='22023', message='Choose an imported producer profile';
    end if;
    with latest as (
        select distinct on (release_key) release_key,
            batch.identity_map #>> array['release_appellations',release_key] target_id
        from private.drinking_window_profile_identity_batches batch
        cross join lateral pg_catalog.unnest(batch.selected_release_keys) release_key
        where batch.exchange_id=p_id
        order by release_key,batch.created_at desc,batch.sequence_no desc
    )
    select coalesce(pg_catalog.jsonb_object_agg(release_key,target_id)
        filter (where target_id is not null),'{}'::jsonb) into v_result from latest;
    return v_result;
end;
$$;
revoke all on function public.get_reviewed_profile_release_appellations(uuid) from public, anon;
grant execute on function public.get_reviewed_profile_release_appellations(uuid) to authenticated;

commit;
