begin;

-- Identical canonical names can belong to genuinely different producers.
-- This curator-only helper merges only explicitly reviewed identity IDs, never
-- every row sharing a name. Product/release/package identities remain stable.
create or replace function private.merge_verified_wine_reference_producers(
    p_primary_id uuid,
    p_duplicate_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text;
    v_count integer;
    v_fk record;
    v_has_reference boolean;
begin
    if p_primary_id is null or coalesce(pg_catalog.cardinality(p_duplicate_ids), 0) = 0
       or p_primary_id = any(p_duplicate_ids)
       or exists (
           select 1 from pg_catalog.unnest(p_duplicate_ids) as duplicate(id)
           where duplicate.id is null
       )
       or (select count(distinct duplicate.id)
           from pg_catalog.unnest(p_duplicate_ids) as duplicate(id))
          <> pg_catalog.cardinality(p_duplicate_ids) then
        raise exception 'Specify one primary producer and distinct duplicate IDs';
    end if;

    -- Parent-row locks prevent new FK references while dependency checks and
    -- reparenting run inside this transaction.
    perform 1 from public.wine_reference_entities entity
    where entity.id = p_primary_id or entity.id = any(p_duplicate_ids)
    for update;
    perform 1 from public.wine_reference_producers producer
    where producer.id = p_primary_id or producer.id = any(p_duplicate_ids)
    for update;

    select producer.canonical_name into v_name
    from public.wine_reference_producers producer
    where producer.id = p_primary_id;
    if v_name is null then
        raise exception 'Primary producer identity is missing';
    end if;
    select count(*) into v_count
    from public.wine_reference_producers producer
    where producer.id = any(p_duplicate_ids)
      and private.normalize_wine_reference_text(producer.canonical_name)
          = private.normalize_wine_reference_text(v_name);
    if v_count <> pg_catalog.cardinality(p_duplicate_ids) then
        raise exception 'Duplicate producer identities are missing or have different names';
    end if;

    -- Never cascade-delete aliases, evidence, windows, decisions or future
    -- dependencies. Products and household name preferences are the only
    -- references whose meaning is preserved by moving to the primary ID.
    for v_fk in
        select namespace.nspname, relation.relname, attribute.attname
        from pg_catalog.pg_constraint constraint_row
        join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
        join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = relation.oid
         and attribute.attnum = constraint_row.conkey[1]
        where constraint_row.contype = 'f'
          and constraint_row.confrelid in (
              'public.wine_reference_entities'::pg_catalog.regclass,
              'public.wine_reference_producers'::pg_catalog.regclass
          )
          and not (
              constraint_row.conrelid = 'public.wine_reference_producers'::pg_catalog.regclass
              and attribute.attname = 'id'
          )
          and not (
              constraint_row.conrelid = 'public.wine_reference_products'::pg_catalog.regclass
              and attribute.attname = 'producer_id'
          )
          and not (
              constraint_row.conrelid = 'public.wine_reference_household_producer_preferences'::pg_catalog.regclass
              and attribute.attname = 'producer_id'
          )
    loop
        execute pg_catalog.format(
            'select exists(select 1 from %I.%I where %I = any($1))',
            v_fk.nspname, v_fk.relname, v_fk.attname
        ) into v_has_reference using p_duplicate_ids;
        if v_has_reference then
            raise exception 'Producer merge needs separate review of dependency %.%',
                v_fk.nspname, v_fk.relname;
        end if;
    end loop;

    update public.wine_reference_products product
    set producer_id = p_primary_id
    where product.producer_id = any(p_duplicate_ids);
    update public.wine_reference_household_producer_preferences preference
    set producer_id = p_primary_id
    where preference.producer_id = any(p_duplicate_ids);

    delete from public.wine_reference_producers producer
    where producer.id = any(p_duplicate_ids);
    delete from public.wine_reference_entities entity
    where entity.id = any(p_duplicate_ids);
end;
$$;

revoke all on function private.merge_verified_wine_reference_producers(uuid, uuid[])
from public, anon, authenticated;

do $$
declare
    v_count integer;
begin
    select count(*) into v_count
    from public.wine_reference_producers producer
    where private.normalize_wine_reference_text(producer.canonical_name) = 'alvina pernot';

    -- Fresh CI databases have no such producer; a replayed database has one.
    -- Any changed live state must be re-audited instead of guessed at.
    if v_count = 0 then
        return;
    end if;
    if v_count = 1 and exists (
        select 1 from public.wine_reference_producers
        where id = '236bccd8-88b1-4d76-95d6-db006aff75fb'
          and canonical_name = 'Alvina Pernot'
    ) then
        return;
    end if;
    if v_count <> 3 or exists (
        select 1 from public.wine_reference_producers producer
        where private.normalize_wine_reference_text(producer.canonical_name) = 'alvina pernot'
          and (producer.canonical_name <> 'Alvina Pernot' or producer.id not in (
              '236bccd8-88b1-4d76-95d6-db006aff75fb',
              '78ab5720-3808-45b5-8c8a-be418634651a',
              'a13aa7af-f990-4665-8034-ac30167db3b4'
          ))
    ) then
        raise exception 'Alvina Pernot identities changed; re-audit before merging';
    end if;

    perform private.merge_verified_wine_reference_producers(
        '236bccd8-88b1-4d76-95d6-db006aff75fb',
        array[
            '78ab5720-3808-45b5-8c8a-be418634651a'::uuid,
            'a13aa7af-f990-4665-8034-ac30167db3b4'::uuid
        ]
    );
end;
$$;

commit;
