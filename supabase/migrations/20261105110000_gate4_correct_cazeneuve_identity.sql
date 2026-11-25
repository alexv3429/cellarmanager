begin;

-- The LWIN import left the producer as "de Cazeneuve". The owner's explicit
-- cellar choices for "Cazeneuve" and "Chateau de Cazeneuve" point to that
-- same shared ID. The owner-supplied final profile and the winery itself use
-- "Château de Cazeneuve". Retain the stable ID and the old spelling as a
-- source alias; do not relink a wine or approve any drinking-window date.
-- https://www.chateaucazeneuve.com/
-- https://www.pic-saint-loup.com/domaine/chateau-de-cazeneuve/
do $$
declare
    v_legacy_id uuid;
    v_legacy_count integer;
begin
    select count(*), min(producer.id::text)::uuid
    into v_legacy_count, v_legacy_id
    from public.wine_reference_producers producer
    where producer.canonical_name = 'de Cazeneuve';

    -- Empty local/test databases need no imported-identity correction.
    if v_legacy_id is null then
        return;
    end if;
    if v_legacy_count <> 1 then
        raise exception using errcode = '21000',
            message = 'More than one legacy Cazeneuve identity requires review';
    end if;

    if exists (
        select 1 from public.wine_reference_producers producer
        where producer.id <> v_legacy_id
          and private.normalize_wine_reference_text(producer.canonical_name)
            = private.normalize_wine_reference_text('Château de Cazeneuve')
    ) or exists (
        select 1 from public.wine_reference_aliases alias
        where alias.entity_type = 'producer'
          and alias.entity_id <> v_legacy_id
          and alias.normalized_value in (
              private.normalize_wine_reference_text('de Cazeneuve'),
              private.normalize_wine_reference_text('Château de Cazeneuve')
          )
    ) then
        raise exception using errcode = '21000',
            message = 'Cazeneuve shared identity or alias conflicts with another producer';
    end if;

    update public.wine_reference_producers
    set canonical_name = 'Château de Cazeneuve'
    where id = v_legacy_id;

    insert into public.wine_reference_aliases(
        entity_id, entity_type, alias_value, normalized_value, source_name
    ) values (
        v_legacy_id, 'producer', 'de Cazeneuve',
        private.normalize_wine_reference_text('de Cazeneuve'),
        'liv-ex-lwin-legacy-spelling'
    ) on conflict do nothing;
end;
$$;

commit;
