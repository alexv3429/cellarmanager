begin;

-- Keep the complete, owner-supplied exchange document. The earlier producer
-- importer retained only exact-release candidates and discarded sourced facts.
-- This archive is curator-private until an explicitly reviewed reference
-- version is published; uploading alone never changes any wine advice.
create table private.drinking_window_profile_exchanges (
    id uuid primary key default gen_random_uuid(),
    document_sha256 text not null unique check (document_sha256 ~ '^[0-9a-f]{64}$'),
    profile_kind text not null check (profile_kind in ('producer', 'appellation', 'region')),
    schema_version text not null,
    dataset_version text not null,
    profile_name text not null,
    document jsonb not null check (jsonb_typeof(document) = 'object'),
    submitted_by uuid not null references public.enrichment_curator_eligibilities(user_id),
    submitted_at timestamptz not null default now()
);
revoke all on private.drinking_window_profile_exchanges
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_profile_exchanges to service_role;
create trigger drinking_window_profile_exchanges_immutable
before update or delete on private.drinking_window_profile_exchanges
for each row execute function private.reject_drinking_window_shadow_update();

create function public.import_drinking_window_profile_exchange(p_document jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_kind text;
    v_version text;
    v_name text;
    v_dataset text;
    v_hash text;
    v_id uuid;
    v_inserted boolean;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_document is null or pg_catalog.jsonb_typeof(p_document) <> 'object'
       or pg_catalog.octet_length(p_document::text) > 2000000 then
        raise exception using errcode = '22023', message = 'Choose one JSON profile below 2 MB';
    end if;
    if p_document ->> 'format' = 'cellarmanager.producer_research' then
        v_kind := 'producer';
        v_version := '1.1.0';
        v_name := p_document #>> '{producer,name}';
        if p_document ->> 'scope' is distinct from 'producer_independent_of_any_household'
           or p_document ->> 'status' is distinct from 'draft_for_curator_review'
           or p_document #>> '{import_policy,no_direct_production_publication}' is distinct from 'true'
           or p_document #>> '{import_policy,review_required}' is distinct from 'true'
           or pg_catalog.jsonb_typeof(p_document -> 'cuvees') is distinct from 'array'
           or pg_catalog.jsonb_typeof(p_document -> 'exact_release_calibrations') is distinct from 'array' then
            raise exception using errcode = '22023', message = 'Unsafe or incomplete producer exchange';
        end if;
    elsif p_document ->> 'format' = 'cellarmanager.place_profile' then
        v_kind := p_document ->> 'profile_kind';
        v_version := '1.0.0';
        v_name := p_document #>> '{place,name}';
        if v_kind is null or v_kind not in ('appellation', 'region')
           or p_document ->> 'status' is distinct from 'draft_for_curator_review'
           or pg_catalog.jsonb_typeof(p_document -> 'ageing_groups') is distinct from 'array'
           or exists (select 1 from pg_catalog.jsonb_array_elements(
               coalesce(p_document -> 'ageing_groups', '[]'::jsonb)) g
               where pg_catalog.jsonb_typeof(g) is distinct from 'object'
                  or pg_catalog.jsonb_typeof(g -> 'windows') is distinct from 'array')
           or pg_catalog.jsonb_typeof(p_document -> 'sources') is distinct from 'array' then
            raise exception using errcode = '22023', message = 'Unsafe or incomplete place exchange';
        end if;
    else
        raise exception using errcode = '22023', message = 'Unsupported profile exchange format';
    end if;
    v_dataset := p_document ->> 'dataset_version';
    if p_document ->> 'schema_version' is distinct from v_version
       or v_name is null or pg_catalog.length(pg_catalog.btrim(v_name)) not between 2 and 200
       or v_dataset is null or v_dataset !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
       or pg_catalog.length(v_dataset) > 40
       or pg_catalog.jsonb_typeof(p_document -> 'sources') is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_document -> 'sources') not between 1 and 300 then
        raise exception using errcode = '22023', message = 'Invalid profile identity, version or sources';
    end if;
    v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        p_document::text, 'UTF8'), 'sha256'), 'hex');
    insert into private.drinking_window_profile_exchanges (
        document_sha256, profile_kind, schema_version, dataset_version,
        profile_name, document, submitted_by
    ) values (v_hash, v_kind, v_version, v_dataset,
        pg_catalog.btrim(v_name), p_document, auth.uid())
    on conflict (document_sha256) do nothing returning id into v_id;
    v_inserted := found;
    if not v_inserted then
        select id into v_id from private.drinking_window_profile_exchanges
        where document_sha256 = v_hash;
    end if;
    return pg_catalog.jsonb_build_object('id', v_id, 'document_sha256', v_hash,
        'profile_kind', v_kind, 'profile_name', pg_catalog.btrim(v_name),
        'dataset_version', v_dataset, 'inserted', v_inserted, 'published', false);
end;
$$;
revoke all on function public.import_drinking_window_profile_exchange(jsonb)
from public, anon;
grant execute on function public.import_drinking_window_profile_exchange(jsonb)
to authenticated;

create function public.list_drinking_window_profile_exchanges()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'document_sha256', p.document_sha256,
        'profile_kind', p.profile_kind, 'profile_name', p.profile_name,
        'schema_version', p.schema_version, 'dataset_version', p.dataset_version,
        'release_count', case when p.profile_kind = 'producer'
            then pg_catalog.jsonb_array_length(p.document -> 'exact_release_calibrations')
            else (select coalesce(sum(pg_catalog.jsonb_array_length(g -> 'windows')), 0)
                  from pg_catalog.jsonb_array_elements(p.document -> 'ageing_groups') g) end,
        'submitted_at', p.submitted_at
    ) order by p.submitted_at desc, p.id) from private.drinking_window_profile_exchanges p), '[]'::jsonb);
end;
$$;
revoke all on function public.list_drinking_window_profile_exchanges()
from public, anon;
grant execute on function public.list_drinking_window_profile_exchanges()
to authenticated;

create function public.export_drinking_window_profile_exchange(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_document jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select document into v_document from private.drinking_window_profile_exchanges
    where id = p_id;
    if not found then
        raise exception using errcode = '22023', message = 'Profile exchange not found';
    end if;
    return v_document;
end;
$$;
revoke all on function public.export_drinking_window_profile_exchange(uuid)
from public, anon;
grant execute on function public.export_drinking_window_profile_exchange(uuid)
to authenticated;

-- An exchange is never itself an identity or an approval. Resolve every
-- proposed window against a unique canonical identity, and show the precise
-- would-change result before asking the curator to adopt any estimate.
create function public.preview_drinking_window_profile_exchange(
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
    if p_identity_map is null or pg_catalog.jsonb_typeof(p_identity_map) <> 'object' then
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
            select count(*), min(p.id::text)::uuid into v_count, v_region_id
            from public.enrichment_places p
            where p.place_type in ('region','subregion')
              and p.normalized_name = private.normalize_wine_reference_text(v_cuvee ->> 'region');
            if v_count <> 1 then
                v_region_id := null;
                v_reason := 'Region has no unique canonical identity';
            end if;
        end if;
        if v_reason is null then
            select count(*), min(p.id::text)::uuid into v_count, v_appellation_id
            from public.enrichment_places p
            where p.place_type = 'appellation'
              and p.normalized_name = private.normalize_wine_reference_text(v_cuvee ->> 'appellation')
              and private.drinking_window_place_contains(v_region_id, p.id);
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
revoke all on function public.preview_drinking_window_profile_exchange(uuid,uuid,jsonb)
from public, anon;
grant execute on function public.preview_drinking_window_profile_exchange(uuid,uuid,jsonb)
to authenticated;

create table private.drinking_window_profile_exchange_links (
    exchange_id uuid not null references private.drinking_window_profile_exchanges(id),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    reference_row_id uuid not null references public.drinking_window_reference_rows(id),
    source_key text not null,
    approved_by uuid not null references public.enrichment_curator_eligibilities(user_id),
    approved_at timestamptz not null default now(),
    primary key (exchange_id, version_id, source_key),
    unique (version_id, reference_row_id)
);
revoke all on private.drinking_window_profile_exchange_links
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_profile_exchange_links to service_role;
create trigger drinking_window_profile_exchange_links_immutable
before update or delete on private.drinking_window_profile_exchange_links
for each row execute function private.reject_drinking_window_shadow_update();

-- The curator signs off the whole preview in one transaction. Unmapped or
-- conflicting rows are returned as quarantine, never silently inserted.
-- Their proposals remain in the immutable exchange for later correction.
create function public.stage_drinking_window_profile_exchange(
    p_id uuid, p_version_id uuid, p_expected_preview_sha256 text,
    p_review_reason text, p_adopt_and_share boolean, p_identity_map jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_preview jsonb;
    v_item jsonb;
    v_row_id uuid;
    v_hash text;
    v_urls text[];
    v_staged integer := 0;
    v_quarantined integer := 0;
    v_unchanged integer := 0;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_adopt_and_share is distinct from true
       or length(pg_catalog.btrim(coalesce(p_review_reason,''))) not between 30 and 1000 then
        raise exception using errcode = '22023',
            message = 'Explicitly adopt the reviewed rows and explain your decision';
    end if;
    perform 1 from public.drinking_window_reference_versions
    where id = p_version_id and status = 'draft' for update;
    if not found then
        raise exception using errcode = '22023', message = 'Choose an unpublished working version';
    end if;
    v_preview := public.preview_drinking_window_profile_exchange(p_id,p_version_id,p_identity_map);
    if p_expected_preview_sha256 is distinct from v_preview ->> 'preview_sha256' then
        raise exception using errcode = '40001', message = 'Profile mapping or draft changed; refresh the preview';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_preview -> 'rows') loop
        if v_item ->> 'status' = 'quarantined' then
            v_quarantined := v_quarantined + 1;
            continue;
        elsif v_item ->> 'status' = 'unchanged' then
            v_unchanged := v_unchanged + 1;
            continue;
        end if;
        select pg_catalog.array_agg(value #>> '{}') into v_urls
        from pg_catalog.jsonb_array_elements(v_item -> 'source_urls');
        insert into public.drinking_window_reference_rows (
            version_id, scope, producer_id, product_id, release_id,
            appellation_id, region_id, wine_color, vintage_year, format_ml,
            all_at_scope, first_trial_year, best_start_year, best_end_year,
            rationale
        ) values (
            p_version_id, 'release', (v_item ->> 'producer_id')::uuid,
            (v_item ->> 'product_id')::uuid, (v_item ->> 'release_id')::uuid,
            (v_item ->> 'appellation_id')::uuid, (v_item ->> 'region_id')::uuid,
            v_item ->> 'color', (v_item ->> 'vintage')::integer,
            (v_item ->> 'format_ml')::integer, true,
            (v_item ->> 'first_trial_year')::integer,
            (v_item ->> 'best_start_year')::integer,
            (v_item ->> 'best_end_year')::integer,
            pg_catalog.btrim(v_item ->> 'rationale')
        ) returning id into v_row_id;
        v_hash := private.drinking_window_review_subject_hash(p_version_id,'row',v_row_id);
        perform public.attest_drinking_window_editorial_estimate(
            p_version_id,v_row_id,v_hash,
            pg_catalog.btrim(v_item ->> 'rationale'),v_urls,true);
        v_hash := private.drinking_window_review_subject_hash(p_version_id,'row',v_row_id);
        perform public.record_drinking_window_reference_review(
            p_version_id,'row',v_row_id,v_hash,'approve',p_review_reason);
        insert into private.drinking_window_profile_exchange_links (
            exchange_id,version_id,reference_row_id,source_key,approved_by
        ) values (p_id,p_version_id,v_row_id,v_item ->> 'key',auth.uid());
        v_staged := v_staged + 1;
    end loop;
    return pg_catalog.jsonb_build_object('staged',v_staged,
        'unchanged',v_unchanged,'quarantined',v_quarantined,
        'published',false,'version_id',p_version_id);
end;
$$;
revoke all on function public.stage_drinking_window_profile_exchange(
    uuid,uuid,text,text,boolean,jsonb) from public, anon;
grant execute on function public.stage_drinking_window_profile_exchange(
    uuid,uuid,text,text,boolean,jsonb) to authenticated;

create function private.drinking_window_profile_source_urls(
    p_document jsonb, p_source_ids jsonb
)
returns text[] language sql immutable set search_path = '' as $$
    select case when pg_catalog.jsonb_typeof(p_source_ids) = 'array'
        and pg_catalog.jsonb_array_length(p_source_ids) between 1 and 10
        and (select count(*) from pg_catalog.jsonb_array_elements_text(p_source_ids))
          = (select count(*) from pg_catalog.jsonb_array_elements_text(p_source_ids) requested
             join pg_catalog.jsonb_array_elements(p_document -> 'sources') source
               on source.value ->> 'id' = requested.value
             where source.value ->> 'url' ~ '^https://[^[:space:]]+$'
               and length(source.value ->> 'url') <= 1000)
        then (select pg_catalog.array_agg(source.value ->> 'url' order by requested.ordinality)
              from pg_catalog.jsonb_array_elements_text(p_source_ids) with ordinality requested
              join pg_catalog.jsonb_array_elements(p_document -> 'sources') source
                on source.value ->> 'id' = requested.value)
        else null end;
$$;
revoke all on function private.drinking_window_profile_source_urls(jsonb,jsonb)
from public, anon, authenticated, powersync_role;

create function public.preview_drinking_window_place_profile_exchange(
    p_id uuid, p_version_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_profile private.drinking_window_profile_exchanges%rowtype;
    v_region_id uuid;
    v_appellation_id uuid;
    v_place_id uuid;
    v_group jsonb;
    v_member jsonb;
    v_window jsonb;
    v_groups jsonb := '[]'::jsonb;
    v_members jsonb;
    v_windows jsonb;
    v_status text;
    v_reason text;
    v_member_reason text;
    v_count integer;
    v_group_id uuid;
    v_target_id uuid;
    v_member_place_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_urls text[];
    v_year integer;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select * into v_profile from private.drinking_window_profile_exchanges where id = p_id;
    if not found or v_profile.profile_kind not in ('appellation','region') then
        raise exception using errcode = '22023', message = 'Choose an imported place profile';
    end if;
    if not exists (select 1 from public.drinking_window_reference_versions
        where id = p_version_id and status = 'draft') then
        raise exception using errcode = '22023', message = 'Choose an unpublished working version';
    end if;
    select count(*), min(p.id::text)::uuid into v_count, v_region_id
    from public.enrichment_places p
    where p.place_type in ('region','subregion')
      and p.normalized_name = private.normalize_wine_reference_text(
        case when v_profile.profile_kind = 'region'
          then v_profile.document #>> '{place,name}'
          else v_profile.document #>> '{place,region}' end);
    if v_count <> 1 then v_region_id := null; end if;
    if v_profile.profile_kind = 'appellation' and v_region_id is not null then
        select count(*), min(p.id::text)::uuid into v_count, v_appellation_id
        from public.enrichment_places p
        where p.place_type = 'appellation'
          and p.normalized_name = private.normalize_wine_reference_text(
            v_profile.document #>> '{place,name}')
          and private.drinking_window_place_contains(v_region_id,p.id);
        if v_count <> 1 then v_appellation_id := null; end if;
    end if;
    v_place_id := coalesce(v_appellation_id,v_region_id);
    for v_group in select value from pg_catalog.jsonb_array_elements(
        v_profile.document -> 'ageing_groups') loop
        v_status := 'ready'; v_reason := null; v_group_id := null;
        v_members := '[]'::jsonb; v_windows := '[]'::jsonb;
        if v_region_id is null then
            v_reason := 'Region has no unique canonical identity';
        elsif v_profile.profile_kind = 'appellation' and v_appellation_id is null then
            v_reason := 'Appellation has no unique canonical identity in this region';
        elsif length(pg_catalog.btrim(coalesce(v_group ->> 'definition',''))) not between 30 and 2000
           or v_group ->> 'color' not in ('red','white','rose','sparkling','sweet','fortified','other')
           or length(pg_catalog.btrim(coalesce(v_group ->> 'name',''))) not between 2 and 80 then
            v_reason := 'Group definition, name or color needs correction';
        end if;
        if v_reason is null then
            select count(*), min(g.id::text)::uuid into v_count, v_group_id
            from public.drinking_window_ageing_groups g
            where g.version_id = p_version_id
              and g.scope = v_profile.profile_kind
              and g.region_id = v_region_id
              and g.appellation_id is not distinct from v_appellation_id
              and g.wine_color = v_group ->> 'color'
              and g.group_key = v_group ->> 'name';
            if v_count > 0 then
                if exists (select 1 from private.drinking_window_profile_group_links l
                    where l.exchange_id = p_id and l.version_id = p_version_id
                      and l.group_key = v_group ->> 'id' and l.group_id = v_group_id) then
                    v_status := 'unchanged';
                else
                    v_reason := 'A group with this key already exists in the draft';
                end if;
            end if;
        end if;
        for v_member in select value from pg_catalog.jsonb_array_elements(
            coalesce(v_group -> 'members','[]'::jsonb)) loop
            v_member_reason := null; v_target_id := null; v_member_place_id := v_place_id;
            if v_member ? 'appellation' then
                select count(*), min(p.id::text)::uuid into v_count, v_member_place_id
                from public.enrichment_places p
                where p.place_type = 'appellation'
                  and p.normalized_name = private.normalize_wine_reference_text(
                      v_member ->> 'appellation')
                  and v_place_id is not null
                  and private.drinking_window_place_contains(v_place_id,p.id);
                if v_count <> 1 then
                    v_member_place_id := null;
                    v_member_reason := 'Member appellation has no unique canonical identity';
                end if;
            end if;
            if v_member_reason is null then
                if v_member ->> 'kind' = 'place' then
                    select count(*), min(p.id::text)::uuid into v_count, v_target_id
                    from public.enrichment_places p
                    where p.normalized_name = private.normalize_wine_reference_text(
                        v_member ->> 'name')
                      and v_place_id is not null
                      and private.drinking_window_place_contains(v_place_id,p.id);
                    v_member_place_id := v_target_id;
                elsif v_member ->> 'kind' in ('product','release') then
                    select count(*), min(p.id::text)::uuid into v_count, v_producer_id
                    from public.wine_reference_producers p
                    where p.canonical_name is not null
                      and p.canonical_name <> ''
                      and private.normalize_wine_reference_text(p.canonical_name)
                        = private.normalize_wine_reference_text(v_member ->> 'producer');
                    if v_count = 1 then
                        select count(*), min(p.id::text)::uuid into v_count, v_product_id
                        from public.wine_reference_products p
                        where p.producer_id = v_producer_id
                          and private.normalize_wine_reference_text(p.canonical_name)
                            = private.normalize_wine_reference_text(v_member ->> 'name');
                    else
                        v_count := 0;
                    end if;
                    if v_count = 1 then
                        if v_member ->> 'kind' = 'product' then
                            v_target_id := v_product_id;
                        elsif coalesce(v_member ->> 'vintage','') ~ '^[0-9]{4}$' then
                            v_year := (v_member ->> 'vintage')::integer;
                            select count(*), min(r.id::text)::uuid into v_count, v_target_id
                            from public.wine_reference_releases r
                            where r.product_id = v_product_id and r.vintage_year = v_year;
                        else
                            v_count := 0;
                        end if;
                    end if;
                else
                    v_count := 0;
                end if;
                if v_count <> 1 or v_target_id is null then
                    v_member_reason := 'Member has no unique canonical identity';
                end if;
            end if;
            v_urls := private.drinking_window_profile_source_urls(
                v_profile.document,v_member -> 'source_ids');
            if v_member_reason is null and (v_urls is null
                or length(pg_catalog.btrim(coalesce(v_member ->> 'rationale',''))) not between 30 and 1000
                or ((v_member ? 'first_vintage') <> (v_member ? 'last_vintage'))
                or (v_member ? 'first_vintage' and
                    (v_member ->> 'first_vintage')::integer > (v_member ->> 'last_vintage')::integer)) then
                v_member_reason := 'Member evidence, rationale or vintage range needs correction';
            end if;
            if v_member_reason is not null and v_reason is null then
                v_reason := v_member_reason;
            end if;
            v_members := v_members || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'kind',v_member ->> 'kind','name',v_member ->> 'name',
                'target_id',v_target_id,'place_id',v_member_place_id,
                'first_vintage',v_member ->> 'first_vintage',
                'last_vintage',v_member ->> 'last_vintage',
                'rationale',v_member ->> 'rationale','source_urls',v_urls,
                'reason',v_member_reason));
        end loop;
        for v_window in select value from pg_catalog.jsonb_array_elements(
            coalesce(v_group -> 'windows','[]'::jsonb)) loop
            v_urls := private.drinking_window_profile_source_urls(
                v_profile.document,v_window -> 'source_ids');
            if v_urls is null
               or coalesce(v_window ->> 'vintage','') !~ '^[0-9]{4}$'
               or coalesce(v_window ->> 'first_trial_year','') !~ '^[0-9]{4}$'
               or coalesce(v_window ->> 'best_start_year','') !~ '^[0-9]{4}$'
               or coalesce(v_window ->> 'best_end_year','') !~ '^[0-9]{4}$'
               or length(pg_catalog.btrim(coalesce(v_window ->> 'rationale',''))) not between 30 and 2000 then
                if v_reason is null then v_reason := 'Window or source context needs correction'; end if;
            elsif (v_window ->> 'vintage')::integer > (v_window ->> 'first_trial_year')::integer
               or (v_window ->> 'first_trial_year')::integer > (v_window ->> 'best_start_year')::integer
               or (v_window ->> 'best_start_year')::integer > (v_window ->> 'best_end_year')::integer
               or (v_window ->> 'best_end_year')::integer > 2300 then
                if v_reason is null then v_reason := 'Window years are not ordered'; end if;
            end if;
            v_windows := v_windows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'vintage',v_window ->> 'vintage',
                'first_trial_year',v_window ->> 'first_trial_year',
                'best_start_year',v_window ->> 'best_start_year',
                'best_end_year',v_window ->> 'best_end_year',
                'rationale',v_window ->> 'rationale','source_urls',v_urls));
        end loop;
        v_urls := private.drinking_window_profile_source_urls(
            v_profile.document,v_group -> 'source_ids');
        if v_reason is null and v_urls is null then
            v_reason := 'Group source context needs correction';
        end if;
        if v_reason is not null then v_status := 'quarantined'; end if;
        v_groups := v_groups || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'key',v_group ->> 'id','name',v_group ->> 'name',
            'color',v_group ->> 'color','definition',v_group ->> 'definition',
            'status',v_status,'reason',v_reason,'region_id',v_region_id,
            'appellation_id',v_appellation_id,'existing_group_id',v_group_id,
            'members',v_members,'windows',v_windows,'source_urls',v_urls));
    end loop;
    return pg_catalog.jsonb_build_object('profile_id',p_id,
        'profile_hash',v_profile.document_sha256,'version_id',p_version_id,
        'profile_kind',v_profile.profile_kind,'profile_name',v_profile.profile_name,
        'preview_sha256',pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(v_groups::text,'UTF8'),'sha256'),'hex'),
        'groups',v_groups);
end;
$$;
revoke all on function public.preview_drinking_window_place_profile_exchange(uuid,uuid)
from public, anon;
grant execute on function public.preview_drinking_window_place_profile_exchange(uuid,uuid)
to authenticated;

create table private.drinking_window_profile_group_links (
    exchange_id uuid not null references private.drinking_window_profile_exchanges(id),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    group_id uuid not null references public.drinking_window_ageing_groups(id),
    group_key text not null,
    approved_by uuid not null references public.enrichment_curator_eligibilities(user_id),
    approved_at timestamptz not null default now(),
    primary key (exchange_id, version_id, group_key),
    unique (version_id, group_id)
);
revoke all on private.drinking_window_profile_group_links
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_profile_group_links to service_role;
create trigger drinking_window_profile_group_links_immutable
before update or delete on private.drinking_window_profile_group_links
for each row execute function private.reject_drinking_window_shadow_update();

create function public.stage_drinking_window_place_profile_exchange(
    p_id uuid, p_version_id uuid, p_expected_preview_sha256 text,
    p_review_reason text, p_adopt_and_share boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_preview jsonb;
    v_profile private.drinking_window_profile_exchanges%rowtype;
    v_group jsonb;
    v_member jsonb;
    v_window jsonb;
    v_group_id uuid;
    v_member_id uuid;
    v_row_id uuid;
    v_hash text;
    v_urls text[];
    v_staged integer := 0;
    v_quarantined integer := 0;
    v_unchanged integer := 0;
    v_rows integer := 0;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_adopt_and_share is distinct from true
       or length(pg_catalog.btrim(coalesce(p_review_reason,''))) not between 30 and 1000 then
        raise exception using errcode = '22023',
            message = 'Explicitly adopt the reviewed groups and explain your decision';
    end if;
    perform 1 from public.drinking_window_reference_versions
    where id = p_version_id and status = 'draft' for update;
    if not found then
        raise exception using errcode = '22023', message = 'Choose an unpublished working version';
    end if;
    select * into v_profile from private.drinking_window_profile_exchanges where id = p_id;
    v_preview := public.preview_drinking_window_place_profile_exchange(p_id,p_version_id);
    if p_expected_preview_sha256 is distinct from v_preview ->> 'preview_sha256' then
        raise exception using errcode = '40001', message = 'Profile mapping or draft changed; refresh the preview';
    end if;
    for v_group in select value from pg_catalog.jsonb_array_elements(v_preview -> 'groups') loop
        if v_group ->> 'status' = 'quarantined' then
            v_quarantined := v_quarantined + 1;
            continue;
        elsif v_group ->> 'status' = 'unchanged' then
            v_unchanged := v_unchanged + 1;
            continue;
        end if;
        v_group_id := public.create_drinking_window_ageing_group(
            p_version_id,v_profile.profile_kind,
            (v_group ->> 'region_id')::uuid,
            (v_group ->> 'appellation_id')::uuid,null,
            v_group ->> 'color',v_group ->> 'name',v_group ->> 'definition');
        select pg_catalog.array_agg(value #>> '{}') into v_urls
        from pg_catalog.jsonb_array_elements(v_group -> 'source_urls');
        v_hash := private.drinking_window_review_subject_hash(p_version_id,'group',v_group_id);
        perform public.attest_drinking_window_editorial_context(
            p_version_id,'group',v_group_id,v_hash,
            v_group ->> 'definition',v_urls,true);
        v_hash := private.drinking_window_review_subject_hash(p_version_id,'group',v_group_id);
        perform public.record_drinking_window_reference_review(
            p_version_id,'group',v_group_id,v_hash,'approve',p_review_reason);
        for v_member in select value from pg_catalog.jsonb_array_elements(v_group -> 'members') loop
            v_member_id := public.add_drinking_window_group_membership(
                v_group_id,v_member ->> 'kind',(v_member ->> 'target_id')::uuid,
                (v_member ->> 'place_id')::uuid,
                nullif(v_member ->> 'first_vintage','')::integer,
                nullif(v_member ->> 'last_vintage','')::integer,
                v_member ->> 'rationale');
            select pg_catalog.array_agg(value #>> '{}') into v_urls
            from pg_catalog.jsonb_array_elements(v_member -> 'source_urls');
            v_hash := private.drinking_window_review_subject_hash(
                p_version_id,'membership',v_member_id);
            perform public.attest_drinking_window_editorial_context(
                p_version_id,'membership',v_member_id,v_hash,
                v_member ->> 'rationale',v_urls,true);
            v_hash := private.drinking_window_review_subject_hash(
                p_version_id,'membership',v_member_id);
            perform public.record_drinking_window_reference_review(
                p_version_id,'membership',v_member_id,v_hash,'approve',p_review_reason);
        end loop;
        for v_window in select value from pg_catalog.jsonb_array_elements(v_group -> 'windows') loop
            v_row_id := public.add_drinking_window_group_year(
                v_group_id,(v_window ->> 'vintage')::integer,
                (v_window ->> 'first_trial_year')::integer,
                (v_window ->> 'best_start_year')::integer,
                (v_window ->> 'best_end_year')::integer,
                v_window ->> 'rationale');
            select pg_catalog.array_agg(value #>> '{}') into v_urls
            from pg_catalog.jsonb_array_elements(v_window -> 'source_urls');
            v_hash := private.drinking_window_review_subject_hash(p_version_id,'row',v_row_id);
            perform public.attest_drinking_window_editorial_estimate(
                p_version_id,v_row_id,v_hash,v_window ->> 'rationale',v_urls,true);
            v_hash := private.drinking_window_review_subject_hash(p_version_id,'row',v_row_id);
            perform public.record_drinking_window_reference_review(
                p_version_id,'row',v_row_id,v_hash,'approve',p_review_reason);
            insert into private.drinking_window_profile_exchange_links (
                exchange_id,version_id,reference_row_id,source_key,approved_by
            ) values (p_id,p_version_id,v_row_id,
                (v_group ->> 'key') || ':' || (v_window ->> 'vintage'),auth.uid());
            v_rows := v_rows + 1;
        end loop;
        insert into private.drinking_window_profile_group_links (
            exchange_id,version_id,group_id,group_key,approved_by
        ) values (p_id,p_version_id,v_group_id,v_group ->> 'key',auth.uid());
        v_staged := v_staged + 1;
    end loop;
    return pg_catalog.jsonb_build_object('staged_groups',v_staged,
        'staged_windows',v_rows,'unchanged_groups',v_unchanged,
        'quarantined_groups',v_quarantined,'published',false,
        'version_id',p_version_id);
end;
$$;
revoke all on function public.stage_drinking_window_place_profile_exchange(
    uuid,uuid,text,text,boolean) from public, anon;
grant execute on function public.stage_drinking_window_place_profile_exchange(
    uuid,uuid,text,text,boolean) to authenticated;

commit;
