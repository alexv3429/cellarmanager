begin;

-- A saved research profile may describe releases absent from the sparse
-- canonical graph. This is an identity-only, curator-confirmed operation:
-- it never stages dates, creates a package, or links a household wine.
create table private.drinking_window_profile_identity_batches (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    exchange_id uuid not null references private.drinking_window_profile_exchanges(id),
    document_sha256 text not null,
    plan_sha256 text not null check (plan_sha256 ~ '^[0-9a-f]{64}$'),
    selected_release_keys text[] not null,
    identity_map jsonb not null,
    created_by uuid not null references public.enrichment_curator_eligibilities(user_id),
    review_reason text not null check (length(pg_catalog.btrim(review_reason)) between 30 and 1000),
    result jsonb not null,
    created_at timestamptz not null default now()
);
revoke all on private.drinking_window_profile_identity_batches
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_profile_identity_batches to service_role;
create trigger drinking_window_profile_identity_batches_immutable
before update or delete on private.drinking_window_profile_identity_batches
for each row execute function private.reject_drinking_window_shadow_update();

create function private.drinking_window_profile_identity_plan(
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
            if p_identity_map #>> array['appellations',v_appellation_name] is not null then
                select count(*), min(p.id::text)::uuid into v_count, v_appellation_id
                from public.enrichment_places p
                where p.id = (p_identity_map #>> array['appellations',v_appellation_name])::uuid
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
revoke all on function private.drinking_window_profile_identity_plan(uuid,jsonb,text[])
from public, anon, authenticated, powersync_role, service_role;

create function public.preview_drinking_window_profile_identity_batch(
    p_id uuid, p_identity_map jsonb, p_release_keys text[]
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    return private.drinking_window_profile_identity_plan(p_id,p_identity_map,p_release_keys);
end;
$$;
revoke all on function public.preview_drinking_window_profile_identity_batch(uuid,jsonb,text[])
from public, anon;
grant execute on function public.preview_drinking_window_profile_identity_batch(uuid,jsonb,text[])
to authenticated;

create function public.create_drinking_window_profile_identity_batch(
    p_id uuid, p_identity_map jsonb, p_release_keys text[],
    p_expected_plan_sha256 text, p_review_reason text, p_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_plan jsonb;
    v_entry jsonb;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_products jsonb := '{}'::jsonb;
    v_created_producers integer := 0;
    v_created_products integer := 0;
    v_created_releases integer := 0;
    v_result jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_confirmed is distinct from true
       or length(pg_catalog.btrim(coalesce(p_review_reason,''))) not between 30 and 1000 then
        raise exception using errcode = '22023',
            message = 'Confirm the reviewed wine identities and explain the decision';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(927412,3);
    v_plan := private.drinking_window_profile_identity_plan(p_id,p_identity_map,p_release_keys);
    if p_expected_plan_sha256 is distinct from v_plan ->> 'plan_sha256' then
        raise exception using errcode = '40001', message = 'Identity plan changed; preview again';
    end if;
    if v_plan ->> 'status' <> 'ready' then
        raise exception using errcode = '22023', message = 'Resolve blocked identities before creating a batch';
    end if;
    v_producer_id := (v_plan ->> 'producer_id')::uuid;
    if v_plan ->> 'producer_status' = 'create' then
        v_producer_id := pg_catalog.gen_random_uuid();
        insert into public.wine_reference_entities(id,entity_type)
        values (v_producer_id,'producer');
        insert into public.wine_reference_producers(id,canonical_name)
        values (v_producer_id,v_plan ->> 'producer_name');
        v_created_producers := 1;
    end if;
    for v_entry in select value from pg_catalog.jsonb_array_elements(v_plan -> 'entries') loop
        v_product_id := (v_entry ->> 'product_id')::uuid;
        if v_entry ->> 'product_status' = 'create' then
            v_product_id := (v_products ->> (v_entry ->> 'cuvee_id'))::uuid;
            if v_product_id is null then
                v_product_id := pg_catalog.gen_random_uuid();
                insert into public.wine_reference_entities(id,entity_type)
                values (v_product_id,'product');
                insert into public.wine_reference_products(id,producer_id,canonical_name)
                values (v_product_id,v_producer_id,v_entry ->> 'cuvee_name');
                v_products := v_products || pg_catalog.jsonb_build_object(v_entry ->> 'cuvee_id', v_product_id);
                v_created_products := v_created_products + 1;
            end if;
        end if;
        if v_entry ->> 'release_status' = 'create' then
            v_release_id := pg_catalog.gen_random_uuid();
            insert into public.wine_reference_entities(id,entity_type)
            values (v_release_id,'release');
            insert into public.wine_reference_releases(id,product_id,vintage_year)
            values (v_release_id,v_product_id,(v_entry ->> 'vintage')::integer);
            v_created_releases := v_created_releases + 1;
        end if;
    end loop;
    v_result := pg_catalog.jsonb_build_object(
        'producer_id',v_producer_id,'created_producers',v_created_producers,
        'created_products',v_created_products,'created_releases',v_created_releases,
        'dates_staged',0,'wines_linked',0,'published',false);
    insert into private.drinking_window_profile_identity_batches(
        exchange_id,document_sha256,plan_sha256,selected_release_keys,
        identity_map,created_by,review_reason,result
    ) values (
        p_id,v_plan ->> 'document_sha256',p_expected_plan_sha256,p_release_keys,
        p_identity_map,auth.uid(),pg_catalog.btrim(p_review_reason),v_result
    );
    return v_result;
end;
$$;
revoke all on function public.create_drinking_window_profile_identity_batch(
    uuid,jsonb,text[],text,text,boolean) from public, anon;
grant execute on function public.create_drinking_window_profile_identity_batch(
    uuid,jsonb,text[],text,text,boolean) to authenticated;

commit;
