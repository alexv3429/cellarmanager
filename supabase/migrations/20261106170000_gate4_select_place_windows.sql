begin;

-- Preserve the original whole-group preview and its fingerprint, while
-- exposing whether each vintage is already linked to this exact profile.
create function public.preview_selectable_drinking_window_place_profile(p_id uuid, p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_preview jsonb;
    v_groups jsonb := '[]'::jsonb;
    v_group jsonb;
    v_window jsonb;
    v_windows jsonb;
    v_status text;
    v_key text;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    v_preview := public.preview_drinking_window_place_profile_exchange(p_id,p_version_id);
    for v_group in select value from pg_catalog.jsonb_array_elements(v_preview -> 'groups') loop
        v_windows := '[]'::jsonb;
        for v_window in select value from pg_catalog.jsonb_array_elements(v_group -> 'windows') loop
            v_key := (v_group ->> 'key') || ':' || (v_window ->> 'vintage');
            v_status := case
              when v_group ->> 'status' = 'quarantined' then 'quarantined'
              when exists (select 1 from private.drinking_window_profile_exchange_links l
                  where l.exchange_id=p_id and l.version_id=p_version_id and l.source_key=v_key)
                then 'unchanged'
              when v_group ->> 'existing_group_id' is not null and exists (
                  select 1 from public.drinking_window_reference_rows r
                  where r.version_id=p_version_id and r.ageing_group_id=(v_group ->> 'existing_group_id')::uuid
                    and r.vintage_year=(v_window ->> 'vintage')::integer)
                then 'quarantined'
              else 'ready' end;
            v_windows := v_windows || pg_catalog.jsonb_build_array(
              v_window || pg_catalog.jsonb_build_object('selection_status',v_status));
        end loop;
        v_groups := v_groups || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_set(v_group,'{windows}',v_windows));
    end loop;
    return pg_catalog.jsonb_set(v_preview,'{groups}',v_groups);
end;
$$;
revoke all on function public.preview_selectable_drinking_window_place_profile(uuid,uuid) from public, anon;
grant execute on function public.preview_selectable_drinking_window_place_profile(uuid,uuid) to authenticated;

create function public.stage_selected_drinking_window_place_profile(
    p_id uuid, p_version_id uuid, p_expected_preview_sha256 text,
    p_review_reason text, p_adopt_and_share boolean, p_selected_keys text[]
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
    v_selected_count integer;
    v_staged integer := 0;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_adopt_and_share is distinct from true
       or length(pg_catalog.btrim(coalesce(p_review_reason,''))) not between 30 and 1000 then
        raise exception using errcode='22023', message='Explicitly adopt the reviewed rows and explain your decision';
    end if;
    if p_selected_keys is null or pg_catalog.cardinality(p_selected_keys) not between 1 and 500
       or array_position(p_selected_keys,null) is not null
       or (select count(distinct k) from pg_catalog.unnest(p_selected_keys) k) <> pg_catalog.cardinality(p_selected_keys) then
        raise exception using errcode='22023', message='Choose distinct rows to review';
    end if;
    perform 1 from public.drinking_window_reference_versions where id=p_version_id and status='draft' for update;
    if not found then raise exception using errcode='22023', message='Choose an unpublished working version'; end if;
    select * into v_profile from private.drinking_window_profile_exchanges where id=p_id;
    v_preview := public.preview_selectable_drinking_window_place_profile(p_id,p_version_id);
    if p_expected_preview_sha256 is distinct from v_preview ->> 'preview_sha256' then
        raise exception using errcode='40001', message='Profile mapping or draft changed; refresh the preview';
    end if;
    select count(*) into v_selected_count
    from pg_catalog.jsonb_array_elements(v_preview -> 'groups') g
    cross join lateral pg_catalog.jsonb_array_elements(g -> 'windows') w
    where (g ->> 'key') || ':' || (w ->> 'vintage') = any(p_selected_keys)
      and w ->> 'selection_status'='ready';
    if v_selected_count <> pg_catalog.cardinality(p_selected_keys)
       or exists (select 1 from pg_catalog.jsonb_array_elements(v_preview -> 'groups') g
          cross join lateral pg_catalog.jsonb_array_elements(g -> 'windows') w
          where (g ->> 'key') || ':' || (w ->> 'vintage') = any(p_selected_keys)
          group by (g ->> 'key'),(w ->> 'vintage') having count(*) <> 1) then
        raise exception using errcode='22023', message='Selected rows must each be uniquely ready';
    end if;
    for v_group in select value from pg_catalog.jsonb_array_elements(v_preview -> 'groups') loop
        if not exists (select 1 from pg_catalog.jsonb_array_elements(v_group -> 'windows') w
          where (v_group ->> 'key') || ':' || (w ->> 'vintage') = any(p_selected_keys)) then continue; end if;
        if v_group ->> 'status'='ready' then
            v_group_id := public.create_drinking_window_ageing_group(p_version_id,v_profile.profile_kind,
              (v_group ->> 'region_id')::uuid,(v_group ->> 'appellation_id')::uuid,null,
              v_group ->> 'color',v_group ->> 'name',v_group ->> 'definition');
            select pg_catalog.array_agg(value #>> '{}') into v_urls
              from pg_catalog.jsonb_array_elements(v_group -> 'source_urls');
            v_hash := private.drinking_window_review_subject_hash(p_version_id,'group',v_group_id);
            perform public.attest_drinking_window_editorial_context(p_version_id,'group',v_group_id,v_hash,
              v_group ->> 'definition',v_urls,true);
            v_hash := private.drinking_window_review_subject_hash(p_version_id,'group',v_group_id);
            perform public.record_drinking_window_reference_review(p_version_id,'group',v_group_id,v_hash,'approve',p_review_reason);
            for v_member in select value from pg_catalog.jsonb_array_elements(v_group -> 'members') loop
                v_member_id := public.add_drinking_window_group_membership(v_group_id,v_member ->> 'kind',
                  (v_member ->> 'target_id')::uuid,(v_member ->> 'place_id')::uuid,
                  nullif(v_member ->> 'first_vintage','')::integer,nullif(v_member ->> 'last_vintage','')::integer,
                  v_member ->> 'rationale');
                select pg_catalog.array_agg(value #>> '{}') into v_urls
                  from pg_catalog.jsonb_array_elements(v_member -> 'source_urls');
                v_hash := private.drinking_window_review_subject_hash(p_version_id,'membership',v_member_id);
                perform public.attest_drinking_window_editorial_context(p_version_id,'membership',v_member_id,v_hash,
                  v_member ->> 'rationale',v_urls,true);
                v_hash := private.drinking_window_review_subject_hash(p_version_id,'membership',v_member_id);
                perform public.record_drinking_window_reference_review(p_version_id,'membership',v_member_id,v_hash,'approve',p_review_reason);
            end loop;
            insert into private.drinking_window_profile_group_links(exchange_id,version_id,group_id,group_key,approved_by)
              values (p_id,p_version_id,v_group_id,v_group ->> 'key',auth.uid());
        else
            v_group_id := (v_group ->> 'existing_group_id')::uuid;
            -- Never attach new dates if the reviewed group's definition or
            -- exact membership was edited since this profile created it.
            -- The authoring functions take the same group lock before changing
            -- membership, so the check stays true until the rows are staged.
            perform 1 from public.drinking_window_ageing_groups g where g.id=v_group_id for update;
            if not exists (select 1 from public.drinking_window_ageing_groups g
                where g.id=v_group_id and g.version_id=p_version_id and g.scope=v_profile.profile_kind
                  and g.region_id=(v_group ->> 'region_id')::uuid
                  and g.appellation_id is not distinct from (v_group ->> 'appellation_id')::uuid
                  and g.wine_color=v_group ->> 'color' and g.group_key=pg_catalog.btrim(v_group ->> 'name')
                  and g.definition=pg_catalog.btrim(v_group ->> 'definition'))
               or (select count(*) from public.drinking_window_ageing_group_memberships m where m.group_id=v_group_id)
                  <> pg_catalog.jsonb_array_length(v_group -> 'members')
               or exists (select 1 from pg_catalog.jsonb_array_elements(v_group -> 'members') j
                  where not exists (select 1 from public.drinking_window_ageing_group_memberships m
                    where m.group_id=v_group_id and m.member_kind=j ->> 'kind'
                      and m.member_place_id is not distinct from (j ->> 'place_id')::uuid
                      and coalesce(m.member_product_id,m.member_release_id,m.member_place_id)=(j ->> 'target_id')::uuid
                      and m.first_vintage_year is not distinct from nullif(j ->> 'first_vintage','')::integer
                      and m.last_vintage_year is not distinct from nullif(j ->> 'last_vintage','')::integer
                      and m.rationale=pg_catalog.btrim(j ->> 'rationale'))) then
                raise exception using errcode='40001', message='Reviewed group changed; review its definition and members again';
            end if;
        end if;
        for v_window in select value from pg_catalog.jsonb_array_elements(v_group -> 'windows')
          where (v_group ->> 'key') || ':' || (value ->> 'vintage') = any(p_selected_keys) loop
            v_row_id := public.add_drinking_window_group_year(v_group_id,(v_window ->> 'vintage')::integer,
              (v_window ->> 'first_trial_year')::integer,(v_window ->> 'best_start_year')::integer,
              (v_window ->> 'best_end_year')::integer,v_window ->> 'rationale');
            select pg_catalog.array_agg(value #>> '{}') into v_urls
              from pg_catalog.jsonb_array_elements(v_window -> 'source_urls');
            v_hash := private.drinking_window_review_subject_hash(p_version_id,'row',v_row_id);
            perform public.attest_drinking_window_editorial_estimate(p_version_id,v_row_id,v_hash,
              v_window ->> 'rationale',v_urls,true);
            v_hash := private.drinking_window_review_subject_hash(p_version_id,'row',v_row_id);
            perform public.record_drinking_window_reference_review(p_version_id,'row',v_row_id,v_hash,'approve',p_review_reason);
            insert into private.drinking_window_profile_exchange_links(exchange_id,version_id,reference_row_id,source_key,approved_by)
              values (p_id,p_version_id,v_row_id,(v_group ->> 'key') || ':' || (v_window ->> 'vintage'),auth.uid());
            v_staged := v_staged + 1;
        end loop;
    end loop;
    return pg_catalog.jsonb_build_object('staged',v_staged,'unchanged',0,'quarantined',0,
      'published',false,'version_id',p_version_id);
end;
$$;
revoke all on function public.stage_selected_drinking_window_place_profile(uuid,uuid,text,text,boolean,text[]) from public, anon;
grant execute on function public.stage_selected_drinking_window_place_profile(uuid,uuid,text,text,boolean,text[]) to authenticated;
commit;
