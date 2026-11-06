begin;

-- Nine producer names in the owner's 23 audited JSON profiles are absent from
-- the predeployment common-identity snapshot. This initial-base bootstrap
-- makes their producer identities searchable. It does not adopt any JSON
-- dates, create cuvées/releases, add global aliases, or decide how a household
-- spells these producers. Names already present under another spelling must
-- be reconciled by a curator rather than duplicated.
do $$
declare
    v_name text;
    v_distinctive text;
    v_candidate_count integer;
    v_id uuid;
begin
    for v_name, v_distinctive in
        select proposed.name, proposed.distinctive
        from (values
            ('Bret Brothers', 'bret brothers'),
            ('Domaine Carrette', 'carrette'),
            ('Clos Marie', 'clos marie'),
            ('Mas de Daumas Gassac', 'daumas gassac'),
            ('Domaine Sainte-Barbe — Jean-Marie Chaland', 'chaland'),
            ('Domaine Jobard-Morey', 'jobard morey'),
            ('Domaine La Soufrandière', 'soufrandiere'),
            ('Domaine Maxime Cottenceau', 'cottenceau'),
            ('Domaine Nicolas Maillet', 'maillet')
        ) as proposed(name, distinctive)
    loop
        -- Fail closed on a similarly named existing producer, including a
        -- shorter canonical spelling. The migration remains idempotent when
        -- its own exact canonical name is already present.
        select count(*) into v_candidate_count
        from public.wine_reference_producers producer
        where private.normalize_wine_reference_text(producer.canonical_name)
            like '%' || v_distinctive || '%';

        if v_candidate_count > 1 then
            raise exception 'Several possible shared producers require reconciliation: %', v_name;
        elsif v_candidate_count = 1 then
            if not exists (
                select 1 from public.wine_reference_producers producer
                where private.normalize_wine_reference_text(producer.canonical_name)
                    = private.normalize_wine_reference_text(v_name)
            ) then
                raise exception 'An existing shared producer requires reconciliation: %', v_name;
            end if;
        else
            v_id := pg_catalog.gen_random_uuid();
            insert into public.wine_reference_entities(id, entity_type)
            values (v_id, 'producer');
            insert into public.wine_reference_producers(id, canonical_name)
            values (v_id, v_name);
        end if;
    end loop;
end;
$$;

commit;
