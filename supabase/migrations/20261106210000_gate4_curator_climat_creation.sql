begin;

-- Geographic identities only: no cellar links, vintage dates or publication.
create table private.drinking_window_climat_creations (
    id bigint generated always as identity primary key,
    place_id uuid not null unique references public.enrichment_places(id),
    appellation_id uuid not null references public.enrichment_places(id),
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    source_url text not null check (source_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$'),
    identity_reason text not null check (length(pg_catalog.btrim(identity_reason)) between 20 and 1000),
    created_at timestamptz not null default now()
);
revoke all on private.drinking_window_climat_creations from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_climat_creations to service_role;
create trigger drinking_window_climat_creations_immutable
before update or delete on private.drinking_window_climat_creations
for each row execute function private.reject_drinking_window_shadow_update();

-- Use the same conservative name equivalence as automatic climat matching.
-- In particular, "Le Porusot" and "Porusot" remain separate names.
create function private.drinking_window_climat_name_key(p_name text, p_appellation_name text)
returns text language sql immutable set search_path = '' as $$
    with parts as (select private.normalize_wine_reference_text(p_name) as name,
      private.normalize_wine_reference_text(p_appellation_name) as appellation)
    select pg_catalog.regexp_replace(case when pg_catalog.left(name,pg_catalog.length(appellation)+1)=appellation || ' '
        then pg_catalog.substr(name,pg_catalog.length(appellation)+2) else name end,'^les ','') from parts;
$$;
revoke all on function private.drinking_window_climat_name_key(text,text)
from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.drinking_window_climat_name_key(text,text) to postgres;

create function public.list_drinking_window_curation_climates(p_appellation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if not exists (select 1 from public.enrichment_places where id=p_appellation_id and place_type='appellation') then
        raise exception using errcode='22023', message='Choose a shared appellation';
    end if;
    return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',p.id,'canonical_name',p.canonical_name) order by p.canonical_name,p.id)
        from public.enrichment_places p where p.place_type='climat'
          and private.drinking_window_place_contains(p_appellation_id,p.id)), '[]'::jsonb);
end;
$$;
revoke all on function public.list_drinking_window_curation_climates(uuid) from public, anon;
grant execute on function public.list_drinking_window_curation_climates(uuid) to authenticated;

create function public.create_drinking_window_curation_climates(
    p_appellation_id uuid, p_names text[], p_source_url text, p_identity_reason text, p_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_parent public.enrichment_places%rowtype;
    v_name text;
    v_id uuid;
    v_created jsonb := '[]'::jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_confirmed is distinct from true or p_names is null
       or pg_catalog.cardinality(p_names) not between 1 and 50
       or pg_catalog.array_position(p_names,null) is not null
       or pg_catalog.length(pg_catalog.btrim(coalesce(p_identity_reason,''))) not between 20 and 1000
       or pg_catalog.length(coalesce(p_source_url,'')) > 2000
       or coalesce(p_source_url,'') !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$' then
        raise exception using errcode='22023', message='Confirm the appellation, names, source and reason';
    end if;
    select * into v_parent from public.enrichment_places where id=p_appellation_id and place_type='appellation';
    if not found then raise exception using errcode='22023', message='Choose a shared appellation'; end if;
    if exists (select 1 from pg_catalog.unnest(p_names) n
        where length(pg_catalog.btrim(n)) not between 2 and 200
          or private.normalize_wine_reference_text(n)='')
       or (select count(distinct private.drinking_window_climat_name_key(n,v_parent.canonical_name))
           from pg_catalog.unnest(p_names) n)
          <> pg_catalog.cardinality(p_names) then
        raise exception using errcode='22023', message='Provide distinct valid climat names';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(927412, 5);
    if exists (select 1 from pg_catalog.unnest(p_names) n
        join public.enrichment_places p on p.place_type='climat'
          and private.drinking_window_place_contains(p_appellation_id,p.id)
          and private.drinking_window_climat_name_key(p.canonical_name,v_parent.canonical_name)
              =private.drinking_window_climat_name_key(n,v_parent.canonical_name))
       or exists (select 1 from pg_catalog.unnest(p_names) n
        join public.enrichment_place_aliases a on private.drinking_window_climat_name_key(a.alias_value,v_parent.canonical_name)
              =private.drinking_window_climat_name_key(n,v_parent.canonical_name)
        join public.enrichment_places p on p.id=a.place_id and p.place_type='climat'
          and private.drinking_window_place_contains(p_appellation_id,p.id)) then
        raise exception using errcode='23505', message='A climat with this name already exists in this appellation';
    end if;
    foreach v_name in array p_names loop
        v_id := pg_catalog.gen_random_uuid();
        insert into public.enrichment_places(id,parent_id,place_type,canonical_name,country_code)
        values (v_id,p_appellation_id,'climat',pg_catalog.btrim(v_name),v_parent.country_code);
        insert into private.drinking_window_climat_creations(place_id,appellation_id,curator_id,source_url,identity_reason)
        values (v_id,p_appellation_id,auth.uid(),pg_catalog.btrim(p_source_url),pg_catalog.btrim(p_identity_reason));
        v_created := v_created || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'id',v_id,'canonical_name',pg_catalog.btrim(v_name)));
    end loop;
    return pg_catalog.jsonb_build_object('created',v_created,'dates_created',0,'published',false);
end;
$$;
revoke all on function public.create_drinking_window_curation_climates(uuid,text[],text,text,boolean) from public, anon;
grant execute on function public.create_drinking_window_curation_climates(uuid,text[],text,text,boolean) to authenticated;
commit;
