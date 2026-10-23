begin;

-- A cellar owner's classification is deliberately separate from the shared
-- reference membership. It applies only to one wine, one immutable reference
-- version, and one hierarchy scope. A changed wine identity makes it stale.
create table private.household_wine_ageing_choices (
    wine_id uuid not null,
    household_id uuid not null,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    scope text not null check (scope in
        ('producer_appellation', 'producer_region', 'appellation', 'region')),
    group_id uuid,
    source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
    choice_revision uuid not null default gen_random_uuid(),
    decided_by uuid not null references auth.users(id),
    decided_at timestamptz not null default now(),
    primary key (wine_id, version_id, scope),
    foreign key (wine_id, household_id) references public.wines(id, household_id)
        on delete cascade,
    foreign key (group_id, version_id) references public.drinking_window_ageing_groups(id, version_id)
);
create index household_wine_ageing_choices_household_idx
    on private.household_wine_ageing_choices(household_id, version_id);
revoke all on private.household_wine_ageing_choices
    from public, anon, authenticated, powersync_role, service_role;

create table private.household_wine_ageing_decisions (
    id uuid primary key default gen_random_uuid(),
    wine_id uuid not null,
    household_id uuid not null,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    scope text not null,
    action text not null check (action in ('select', 'unclassified', 'clear')),
    previous_group_id uuid,
    group_id uuid,
    source_fingerprint text not null,
    decided_by uuid not null references auth.users(id),
    decided_at timestamptz not null default now(),
    foreign key (wine_id, household_id) references public.wines(id, household_id)
        on delete cascade
);
revoke all on private.household_wine_ageing_decisions
    from public, anon, authenticated, powersync_role, service_role;

create function private.drinking_window_wine_identity_fingerprint(p_wine public.wines)
returns text language sql stable set search_path = '' as $$
    select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
            private.wine_reference_source_fingerprint(p_wine),
            p_wine.wine_reference_type, p_wine.wine_reference_id
        )::text, 'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function private.drinking_window_wine_identity_fingerprint(public.wines)
    from public, anon, authenticated, powersync_role, service_role;

-- Resolve canonical context once for both the owner API and the choice-aware
-- draft selector. No fuzzy producer or appellation inference is permitted.
create function private.drinking_window_wine_context(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_color text;
begin
    select * into v_wine from public.wines
    where id = p_wine_id and merged_into_wine_id is null;
    if not found then
        return jsonb_build_object('status', 'wine_not_found');
    end if;
    v_color := private.canonical_enrichment_wine_color(v_wine.color);
    if v_wine.vintage is null or v_color is null or v_wine.area is null then
        return jsonb_build_object('status', 'region_color_and_vintage_required');
    end if;
    select array_agg(distinct p.id) into v_region_ids from (
        select place.id from public.enrichment_places place
        where place.place_type in ('region', 'subregion')
          and place.normalized_name = private.normalize_wine_reference_text(v_wine.area)
        union
        select place.id from public.enrichment_place_aliases alias
        join public.enrichment_places place on place.id = alias.place_id
        where place.place_type in ('region', 'subregion')
          and alias.normalized_value = private.normalize_wine_reference_text(v_wine.area)
    ) p;
    if coalesce(cardinality(v_region_ids), 0) <> 1 then
        return jsonb_build_object('status', 'region_not_confirmed');
    end if;
    v_region_id := v_region_ids[1];
    if v_wine.appellation is not null and trim(v_wine.appellation) <> '' then
        select array_agg(distinct p.id) into v_appellation_ids from (
            select place.id from public.enrichment_places place
            where place.place_type = 'appellation'
              and place.normalized_name = private.normalize_wine_reference_text(v_wine.appellation)
            union
            select place.id from public.enrichment_place_aliases alias
            join public.enrichment_places place on place.id = alias.place_id
            where place.place_type = 'appellation'
              and alias.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
        ) p;
        if coalesce(cardinality(v_appellation_ids), 0) <> 1 then
            return jsonb_build_object('status', 'appellation_not_confirmed');
        end if;
        v_appellation_id := v_appellation_ids[1];
        if not private.drinking_window_place_contains(v_region_id, v_appellation_id) then
            return jsonb_build_object('status', 'appellation_outside_region');
        end if;
    end if;
    if v_wine.wine_reference_type = 'release' then
        select release.id, product.id, product.producer_id
        into v_release_id, v_product_id, v_producer_id
        from public.wine_reference_releases release
        join public.wine_reference_products product on product.id = release.product_id
        where release.id = v_wine.wine_reference_id
          and release.vintage_year = v_wine.vintage;
    elsif v_wine.wine_reference_type = 'product' then
        select product.id, product.producer_id into v_product_id, v_producer_id
        from public.wine_reference_products product
        where product.id = v_wine.wine_reference_id;
    end if;
    if v_producer_id is null then
        return jsonb_build_object('status', 'wine_reference_unlinked');
    end if;
    return jsonb_build_object(
        'status', 'ready', 'wine_id', v_wine.id,
        'household_id', v_wine.household_id,
        'source_fingerprint', private.drinking_window_wine_identity_fingerprint(v_wine),
        'region_id', v_region_id, 'appellation_id', v_appellation_id,
        'producer_id', v_producer_id, 'product_id', v_product_id,
        'release_id', v_release_id, 'wine_color', v_color,
        'vintage_year', v_wine.vintage
    );
end;
$$;
revoke all on function private.drinking_window_wine_context(uuid)
    from public, anon, authenticated, powersync_role, service_role;

create function private.drinking_window_group_eligible(
    p_wine_id uuid, p_version_id uuid, p_group_id uuid,
    p_reviewed_membership boolean
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_choice private.household_wine_ageing_choices%rowtype;
begin
    select * into v_wine from public.wines where id = p_wine_id;
    select choice.* into v_choice
    from private.household_wine_ageing_choices choice
    join public.drinking_window_ageing_groups g
      on g.id = p_group_id and g.version_id = p_version_id
     and g.scope = choice.scope
    where choice.wine_id = p_wine_id
      and choice.version_id = p_version_id
      and choice.source_fingerprint = private.drinking_window_wine_identity_fingerprint(v_wine);
    if found then
        return coalesce(v_choice.group_id = p_group_id, false);
    end if;
    return coalesce(p_reviewed_membership, false);
end;
$$;
revoke all on function private.drinking_window_group_eligible(uuid, uuid, uuid, boolean)
    from public, anon, authenticated, powersync_role, service_role;

-- Owner-facing choices show only groups with a row for this exact version,
-- region, colour, vintage, and the linked producer/appellation when required.
create function public.get_household_wine_ageing_choices(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_context jsonb;
begin
    select * into v_wine from public.wines where id = p_wine_id
      and merged_into_wine_id is null;
    if not found then
        raise exception using errcode = '22023', message = 'Wine was not found';
    end if;
    if private.require_household_member(v_wine.household_id) <> 'owner' then
        raise exception using errcode = '42501',
            message = 'Only household owners can review ageing groups';
    end if;
    v_context := private.drinking_window_wine_context(p_wine_id);
    return jsonb_build_object(
        'wine_id', p_wine_id,
        'context_status', v_context ->> 'status',
        'source_fingerprint', v_context ->> 'source_fingerprint',
        'versions', coalesce((
            select jsonb_agg(jsonb_build_object(
                'version_id', v.id, 'version_number', v.version_number,
                'version_status', v.status,
                'groups', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'group_id', g.id, 'scope', g.scope,
                        'group_key', g.group_key, 'definition', g.definition,
                        'first_trial_year', r.first_trial_year,
                        'best_start_year', r.best_start_year,
                        'best_end_year', r.best_end_year
                    ) order by r.scope, g.group_key)
                    from public.drinking_window_reference_rows r
                    join public.drinking_window_ageing_groups g
                      on g.id = r.ageing_group_id and g.version_id = r.version_id
                     and g.scope = r.scope
                    where v_context ->> 'status' = 'ready'
                      and r.version_id = v.id
                      and r.region_id = (v_context ->> 'region_id')::uuid
                      and r.wine_color = v_context ->> 'wine_color'
                      and r.vintage_year = (v_context ->> 'vintage_year')::integer
                      and (r.producer_id is null
                           or r.producer_id = (v_context ->> 'producer_id')::uuid)
                      and (r.appellation_id is null
                           or r.appellation_id = (v_context ->> 'appellation_id')::uuid)
                ), '[]'::jsonb),
                'choices', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'scope', choice.scope, 'group_id', choice.group_id,
                        'choice_revision', choice.choice_revision
                    ) order by choice.scope)
                    from private.household_wine_ageing_choices choice
                    where choice.wine_id = p_wine_id and choice.version_id = v.id
                      and choice.source_fingerprint = v_context ->> 'source_fingerprint'
                ), '[]'::jsonb)
            ) order by v.version_number desc)
            from public.drinking_window_reference_versions v
            where v.status = 'active'
               or (v.status = 'superseded' and exists (
                   select 1 from private.drinking_window_household_rollouts rollout
                   where rollout.version_id = v.id
                     and rollout.household_id = v_wine.household_id
                     and rollout.enabled))
               or (v.status = 'draft' and v.id = (
                   select latest.id from public.drinking_window_reference_versions latest
                   where latest.status = 'draft'
                   order by latest.version_number desc limit 1))
        ), '[]'::jsonb)
    );
end;
$$;

create function public.manage_household_wine_ageing_choice(
    p_wine_id uuid, p_version_id uuid, p_scope text,
    p_action text, p_group_id uuid, p_expected_fingerprint text,
    p_expected_revision uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_context jsonb;
    v_current private.household_wine_ageing_choices%rowtype;
    v_revision uuid;
begin
    select * into v_wine from public.wines where id = p_wine_id
      and merged_into_wine_id is null for update;
    if not found then
        raise exception using errcode = '22023', message = 'Wine was not found';
    end if;
    if private.require_household_member(v_wine.household_id) <> 'owner' then
        raise exception using errcode = '42501',
            message = 'Only household owners can choose an ageing group';
    end if;
    if not exists (select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id
          and (v.status in ('draft', 'active')
               or (v.status = 'superseded' and exists (
                   select 1 from private.drinking_window_household_rollouts rollout
                   where rollout.version_id = v.id
                     and rollout.household_id = v_wine.household_id
                     and rollout.enabled)))) then
        raise exception using errcode = '22023', message = 'Choose a current reference version';
    end if;
    if p_scope not in ('producer_appellation', 'producer_region',
                       'appellation', 'region')
       or p_action not in ('select', 'unclassified', 'clear')
       or (p_action = 'select') is distinct from (p_group_id is not null) then
        raise exception using errcode = '22023', message = 'Invalid ageing-group choice';
    end if;
    v_context := private.drinking_window_wine_context(p_wine_id);
    if v_context ->> 'status' <> 'ready' then
        raise exception using errcode = '22023',
            message = 'Confirm the wine identity, region, colour and vintage first';
    end if;
    if v_context ->> 'source_fingerprint' is distinct from p_expected_fingerprint then
        raise exception using errcode = '40001',
            message = 'Wine identity changed; refresh before choosing a group';
    end if;
    if not exists (
        select 1 from public.drinking_window_reference_rows r
        join public.drinking_window_ageing_groups g
          on g.id = r.ageing_group_id and g.version_id = r.version_id
         and g.scope = r.scope
        where r.version_id = p_version_id and r.scope = p_scope
          and (p_group_id is null or g.id = p_group_id)
          and r.region_id = (v_context ->> 'region_id')::uuid
          and r.wine_color = v_context ->> 'wine_color'
          and r.vintage_year = (v_context ->> 'vintage_year')::integer
          and (r.producer_id is null
               or r.producer_id = (v_context ->> 'producer_id')::uuid)
          and (r.appellation_id is null
               or r.appellation_id = (v_context ->> 'appellation_id')::uuid)
    ) then
        raise exception using errcode = '22023',
            message = 'No applicable group exists for this wine and version';
    end if;
    perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'wine-ageing-choice|' || p_wine_id || '|' || p_version_id || '|' || p_scope, 0));
    select * into v_current from private.household_wine_ageing_choices
    where wine_id = p_wine_id and version_id = p_version_id and scope = p_scope
    for update;
    if (case when v_current.source_fingerprint = p_expected_fingerprint
        then v_current.choice_revision else null end)
        is distinct from p_expected_revision then
        raise exception using errcode = '40001',
            message = 'Ageing-group choice changed; refresh before saving';
    end if;
    if p_action = 'clear' then
        delete from private.household_wine_ageing_choices
        where wine_id = p_wine_id and version_id = p_version_id and scope = p_scope;
        v_revision := null;
    else
        v_revision := gen_random_uuid();
        insert into private.household_wine_ageing_choices
            (wine_id, household_id, version_id, scope, group_id,
             source_fingerprint, choice_revision, decided_by)
        values (p_wine_id, v_wine.household_id, p_version_id, p_scope,
                p_group_id, p_expected_fingerprint, v_revision, auth.uid())
        on conflict (wine_id, version_id, scope) do update set
            group_id = excluded.group_id,
            source_fingerprint = excluded.source_fingerprint,
            choice_revision = excluded.choice_revision,
            decided_by = excluded.decided_by,
            decided_at = now();
    end if;
    insert into private.household_wine_ageing_decisions
        (wine_id, household_id, version_id, scope, action,
         previous_group_id, group_id, source_fingerprint, decided_by)
    values (p_wine_id, v_wine.household_id, p_version_id, p_scope, p_action,
            v_current.group_id, p_group_id, p_expected_fingerprint, auth.uid());
    return jsonb_build_object('scope', p_scope, 'group_id', p_group_id,
        'choice_revision', v_revision);
end;
$$;

revoke all on function public.get_household_wine_ageing_choices(uuid)
    from public, anon, authenticated, powersync_role;
revoke all on function public.manage_household_wine_ageing_choice(uuid, uuid, text, text, uuid, text, uuid)
    from public, anon, authenticated, powersync_role;
grant execute on function public.get_household_wine_ageing_choices(uuid)
    to authenticated;
grant execute on function public.manage_household_wine_ageing_choice(uuid, uuid, text, text, uuid, text, uuid)
    to authenticated;

commit;
