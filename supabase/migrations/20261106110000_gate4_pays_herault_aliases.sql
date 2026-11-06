begin;

-- The official IGP Pays d'Hérault was previously known as vin de pays de
-- l'Hérault. The shared graph already has its Languedoc appellation under
-- "IGP Herault". These are shared geographic spellings, not household names.
-- Source: https://extranet.inao.gouv.fr/fichier/IGPHeraultPNO2022.pdf
do $$
declare
    v_region_id uuid;
    v_place_id uuid;
    v_count integer;
    v_name text;
    v_existing_id uuid;
begin
    select count(*), min(p.id::text)::uuid into v_count,v_region_id
    from public.enrichment_places p
    where p.place_type='region' and p.normalized_name='languedoc';
    if v_count > 1 then
        raise exception 'Languedoc must resolve uniquely';
    elsif v_count = 0 then
        v_region_id := private.enrichment_seed_uuid('place:languedoc');
        insert into public.enrichment_places(id,place_type,canonical_name,country_code)
        values(v_region_id,'region','Languedoc','FR');
    end if;
    select count(*) into v_count from public.enrichment_places p
    where p.place_type='appellation' and p.normalized_name='igp herault';
    if v_count = 0 then
        insert into public.enrichment_places(id,parent_id,place_type,canonical_name,country_code)
        values(private.enrichment_seed_uuid('place:igp-herault'),v_region_id,
            'appellation','IGP Herault','FR');
    end if;
    select count(*), min(p.id::text)::uuid into v_count,v_place_id
    from public.enrichment_places p
    where p.place_type='appellation' and p.normalized_name='igp herault'
      and p.parent_id=v_region_id;
    if v_count <> 1 then
        raise exception 'IGP Herault must resolve uniquely under Languedoc';
    end if;
    foreach v_name in array array['IGP Pays d’Hérault','IGP Pays de l’Hérault'] loop
        select alias.place_id into v_existing_id from public.enrichment_place_aliases alias
        where alias.normalized_value=private.normalize_wine_reference_text(v_name);
        if found and v_existing_id <> v_place_id then
            raise exception 'IGP Pays d’Hérault alias conflicts with another place';
        end if;
        if not found then
            insert into public.enrichment_place_aliases(place_id,alias_value,locale)
            values(v_place_id,v_name,'fr');
        end if;
    end loop;
end;
$$;

commit;
