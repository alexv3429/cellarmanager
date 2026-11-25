begin;

-- The LWIN snapshot spells this producer "de Bernardins" for Hommage, while
-- the winery itself uses "Domaine des Bernardins". Keep its stable shared ID
-- (and all cellar/product links) and retain the LWIN spelling only as a
-- documented source alias. This correction does not approve any dates.
-- Sources:
-- https://www.domaine-des-bernardins.com/les-bernardins/
-- https://boutique.domaine-des-bernardins.com/products/muscat-de-beaumes-de-venise-hommage-50cl
do $$
declare
    v_legacy_id uuid;
    v_legacy_count integer;
    v_official_count integer;
begin
    select count(*), min(producer.id::text)::uuid
    into v_legacy_count, v_legacy_id
    from public.wine_reference_producers producer
    where producer.canonical_name = 'de Bernardins';

    -- Empty local/test databases do not contain this imported identity.
    if v_legacy_id is null then
        return;
    end if;
    if v_legacy_count <> 1 then
        raise exception using errcode = '21000',
            message = 'More than one legacy Bernardins shared identity requires review';
    end if;

    select count(*) into v_official_count
    from public.wine_reference_producers producer
    where producer.id <> v_legacy_id
      and private.normalize_wine_reference_text(producer.canonical_name)
        = private.normalize_wine_reference_text('Domaine des Bernardins');
    if v_official_count > 0 then
        raise exception using errcode = '21000',
            message = 'Domaine des Bernardins already has another shared identity';
    end if;
    if exists (
        select 1 from public.wine_reference_aliases alias
        where alias.entity_type = 'producer'
          and alias.entity_id <> v_legacy_id
          and alias.normalized_value = private.normalize_wine_reference_text('de Bernardins')
    ) then
        raise exception using errcode = '21000',
            message = 'The LWIN Bernardins spelling belongs to another shared identity';
    end if;

    update public.wine_reference_producers
    set canonical_name = 'Domaine des Bernardins'
    where id = v_legacy_id;

    insert into public.wine_reference_aliases(
        entity_id, entity_type, alias_value, normalized_value, source_name
    ) values (
        v_legacy_id, 'producer', 'de Bernardins',
        private.normalize_wine_reference_text('de Bernardins'),
        'liv-ex-lwin-legacy-spelling'
    ) on conflict do nothing;
end;
$$;

-- Curated shared aliases are valid inputs to the LWIN resolver, after exact
-- canonical-name lookup. Ambiguous aliases fail closed instead of making a
-- second producer or choosing an arbitrary ID.
create or replace function private.resolve_lwin_reference_producer(p_canonical_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text := pg_catalog.btrim(p_canonical_name);
    v_key text := private.normalize_wine_reference_text(p_canonical_name);
    v_count integer;
    v_producer_id uuid;
begin
    if length(v_name) not between 2 and 200 or v_key = '' then
        raise exception using errcode = '22023', message = 'LWIN producer name is invalid';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(927412, 3);
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('wine-reference-producer|' || v_key, 0)
    );
    select count(*), min(producer.id::text)::uuid
    into v_count, v_producer_id
    from public.wine_reference_producers producer
    where private.normalize_wine_reference_text(producer.canonical_name) = v_key;

    if v_count > 1 then
        raise exception using errcode = '21000',
            message = 'Shared producer identity is ambiguous; curator reconciliation is required';
    end if;
    if v_count = 1 then
        return v_producer_id;
    end if;

    select count(distinct alias.entity_id), min(alias.entity_id::text)::uuid
    into v_count, v_producer_id
    from public.wine_reference_aliases alias
    join public.wine_reference_producers producer on producer.id = alias.entity_id
    where alias.entity_type = 'producer'
      and alias.normalized_value = v_key;
    if v_count > 1 then
        raise exception using errcode = '21000',
            message = 'Shared producer alias is ambiguous; curator reconciliation is required';
    end if;
    if v_count = 1 then
        return v_producer_id;
    end if;

    v_producer_id := pg_catalog.gen_random_uuid();
    insert into public.wine_reference_entities(id, entity_type)
    values (v_producer_id, 'producer');
    insert into public.wine_reference_producers(id, canonical_name)
    values (v_producer_id, v_name);
    return v_producer_id;
end;
$$;

commit;
