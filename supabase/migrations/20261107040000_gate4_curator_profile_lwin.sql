begin;

-- A curator may reuse an LWIN product in a research profile without first
-- modifying a household wine. Keep the decision auditable and separate from
-- drinking-window approval or publication.
create table private.drinking_window_profile_lwin_reviews (
    id bigint generated always as identity primary key,
    exchange_id uuid not null references private.drinking_window_profile_exchanges(id),
    cuvee_id text not null,
    producer_id uuid not null references public.wine_reference_producers(id),
    product_id uuid not null references public.wine_reference_products(id),
    lwin7 text not null check (lwin7 ~ '^[0-9]{7}$'),
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    review_reason text not null check (length(pg_catalog.btrim(review_reason)) between 30 and 1000),
    created_at timestamptz not null default now()
);
revoke all on private.drinking_window_profile_lwin_reviews from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_profile_lwin_reviews to service_role;
create trigger drinking_window_profile_lwin_reviews_immutable
before update or delete on private.drinking_window_profile_lwin_reviews
for each row execute function private.reject_drinking_window_shadow_update();

-- Only exact producer names or previously reviewed shared producer aliases
-- qualify. A similar producer or a similarly named unrelated wine is not
-- silently promoted. The curator must check the returned wine details.
create function private.drinking_window_lwin_profile_producer_matches(
    p_producer_id uuid, p_lwin_producer text
) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
      select 1 from public.wine_reference_producers p where p.id=p_producer_id
        and private.normalize_wine_reference_text(p.canonical_name)
          = private.normalize_wine_reference_text(p_lwin_producer)
      union all
      select 1 from public.wine_reference_aliases a
      where a.entity_id=p_producer_id and a.entity_type='producer'
        and a.normalized_value=private.normalize_wine_reference_text(p_lwin_producer)
    );
$$;
revoke all on function private.drinking_window_lwin_profile_producer_matches(uuid,text)
from public, anon, authenticated, powersync_role, service_role;

create function private.drinking_window_lwin_profile_cuvee_matches(
    p_cuvee jsonb, p_entry public.wine_reference_lwin_entries
) returns boolean language sql stable security definer set search_path = '' as $$
    with names(name) as (
      select p_cuvee->>'name'
      union all
      select a.value from pg_catalog.jsonb_array_elements_text(
        case when pg_catalog.jsonb_typeof(p_cuvee->'aliases')='array'
               and case when pg_catalog.jsonb_typeof(p_cuvee->'name_history')='array'
                 then pg_catalog.jsonb_array_length(p_cuvee->'name_history')=0
                 else p_cuvee->'name_history' is null end
             then p_cuvee->'aliases' else '[]'::jsonb end) a
    ), source_names(name) as (
      select p_entry.wine_name union select p_entry.site union select p_entry.parcel
    )
    select exists (
      select 1 from names n cross join source_names s
      where private.drinking_window_profile_cuvee_name_keys(n.name,p_cuvee->>'appellation')
         && private.drinking_window_profile_cuvee_name_keys(s.name,p_cuvee->>'appellation')
    );
$$;
revoke all on function private.drinking_window_lwin_profile_cuvee_matches(jsonb,public.wine_reference_lwin_entries)
from public, anon, authenticated, powersync_role, service_role;

create function public.search_drinking_window_profile_lwin(
    p_profile_id uuid, p_cuvee_id text, p_producer_id uuid, p_query text
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_query text := private.normalize_wine_reference_text(p_query);
        v_cuvee jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if length(v_query) not between 3 and 120 or not exists (
        select 1 from private.drinking_window_profile_exchanges p
        cross join lateral pg_catalog.jsonb_array_elements(p.document->'cuvees') c
        where p.id=p_profile_id and p.profile_kind='producer' and c->>'id'=p_cuvee_id
    ) or not exists (select 1 from public.wine_reference_producers p where p.id=p_producer_id) then
        raise exception using errcode='22023', message='Choose a producer profile, cuvée, shared producer and search term';
    end if;
    select c.value into strict v_cuvee from private.drinking_window_profile_exchanges p
    cross join lateral pg_catalog.jsonb_array_elements(p.document->'cuvees') c
    where p.id=p_profile_id and c.value->>'id'=p_cuvee_id;
    return coalesce((with source_candidates as materialized (
      select e.* from public.wine_reference_lwin_entries e
      join public.wine_reference_lwin_snapshots snapshot on snapshot.id=e.snapshot_id
      where snapshot.source_key='liv-ex-lwin' and snapshot.import_status='active' and e.source_status='live'
        and length(pg_catalog.btrim(coalesce(e.display_name,'')))>0
        and e.producer_search in (
          select private.normalize_wine_reference_text(p.canonical_name)
          from public.wine_reference_producers p where p.id=p_producer_id
          union
          select a.normalized_value from public.wine_reference_aliases a
          where a.entity_id=p_producer_id and a.entity_type='producer'
        )
        and e.product_search like '%' || v_query || '%'
    )
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'lwin7',x.lwin7,'name',x.display_name,'producer',x.producer_name,
        'region',x.region,'appellation',x.sub_region,'site',x.site,'parcel',x.parcel,'color',x.colour,
        'classification',x.classification) order by x.display_name,x.lwin7)
      from (select e.* from source_candidates e
        where private.drinking_window_lwin_profile_cuvee_matches(v_cuvee,e)
        order by e.display_name,e.lwin7 limit 30) x), '[]'::jsonb);
end;
$$;
revoke all on function public.search_drinking_window_profile_lwin(uuid,text,uuid,text) from public, anon;
grant execute on function public.search_drinking_window_profile_lwin(uuid,text,uuid,text) to authenticated;

create function public.reuse_drinking_window_profile_lwin(
    p_profile_id uuid, p_cuvee_id text, p_producer_id uuid, p_lwin7 text,
    p_reason text, p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_entry public.wine_reference_lwin_entries%rowtype;
    v_cuvee jsonb;
    v_wine public.wines%rowtype;
    v_product_id uuid;
    v_producer_id uuid;
    v_existing_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_confirmed is distinct from true or coalesce(p_lwin7,'') !~ '^[0-9]{7}$'
       or length(pg_catalog.btrim(coalesce(p_reason,''))) not between 30 and 1000 then
        raise exception using errcode='22023', message='Confirm the LWIN wine and explain the identity decision';
    end if;
    select c.value into v_cuvee from private.drinking_window_profile_exchanges p
    cross join lateral pg_catalog.jsonb_array_elements(p.document->'cuvees') c
    where p.id=p_profile_id and p.profile_kind='producer' and c.value->>'id'=p_cuvee_id;
    if v_cuvee is null then raise exception using errcode='22023', message='Profile cuvée not found'; end if;
    select e.* into v_entry from public.wine_reference_lwin_entries e
    join public.wine_reference_lwin_snapshots s on s.id=e.snapshot_id
    where s.source_key='liv-ex-lwin' and s.import_status='active'
      and e.source_status='live' and e.lwin7=p_lwin7;
    if not found or not private.drinking_window_lwin_profile_producer_matches(p_producer_id,v_entry.producer_name) then
        raise exception using errcode='22023', message='LWIN producer does not match the reviewed shared producer';
    end if;
    if private.canonical_enrichment_wine_color(v_cuvee->>'color') is not null
       and private.canonical_enrichment_wine_color(v_entry.colour) is not null
       and private.canonical_enrichment_wine_color(v_cuvee->>'color')
           <> private.canonical_enrichment_wine_color(v_entry.colour) then
        raise exception using errcode='22023', message='LWIN color conflicts with the profile cuvée';
    end if;
    if not private.drinking_window_lwin_profile_cuvee_matches(v_cuvee,v_entry) then
        raise exception using errcode='22023', message='LWIN cuvée does not match the exact profile name or its reviewed aliases';
    end if;
    if nullif(pg_catalog.btrim(v_entry.sub_region),'') is not null
       and nullif(pg_catalog.btrim(v_cuvee->>'appellation'),'') is not null
       and pg_catalog.regexp_replace(private.normalize_wine_reference_text(v_cuvee->>'appellation'),
             ' (1c|1er cru|premier cru|grand cru|gc)$','')
          <> private.normalize_wine_reference_text(v_entry.sub_region) then
        raise exception using errcode='22023', message='LWIN appellation conflicts with the profile cuvée';
    end if;
    if private.normalize_wine_reference_text(coalesce(v_cuvee->>'appellation','')) ~ '(^| )(grand cru|gc)( |$)'
       and private.normalize_wine_reference_text(coalesce(v_entry.classification,'')) ~ '(^| )(premier cru|1er cru|1c)( |$)'
       or private.normalize_wine_reference_text(coalesce(v_cuvee->>'appellation','')) ~ '(^| )(premier cru|1er cru|1c)( |$)'
       and private.normalize_wine_reference_text(coalesce(v_entry.classification,'')) ~ '(^| )(grand cru|gc)( |$)' then
        raise exception using errcode='22023', message='LWIN classification conflicts with the profile cuvée';
    end if;
    -- Match the lock ordering used by promote_lwin_reference so a concurrent
    -- household confirmation or profile batch cannot create a duplicate.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('promote-lwin|' || p_lwin7, 0));
    perform pg_catalog.pg_advisory_xact_lock(927412,3);
    select i.entity_id into v_existing_id from public.wine_reference_external_identifiers i
    where i.authority='liv-ex' and i.identifier_scheme='LWIN7' and i.identifier_value=p_lwin7;
    if v_existing_id is null and exists (
      select 1 from public.wine_reference_products p where p.producer_id=p_producer_id
        and (private.normalize_wine_reference_text(p.canonical_name)
               = private.normalize_wine_reference_text(v_entry.display_name)
          or private.drinking_window_profile_cuvee_name_keys(p.canonical_name,v_cuvee->>'appellation')
             && private.drinking_window_profile_cuvee_name_keys(v_cuvee->>'name',v_cuvee->>'appellation'))
    ) then
      raise exception using errcode='23505', message='A matching shared cuvée already exists; reconcile it before importing LWIN';
    end if;
    v_wine.producer := v_entry.producer_name;
    v_wine.vintage := null;
    select promoted.product_id,promoted.producer_id into v_product_id,v_producer_id
    from private.promote_lwin_reference(v_wine,p_lwin7,false,auth.uid()) promoted;
    if v_producer_id is distinct from p_producer_id then
      raise exception using errcode='22023', message='LWIN belongs to a different shared producer';
    end if;
    insert into private.drinking_window_profile_lwin_reviews
      (exchange_id,cuvee_id,producer_id,product_id,lwin7,curator_id,review_reason)
    values (p_profile_id,p_cuvee_id,p_producer_id,v_product_id,p_lwin7,auth.uid(),pg_catalog.btrim(p_reason));
    return pg_catalog.jsonb_build_object('product_id',v_product_id,'lwin7',p_lwin7,
      'dates_staged',0,'wines_linked',0,'published',false);
end;
$$;
revoke all on function public.reuse_drinking_window_profile_lwin(uuid,text,uuid,text,text,boolean) from public, anon;
grant execute on function public.reuse_drinking_window_profile_lwin(uuid,text,uuid,text,text,boolean) to authenticated;

commit;
