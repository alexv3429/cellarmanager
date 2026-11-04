begin;

-- Only an owner-linked producer and a unique, identical canonical cuvée name
-- qualify here. Similar names and aliases remain in the manual review flow;
-- this operation never creates shared identities or approves dates.
alter table private.household_cuvee_identity_decisions
    add column decision_method text not null default 'owner_selected'
    check (decision_method in ('owner_selected', 'exact_canonical_name'));

create function private.household_exact_cuvee_candidates(p_household_id uuid)
returns table (
    source_producer text, source_cuvee text, source_appellation text,
    source_color text, first_vintage integer, last_vintage integer,
    producer_id uuid, product_id uuid, product_name text, wine_count bigint
)
language sql stable set search_path = '' as $$
    with groups as (
        select private.normalize_wine_reference_text(w.producer) producer_key,
            private.normalize_wine_reference_text(w.cuvee) cuvee_key,
            private.normalize_wine_reference_text(w.appellation) appellation_key,
            private.canonical_enrichment_wine_color(w.color) color_key,
            min(pg_catalog.btrim(w.producer)) source_producer,
            min(pg_catalog.btrim(w.cuvee)) source_cuvee,
            min(coalesce(pg_catalog.btrim(w.appellation), '')) source_appellation,
            min(w.color) source_color,
            min(w.vintage) first_vintage, max(w.vintage) last_vintage,
            count(*) wine_count,
            pg_catalog.bool_and(w.wine_reference_id is null) all_unlinked
        from public.wines w
        where w.household_id = p_household_id
          and w.merged_into_wine_id is null
          and w.vintage is not null
          and private.normalize_wine_reference_text(w.producer) <> ''
          and private.normalize_wine_reference_text(w.cuvee) <> ''
          and private.canonical_enrichment_wine_color(w.color) is not null
        group by private.normalize_wine_reference_text(w.producer),
            private.normalize_wine_reference_text(w.cuvee),
            private.normalize_wine_reference_text(w.appellation),
            private.canonical_enrichment_wine_color(w.color)
    )
    select g.source_producer, g.source_cuvee, g.source_appellation,
        g.source_color, g.first_vintage, g.last_vintage,
        preference.producer_id, match.id, match.canonical_name, g.wine_count
    from groups g
    join public.wine_reference_household_producer_preferences preference
      on preference.household_id = p_household_id
     and preference.source_producer_normalized = g.producer_key
    join lateral (
        select min(p.id::text)::uuid id, min(p.canonical_name) canonical_name
        from public.wine_reference_products p
        where p.producer_id = preference.producer_id
          and private.normalize_wine_reference_text(p.canonical_name) = g.cuvee_key
        having count(*) = 1
    ) match on true
    where g.all_unlinked
      and not exists (
          select 1 from private.household_cuvee_identity_links link
          where link.household_id = p_household_id
            and link.source_producer = g.producer_key
            and link.source_cuvee = g.cuvee_key
            and link.source_appellation = g.appellation_key
            and link.source_color = g.color_key
      );
$$;
revoke all on function private.household_exact_cuvee_candidates(uuid)
    from public, anon, authenticated, powersync_role, service_role;

create function public.preview_household_exact_cuvee_links(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_plan jsonb;
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501',
            message = 'Only household owners can review cuvée identities';
    end if;
    select pg_catalog.jsonb_build_object(
        'household_id', p_household_id,
        'candidates', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'source_producer', c.source_producer,
            'source_cuvee', c.source_cuvee,
            'source_appellation', c.source_appellation,
            'source_color', c.source_color,
            'first_vintage', c.first_vintage,
            'last_vintage', c.last_vintage,
            'producer_id', c.producer_id,
            'product_id', c.product_id,
            'product_name', c.product_name,
            'wine_count', c.wine_count
        ) order by c.source_producer, c.source_cuvee,
            c.source_appellation, c.source_color), '[]'::jsonb),
        'candidate_groups', count(*),
        'wine_count', coalesce(sum(c.wine_count), 0)
    ) into v_plan
    from private.household_exact_cuvee_candidates(p_household_id) c;
    return v_plan || pg_catalog.jsonb_build_object('plan_sha256',
        pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(v_plan::text, 'UTF8'), 'sha256'), 'hex'));
end;
$$;

create function public.apply_household_exact_cuvee_links(
    p_household_id uuid, p_expected_plan_sha256 text, p_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_plan jsonb;
    v_item jsonb;
    v_producer_key text;
    v_cuvee_key text;
    v_appellation_key text;
    v_color_key text;
    v_linked integer := 0;
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501',
            message = 'Only household owners can link cuvée identities';
    end if;
    if p_confirmed is distinct from true then
        raise exception using errcode = '22023', message = 'Confirm the exact cuvée links';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('household-exact-cuvees|' || p_household_id, 0));
    v_plan := public.preview_household_exact_cuvee_links(p_household_id);
    if p_expected_plan_sha256 is distinct from v_plan ->> 'plan_sha256' then
        raise exception using errcode = '40001', message = 'Exact cuvée plan changed; preview again';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_plan -> 'candidates') loop
        v_producer_key := private.normalize_wine_reference_text(v_item ->> 'source_producer');
        v_cuvee_key := private.normalize_wine_reference_text(v_item ->> 'source_cuvee');
        v_appellation_key := private.normalize_wine_reference_text(v_item ->> 'source_appellation');
        v_color_key := private.canonical_enrichment_wine_color(v_item ->> 'source_color');
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
            'household-cuvee|' || p_household_id || '|' || v_producer_key || '|' ||
            v_cuvee_key || '|' || v_appellation_key || '|' || v_color_key, 0));
        if exists (select 1 from private.household_cuvee_identity_links link
            where link.household_id = p_household_id
              and link.source_producer = v_producer_key
              and link.source_cuvee = v_cuvee_key
              and link.source_appellation = v_appellation_key
              and link.source_color = v_color_key) then
            raise exception using errcode = '40001', message = 'Cuvée mapping changed; preview again';
        end if;
        insert into private.household_cuvee_identity_links (
            household_id, source_producer, source_cuvee, source_appellation,
            source_color, first_vintage, last_vintage, producer_id,
            product_id, decided_by
        ) values (
            p_household_id, v_producer_key, v_cuvee_key, v_appellation_key,
            v_color_key, (v_item ->> 'first_vintage')::integer,
            (v_item ->> 'last_vintage')::integer,
            (v_item ->> 'producer_id')::uuid,
            (v_item ->> 'product_id')::uuid, auth.uid());
        insert into private.household_cuvee_identity_decisions (
            household_id, source_producer, source_cuvee, source_appellation,
            source_color, first_vintage, last_vintage, previous_product_id,
            product_id, action, decided_by, decision_method
        ) values (
            p_household_id, v_producer_key, v_cuvee_key, v_appellation_key,
            v_color_key, (v_item ->> 'first_vintage')::integer,
            (v_item ->> 'last_vintage')::integer, null,
            (v_item ->> 'product_id')::uuid, 'set', auth.uid(),
            'exact_canonical_name');
        v_linked := v_linked + 1;
    end loop;
    return pg_catalog.jsonb_build_object('linked_groups', v_linked,
        'wine_count', v_plan -> 'wine_count', 'household_id', p_household_id,
        'published', false, 'dates_approved', false);
end;
$$;

revoke all on function public.preview_household_exact_cuvee_links(uuid)
    from public, anon;
revoke all on function public.apply_household_exact_cuvee_links(uuid,text,boolean)
    from public, anon;
grant execute on function public.preview_household_exact_cuvee_links(uuid)
    to authenticated;
grant execute on function public.apply_household_exact_cuvee_links(uuid,text,boolean)
    to authenticated;

commit;
