begin;

-- Restore only mappings that were actually used by releases in a confirmed
-- identity batch. A later confirmed batch can replace or clear a mapping.
create function public.get_reviewed_profile_identity_mappings(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_document jsonb;
    v_result jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select e.document into v_document from private.drinking_window_profile_exchanges e
    where e.id=p_id and e.profile_kind='producer';
    if not found then
        raise exception using errcode='22023', message='Choose an imported producer profile';
    end if;
    with records as materialized (
        select batch.sequence_no,batch.identity_map,release_key,
            pg_catalog.split_part(release_key,'|',1) cuvee_key,
            c.value ->> 'region' region_key,c.value ->> 'appellation' appellation_key
        from private.drinking_window_profile_identity_batches batch
        cross join lateral pg_catalog.unnest(batch.selected_release_keys) release_key
        left join lateral (
            select value from pg_catalog.jsonb_array_elements(v_document -> 'cuvees')
            where value ->> 'id'=pg_catalog.split_part(release_key,'|',1) limit 1
        ) c on true
        where batch.exchange_id=p_id
    ), producer as (
        select identity_map ->> 'producer_id' target from records
        order by sequence_no desc limit 1
    ), cuvees as (
        select distinct on (cuvee_key) cuvee_key source,
            identity_map #>> array['cuvees',cuvee_key] target
        from records where cuvee_key <> '' order by cuvee_key,sequence_no desc
    ), regions as (
        select distinct on (region_key) region_key source,
            identity_map #>> array['regions',region_key] target
        from records where coalesce(region_key,'') <> '' order by region_key,sequence_no desc
    ), appellations as (
        select distinct on (appellation_key) appellation_key source,
            identity_map #>> array['appellations',appellation_key] target
        from records where coalesce(appellation_key,'') <> '' order by appellation_key,sequence_no desc
    )
    select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'producer_id',(select target from producer),
        'cuvees',(select pg_catalog.jsonb_object_agg(source,target) filter (where target is not null) from cuvees),
        'regions',(select pg_catalog.jsonb_object_agg(source,target) filter (where target is not null) from regions),
        'appellations',(select pg_catalog.jsonb_object_agg(source,target) filter (where target is not null) from appellations),
        'release_appellations',nullif(public.get_reviewed_profile_release_appellations(p_id),'{}'::jsonb)
    )) into v_result;
    return v_result;
end;
$$;
revoke all on function public.get_reviewed_profile_identity_mappings(uuid) from public, anon;
grant execute on function public.get_reviewed_profile_identity_mappings(uuid) to authenticated;

commit;
