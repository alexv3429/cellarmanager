begin;

-- Let a curator adopt only the entries actually reviewed, without changing the
-- immutable imported profile or turning an identity match into date approval.
create function public.stage_selected_drinking_window_profile_exchange(
    p_id uuid, p_version_id uuid, p_expected_preview_sha256 text,
    p_review_reason text, p_adopt_and_share boolean, p_identity_map jsonb,
    p_selected_keys text[]
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_preview jsonb;
    v_item jsonb;
    v_row_id uuid;
    v_hash text;
    v_urls text[];
    v_staged integer := 0;
    v_selected_count integer;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_adopt_and_share is distinct from true
       or length(pg_catalog.btrim(coalesce(p_review_reason,''))) not between 30 and 1000 then
        raise exception using errcode = '22023',
            message = 'Explicitly adopt the reviewed rows and explain your decision';
    end if;
    if p_selected_keys is null or pg_catalog.cardinality(p_selected_keys) not between 1 and 300
       or array_position(p_selected_keys, null) is not null
       or (select count(distinct k) from pg_catalog.unnest(p_selected_keys) k)
          <> pg_catalog.cardinality(p_selected_keys) then
        raise exception using errcode = '22023', message = 'Choose distinct rows to review';
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
    select count(*) into v_selected_count
    from pg_catalog.jsonb_array_elements(v_preview -> 'rows') r
    where r ->> 'key' = any(p_selected_keys) and r ->> 'status' = 'ready';
    if v_selected_count <> pg_catalog.cardinality(p_selected_keys)
       or exists (select 1 from pg_catalog.jsonb_array_elements(v_preview -> 'rows') r
          where r ->> 'key' = any(p_selected_keys)
          group by r ->> 'key' having count(*) <> 1) then
        raise exception using errcode = '22023', message = 'Selected rows must each be uniquely ready';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_preview -> 'rows')
        where value ->> 'key' = any(p_selected_keys) loop
        select pg_catalog.array_agg(value #>> '{}') into v_urls
        from pg_catalog.jsonb_array_elements(v_item -> 'source_urls');
        insert into public.drinking_window_reference_rows (
            version_id, scope, producer_id, product_id, release_id,
            appellation_id, region_id, wine_color, vintage_year, format_ml,
            all_at_scope, first_trial_year, best_start_year, best_end_year, rationale
        ) values (
            p_version_id, 'release', (v_item ->> 'producer_id')::uuid,
            (v_item ->> 'product_id')::uuid, (v_item ->> 'release_id')::uuid,
            (v_item ->> 'appellation_id')::uuid, (v_item ->> 'region_id')::uuid,
            v_item ->> 'color', (v_item ->> 'vintage')::integer,
            (v_item ->> 'format_ml')::integer, true,
            (v_item ->> 'first_trial_year')::integer, (v_item ->> 'best_start_year')::integer,
            (v_item ->> 'best_end_year')::integer, pg_catalog.btrim(v_item ->> 'rationale')
        ) returning id into v_row_id;
        v_hash := private.drinking_window_review_subject_hash(p_version_id,'row',v_row_id);
        perform public.attest_drinking_window_editorial_estimate(
            p_version_id,v_row_id,v_hash,pg_catalog.btrim(v_item ->> 'rationale'),v_urls,true);
        v_hash := private.drinking_window_review_subject_hash(p_version_id,'row',v_row_id);
        perform public.record_drinking_window_reference_review(
            p_version_id,'row',v_row_id,v_hash,'approve',p_review_reason);
        insert into private.drinking_window_profile_exchange_links (
            exchange_id,version_id,reference_row_id,source_key,approved_by
        ) values (p_id,p_version_id,v_row_id,v_item ->> 'key',auth.uid());
        v_staged := v_staged + 1;
    end loop;
    return pg_catalog.jsonb_build_object('staged',v_staged,'unchanged',0,
        'quarantined',0,'published',false,'version_id',p_version_id);
end;
$$;
revoke all on function public.stage_selected_drinking_window_profile_exchange(
    uuid,uuid,text,text,boolean,jsonb,text[]) from public, anon;
grant execute on function public.stage_selected_drinking_window_profile_exchange(
    uuid,uuid,text,text,boolean,jsonb,text[]) to authenticated;

commit;
