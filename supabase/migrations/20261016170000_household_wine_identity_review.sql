begin;

-- A household confirmation is not a new shared alias or reference record.
-- Retain every owner decision, including removal and replacement, for audit.
create table private.household_wine_identity_decisions (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    source_fingerprint text not null,
    source_snapshot jsonb not null,
    previous_reference_id uuid,
    previous_reference_type text,
    reference_id uuid,
    reference_type text,
    action text not null check (action in ('link', 'remove')),
    decided_by uuid not null references auth.users(id),
    decided_at timestamptz not null default now(),
    foreign key (wine_id, household_id) references public.wines(id, household_id) on delete cascade,
    foreign key (previous_reference_id, previous_reference_type)
        references public.wine_reference_entities(id, entity_type),
    foreign key (reference_id, reference_type)
        references public.wine_reference_entities(id, entity_type),
    check ((action = 'link' and reference_id is not null and reference_type in ('product', 'release'))
        or (action = 'remove' and reference_id is null and reference_type is null))
);
create index household_wine_identity_decisions_wine_idx
    on private.household_wine_identity_decisions(household_id, wine_id, decided_at desc);
revoke all on private.household_wine_identity_decisions from public, anon, authenticated;

-- A missing identity is a private request, never an automatic global insert.
create table private.household_wine_identity_requests (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    source_fingerprint text not null,
    source_snapshot jsonb not null,
    requested_by uuid not null references auth.users(id),
    requested_at timestamptz not null default now(),
    status text not null default 'pending' check (status in ('pending', 'reviewed', 'declined')),
    foreign key (wine_id, household_id) references public.wines(id, household_id) on delete cascade,
    unique (household_id, wine_id, source_fingerprint)
);
create index household_wine_identity_requests_pending_idx
    on private.household_wine_identity_requests(requested_at)
    where status = 'pending';
revoke all on private.household_wine_identity_requests from public, anon, authenticated;

create or replace function public.get_household_wine_identity_status(p_wine_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_wine public.wines%rowtype;
    v_fingerprint text;
    v_request_status text;
begin
    select wine.* into v_wine from public.wines wine where wine.id = p_wine_id;
    if not found or v_wine.merged_into_wine_id is not null then
        raise exception using errcode = '22023', message = 'Wine was not found';
    end if;
    if private.require_household_member(v_wine.household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can review wine identities';
    end if;
    v_fingerprint := private.wine_reference_source_fingerprint(v_wine);
    select request.status into v_request_status
    from private.household_wine_identity_requests request
    where request.household_id = v_wine.household_id
      and request.wine_id = v_wine.id
      and request.source_fingerprint = v_fingerprint;
    return pg_catalog.jsonb_build_object(
        'wine_id', v_wine.id,
        'source_fingerprint', v_fingerprint,
        'matched_reference', case when v_wine.wine_reference_id is null then null
            else private.describe_wine_reference(v_wine.wine_reference_id, v_wine.wine_reference_type) end,
        'request_status', v_request_status
    );
end;
$$;

create or replace function public.search_household_wine_references(
    p_wine_id uuid,
    p_query text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_wine public.wines%rowtype;
    v_query text := private.normalize_wine_reference_text(p_query);
begin
    select wine.* into v_wine from public.wines wine where wine.id = p_wine_id;
    if not found or v_wine.merged_into_wine_id is not null then
        raise exception using errcode = '22023', message = 'Wine was not found';
    end if;
    if private.require_household_member(v_wine.household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can review wine identities';
    end if;
    if pg_catalog.length(v_query) not between 2 and 100 then
        raise exception using errcode = '22023', message = 'Search with 2 to 100 characters';
    end if;

    return coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'reference_id', result.reference_id,
            'reference_type', result.reference_type,
            'producer_name', result.producer_name,
            'product_name', result.product_name,
            'vintage_year', result.vintage_year,
            'release_designator', result.release_designator
        ) order by result.producer_name, result.product_name, result.release_designator)
        from (
            select
                case when v_wine.vintage is null then product.id else release.id end as reference_id,
                case when v_wine.vintage is null then 'product' else 'release' end as reference_type,
                producer.canonical_name as producer_name,
                product.canonical_name as product_name,
                release.vintage_year,
                release.release_designator
            from public.wine_reference_products product
            join public.wine_reference_producers producer on producer.id = product.producer_id
            left join public.wine_reference_releases release
              on release.product_id = product.id and release.vintage_year = v_wine.vintage
            where (v_wine.vintage is null or release.id is not null)
              and (
                  pg_catalog.strpos(private.normalize_wine_reference_text(producer.canonical_name), v_query) > 0
                  or pg_catalog.strpos(private.normalize_wine_reference_text(product.canonical_name), v_query) > 0
                  or pg_catalog.strpos(private.normalize_wine_reference_text(producer.canonical_name || ' ' || product.canonical_name), v_query) > 0
              )
            order by producer.canonical_name, product.canonical_name, release.release_designator
            limit 25
        ) result
    ), '[]'::jsonb);
end;
$$;

create or replace function public.manage_household_wine_identity(
    p_wine_id uuid,
    p_action text,
    p_reference_id uuid,
    p_expected_fingerprint text,
    p_expected_reference_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wine public.wines%rowtype;
    v_fingerprint text;
    v_reference_type text;
begin
    select wine.* into v_wine from public.wines wine where wine.id = p_wine_id for update;
    if not found or v_wine.merged_into_wine_id is not null then
        raise exception using errcode = '22023', message = 'Wine was not found';
    end if;
    if private.require_household_member(v_wine.household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can review wine identities';
    end if;
    v_fingerprint := private.wine_reference_source_fingerprint(v_wine);
    if v_fingerprint is distinct from p_expected_fingerprint
       or v_wine.wine_reference_id is distinct from p_expected_reference_id then
        raise exception using errcode = '40001', message = 'Wine identity changed; refresh before saving';
    end if;

    if p_action = 'link' then
        if p_reference_id is null then
            raise exception using errcode = '22023', message = 'Choose an existing shared wine';
        end if;
        if v_wine.vintage is null then
            select 'product' into v_reference_type
            from public.wine_reference_products product where product.id = p_reference_id;
        else
            select 'release' into v_reference_type
            from public.wine_reference_releases release
            where release.id = p_reference_id and release.vintage_year = v_wine.vintage;
        end if;
        if v_reference_type is null then
            raise exception using errcode = '22023', message = 'Choose a shared wine with the same vintage';
        end if;
    elsif p_action = 'remove' then
        if p_reference_id is not null or v_wine.wine_reference_id is null then
            raise exception using errcode = '22023', message = 'There is no shared wine link to remove';
        end if;
    else
        raise exception using errcode = '22023', message = 'Invalid wine identity action';
    end if;
    if p_action = 'link' and v_wine.wine_reference_id = p_reference_id then
        raise exception using errcode = '22023', message = 'This wine is already linked';
    end if;

    -- A previous Liv-ex confirmation no longer describes the current link.
    update public.wine_reference_match_decisions decision
    set decision = 'rejected', reference_id = null, reference_type = null,
        remember_producer = false, decided_by = auth.uid(), updated_at = now()
    where decision.household_id = v_wine.household_id
      and decision.wine_id = v_wine.id
      and decision.source_fingerprint = v_fingerprint
      and decision.decision = 'confirmed';

    update public.wines wine
    set wine_reference_id = p_reference_id,
        wine_reference_type = v_reference_type
    where wine.id = p_wine_id;

    insert into private.household_wine_identity_decisions (
        household_id, wine_id, source_fingerprint, source_snapshot,
        previous_reference_id, previous_reference_type,
        reference_id, reference_type, action, decided_by
    ) values (
        v_wine.household_id, v_wine.id, v_fingerprint,
        private.wine_reference_source_snapshot(v_wine),
        v_wine.wine_reference_id, v_wine.wine_reference_type,
        p_reference_id, v_reference_type, p_action, auth.uid()
    );

    return pg_catalog.jsonb_build_object(
        'wine_id', p_wine_id,
        'reference_id', p_reference_id,
        'reference_type', v_reference_type,
        'source_fingerprint', v_fingerprint
    );
end;
$$;

create or replace function public.request_household_wine_identity(
    p_wine_id uuid,
    p_expected_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wine public.wines%rowtype;
    v_fingerprint text;
    v_request_id uuid;
begin
    select wine.* into v_wine from public.wines wine where wine.id = p_wine_id for update;
    if not found or v_wine.merged_into_wine_id is not null then
        raise exception using errcode = '22023', message = 'Wine was not found';
    end if;
    if private.require_household_member(v_wine.household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can request shared wine identities';
    end if;
    v_fingerprint := private.wine_reference_source_fingerprint(v_wine);
    if v_fingerprint is distinct from p_expected_fingerprint then
        raise exception using errcode = '40001', message = 'Wine identity changed; refresh before requesting';
    end if;
    if v_wine.wine_reference_id is not null then
        raise exception using errcode = '22023', message = 'This wine already has a shared identity';
    end if;

    insert into private.household_wine_identity_requests (
        household_id, wine_id, source_fingerprint, source_snapshot, requested_by
    ) values (
        v_wine.household_id, v_wine.id, v_fingerprint,
        private.wine_reference_source_snapshot(v_wine), auth.uid()
    )
    on conflict (household_id, wine_id, source_fingerprint) do nothing
    returning id into v_request_id;
    if v_request_id is null then
        select request.id into v_request_id
        from private.household_wine_identity_requests request
        where request.household_id = v_wine.household_id
          and request.wine_id = v_wine.id
          and request.source_fingerprint = v_fingerprint;
    end if;
    return pg_catalog.jsonb_build_object('request_id', v_request_id, 'wine_id', p_wine_id);
end;
$$;

revoke all on function public.search_household_wine_references(uuid, text) from public, anon;
revoke all on function public.get_household_wine_identity_status(uuid) from public, anon;
revoke all on function public.manage_household_wine_identity(uuid, text, uuid, text, uuid) from public, anon;
revoke all on function public.request_household_wine_identity(uuid, text) from public, anon;
grant execute on function public.search_household_wine_references(uuid, text) to authenticated;
grant execute on function public.get_household_wine_identity_status(uuid) to authenticated;
grant execute on function public.manage_household_wine_identity(uuid, text, uuid, text, uuid) to authenticated;
grant execute on function public.request_household_wine_identity(uuid, text) to authenticated;

commit;
