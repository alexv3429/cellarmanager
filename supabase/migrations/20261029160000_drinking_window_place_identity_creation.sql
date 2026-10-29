begin;

-- The incoming research files cover places not yet in the sparse shared
-- identity graph. A reviewer may add only regions and their appellations;
-- this does not create a window, alias, membership or household link.
create table private.drinking_window_place_creations (
    id bigint generated always as identity primary key,
    place_id uuid not null unique references public.enrichment_places(id),
    place_type text not null check (place_type in ('region','appellation')),
    parent_region_id uuid references public.enrichment_places(id),
    country_code text not null check (country_code ~ '^[A-Z]{2}$'),
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    identity_reason text not null check (length(pg_catalog.btrim(identity_reason)) between 20 and 1000),
    created_at timestamptz not null default now()
);
revoke all on private.drinking_window_place_creations
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_place_creations to service_role;
create trigger drinking_window_place_creations_immutable
before update or delete on private.drinking_window_place_creations
for each row execute function private.reject_drinking_window_shadow_update();

create function public.create_drinking_window_curation_place(
    p_place_type text, p_parent_region_id uuid,
    p_canonical_name text, p_country_code text,
    p_identity_reason text, p_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_name text := pg_catalog.btrim(coalesce(p_canonical_name,''));
    v_country text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_country_code,'')));
    v_parent public.enrichment_places%rowtype;
    v_id uuid := pg_catalog.gen_random_uuid();
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_place_type not in ('region','appellation')
       or length(v_name) not between 2 and 200
       or v_country !~ '^[A-Z]{2}$'
       or p_confirmed is distinct from true
       or length(pg_catalog.btrim(coalesce(p_identity_reason,''))) not between 20 and 1000
       or (p_place_type = 'region' and p_parent_region_id is not null)
       or (p_place_type = 'appellation' and p_parent_region_id is null) then
        raise exception using errcode = '22023',
            message = 'Confirm the place, its country and exact parent region';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(927412, 4);
    if p_place_type = 'appellation' then
        select * into v_parent from public.enrichment_places
        where id = p_parent_region_id and place_type in ('region','subregion');
        if not found or (v_parent.country_code is not null
            and v_parent.country_code <> v_country) then
            raise exception using errcode = '22023',
                message = 'Choose an existing parent region in the same country';
        end if;
    end if;
    -- Wine labels currently resolve place names without parent context. A
    -- duplicate canonical name anywhere at this type would be ambiguous.
    if exists (select 1 from public.enrichment_places p
        where ((p_place_type = 'region' and p.place_type in ('region','subregion'))
            or (p_place_type = 'appellation' and p.place_type = 'appellation'))
          and p.normalized_name = private.normalize_wine_reference_text(v_name)) then
        raise exception using errcode = '23505',
            message = 'This place name already exists; select it instead';
    end if;
    insert into public.enrichment_places(
        id,parent_id,place_type,canonical_name,country_code
    ) values (
        v_id,p_parent_region_id,p_place_type,v_name,v_country
    );
    insert into private.drinking_window_place_creations(
        place_id,place_type,parent_region_id,country_code,curator_id,identity_reason
    ) values (
        v_id,p_place_type,p_parent_region_id,v_country,auth.uid(),
        pg_catalog.btrim(p_identity_reason)
    );
    return pg_catalog.jsonb_build_object(
        'id',v_id,'place_type',p_place_type,'canonical_name',v_name,
        'parent_region_id',p_parent_region_id,'country_code',v_country);
end;
$$;
revoke all on function public.create_drinking_window_curation_place(
    text,uuid,text,text,text,boolean) from public, anon;
grant execute on function public.create_drinking_window_curation_place(
    text,uuid,text,text,text,boolean) to authenticated;

commit;
