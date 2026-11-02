begin;

-- LWIN is an external product identifier, not a second producer namespace.
-- The two owner-confirmed LWIN paths must resolve the same shared producer.
-- Exact-name homonyms stay blocked for explicit curator reconciliation.
create function private.resolve_lwin_reference_producer(p_canonical_name text)
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

    -- The curator profile batch uses this lock while previewing/creating its
    -- canonical producer. Serialize both paths before checking the name.
    perform pg_catalog.pg_advisory_xact_lock(927412, 3);
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('wine-reference-producer|' || v_key, 0)
    );
    select count(*), min(producer.id::text)::uuid
    into v_count, v_producer_id
    from public.wine_reference_producers producer
    where private.normalize_wine_reference_text(producer.canonical_name) = v_key;

    if v_count > 1 then
        raise exception using
            errcode = '21000',
            message = 'Shared producer identity is ambiguous; curator reconciliation is required';
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
revoke all on function private.resolve_lwin_reference_producer(text)
from public, anon, authenticated;

create or replace function private.promote_lwin_reference(
    p_wine public.wines,
    p_lwin7 text,
    p_remember_producer boolean,
    p_user_id uuid
)
returns table (
    reference_id uuid,
    reference_type text,
    product_id uuid,
    producer_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_entry public.wine_reference_lwin_entries%rowtype;
    v_product_id uuid;
    v_producer_id uuid;
    v_release_id uuid;
    v_package_id uuid;
    v_candidate_producer text;
    v_source_producer text := private.normalize_wine_reference_text(p_wine.producer);
    v_product_name text;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('promote-lwin|' || p_lwin7, 0)
    );

    select entry.* into v_entry
    from public.wine_reference_lwin_entries entry
    join public.wine_reference_lwin_snapshots snapshot on snapshot.id = entry.snapshot_id
    where snapshot.source_key = 'liv-ex-lwin'
      and snapshot.import_status = 'active'
      and entry.source_status = 'live'
      and entry.lwin7 = p_lwin7;
    if not found then
        raise exception using errcode = '22023',
            message = 'The selected LWIN is not in the active reference snapshot';
    end if;

    select identifier.entity_id into v_product_id
    from public.wine_reference_external_identifiers identifier
    where identifier.authority = 'liv-ex'
      and identifier.identifier_scheme = 'LWIN7'
      and identifier.identifier_value = p_lwin7;

    if found then
        select product.producer_id into v_producer_id
        from public.wine_reference_products product
        where product.id = v_product_id;
    else
        v_candidate_producer := nullif(pg_catalog.btrim(v_entry.producer_name), '');
        if v_candidate_producer is null then
            raise exception using errcode = '22023',
                message = 'LWIN producer name is missing; choose a reviewed shared identity';
        end if;
        v_producer_id := private.resolve_lwin_reference_producer(v_candidate_producer);
        v_product_id := pg_catalog.gen_random_uuid();
        v_product_name := coalesce(
            nullif(pg_catalog.btrim(v_entry.display_name), ''),
            nullif(pg_catalog.btrim(v_entry.wine_name), ''),
            'LWIN ' || p_lwin7
        );
        insert into public.wine_reference_entities(id, entity_type)
        values (v_product_id, 'product');
        insert into public.wine_reference_products(id, producer_id, canonical_name)
        values (v_product_id, v_producer_id, v_product_name);
        insert into public.wine_reference_external_identifiers(
            entity_id, entity_type, authority, identifier_scheme, identifier_value
        ) values (v_product_id, 'product', 'liv-ex', 'LWIN7', p_lwin7);
    end if;

    if p_remember_producer then
        insert into public.wine_reference_household_producer_preferences(
            household_id, source_producer_normalized, source_producer_text,
            producer_id, decided_by
        ) values (
            p_wine.household_id, v_source_producer, p_wine.producer,
            v_producer_id, p_user_id
        )
        on conflict (household_id, source_producer_normalized)
        do update set source_producer_text = excluded.source_producer_text,
            producer_id = excluded.producer_id,
            decided_by = excluded.decided_by,
            updated_at = now();
    end if;

    if p_wine.vintage is null then
        return query select v_product_id, 'product'::text, v_product_id, v_producer_id;
        return;
    end if;

    select release.id into v_release_id
    from public.wine_reference_releases release
    where release.product_id = v_product_id and release.vintage_year = p_wine.vintage
    order by release.id limit 1;
    if v_release_id is null then
        v_release_id := pg_catalog.gen_random_uuid();
        insert into public.wine_reference_entities(id, entity_type)
        values (v_release_id, 'release');
        insert into public.wine_reference_releases(id, product_id, vintage_year)
        values (v_release_id, v_product_id, p_wine.vintage);
    end if;
    insert into public.wine_reference_identifier_demands(
        entity_id, entity_type, authority, identifier_scheme
    ) values (v_release_id, 'release', 'liv-ex', 'LWIN11')
    on conflict (entity_id, authority, identifier_scheme) do nothing;

    select package.id into v_package_id
    from public.wine_reference_packages package
    where package.release_id = v_release_id
      and package.container_type = 'bottle'
      and package.volume_ml = p_wine.format_ml
      and package.unit_count = 1
    order by package.id limit 1;
    if v_package_id is null then
        v_package_id := pg_catalog.gen_random_uuid();
        insert into public.wine_reference_entities(id, entity_type)
        values (v_package_id, 'package');
        insert into public.wine_reference_packages(
            id, release_id, container_type, volume_ml, unit_count
        ) values (v_package_id, v_release_id, 'bottle', p_wine.format_ml, 1);
    end if;
    insert into public.wine_reference_identifier_demands(
        entity_id, entity_type, authority, identifier_scheme
    ) values (v_package_id, 'package', 'liv-ex', 'LWIN16')
    on conflict (entity_id, authority, identifier_scheme) do nothing;
    return query select v_package_id, 'package'::text, v_product_id, v_producer_id;
end;
$$;

create or replace function public.confirm_enrichment_research_producer_identity(
    p_household_id uuid,
    p_case_id uuid,
    p_producer_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine public.wines%rowtype;
    v_source_producer text;
    v_source_terms text;
    v_producer_key text := private.normalize_wine_reference_text(p_producer_key);
    v_candidate_terms text;
    v_canonical_name text;
    v_score real;
    v_producer_id uuid;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    if p_producer_key <> v_producer_key or length(v_producer_key) not between 2 and 200 then
        raise exception using errcode = '22023', message = 'Producer identity key is invalid';
    end if;
    if not exists (
        select 1 from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id and member.role = 'owner'
    ) then
        raise exception using errcode = '42501',
            message = 'Only household owners can confirm producer identities';
    end if;

    select wine.* into v_wine
    from public.enrichment_research_cases research_case
    join public.enrichment_research_subscriptions subscription
      on subscription.case_id = research_case.id
     and subscription.household_id = p_household_id
    join public.wines wine
      on wine.id = subscription.exemplar_wine_id
     and wine.household_id = subscription.household_id
    where research_case.id = p_case_id
      and research_case.case_status = 'needs-identity-review'
      and research_case.subject_type = 'producer-profile'
    for update of research_case, subscription, wine;
    if not found then
        raise exception using errcode = '22023',
            message = 'Producer identity review is not available';
    end if;

    v_source_producer := private.normalize_wine_reference_text(v_wine.producer);
    v_source_terms := private.wine_reference_producer_identity_terms(v_wine.producer);
    v_candidate_terms := private.wine_reference_producer_identity_terms(v_producer_key);
    select min(entry.producer_name), max(greatest(
        extensions.similarity(v_source_producer, entry.producer_search),
        extensions.similarity(v_source_terms, v_candidate_terms)
    )) into v_canonical_name, v_score
    from public.wine_reference_lwin_entries entry
    join public.wine_reference_lwin_snapshots snapshot on snapshot.id = entry.snapshot_id
    where snapshot.source_key = 'liv-ex-lwin'
      and snapshot.import_status = 'active'
      and entry.source_status = 'live'
      and entry.producer_search = v_producer_key;
    if v_source_terms = '' or v_candidate_terms = '' or v_canonical_name is null
       or extensions.similarity(v_source_terms, v_candidate_terms) < 0.25
       or v_score < 0.25 then
        raise exception using errcode = '22023',
            message = 'Producer identity is not a plausible active LWIN candidate';
    end if;

    v_producer_id := private.resolve_lwin_reference_producer(v_canonical_name);
    insert into public.wine_reference_household_producer_preferences(
        household_id, source_producer_normalized, source_producer_text,
        producer_id, decided_by
    ) values (
        p_household_id, v_source_producer, v_wine.producer, v_producer_id, v_user_id
    )
    on conflict (household_id, source_producer_normalized)
    do update set source_producer_text = excluded.source_producer_text,
        producer_id = excluded.producer_id,
        decided_by = excluded.decided_by,
        updated_at = now();
    return public.get_household_enrichment_research_inbox(p_household_id);
end;
$$;

commit;
