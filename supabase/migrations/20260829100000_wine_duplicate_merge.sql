begin;

-- A merge retires one household catalogue row without rewriting the immutable
-- inventory journal. Historical operations keep their original wine UUID and
-- snapshots; current holdings and owner-authored observations move to the
-- explicitly selected surviving row.
alter table public.wines
    add column merged_into_wine_id uuid,
    add column merged_at timestamptz,
    add column merged_by uuid
        references auth.users(id),
    add constraint wines_merge_target_fk
        foreign key (merged_into_wine_id, household_id)
        references public.wines(id, household_id),
    add constraint wines_merge_state_check
        check (
            (
                merged_into_wine_id is null
                and merged_at is null
                and merged_by is null
            )
            or (
                merged_into_wine_id is not null
                and merged_into_wine_id <> id
                and merged_at is not null
                and merged_by is not null
            )
        );

create index wines_active_household_idx
    on public.wines(household_id)
    where merged_into_wine_id is null;

create index wines_merged_target_idx
    on public.wines(household_id, merged_into_wine_id)
    where merged_into_wine_id is not null;


create table public.wine_merge_events (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    source_wine_id uuid not null,
    target_wine_id uuid not null,
    merged_by uuid not null
        references auth.users(id),
    detection_basis text not null,
    source_snapshot jsonb not null,
    target_snapshot_before jsonb not null,
    target_snapshot_after jsonb not null,
    bottles_transferred integer not null,
    positions_transferred integer not null,
    positions_combined integer not null,
    observations_transferred integer not null,
    serving_override_transferred boolean not null,
    serving_override_conflict boolean not null,
    maturity_override_transferred boolean not null,
    maturity_override_conflict boolean not null,
    created_at timestamptz not null default now(),

    constraint wine_merge_events_source_fk
        foreign key (source_wine_id, household_id)
        references public.wines(id, household_id),
    constraint wine_merge_events_target_fk
        foreign key (target_wine_id, household_id)
        references public.wines(id, household_id),
    constraint wine_merge_events_source_unique
        unique (source_wine_id),
    constraint wine_merge_events_distinct_check
        check (source_wine_id <> target_wine_id),
    constraint wine_merge_events_basis_check
        check (detection_basis in ('catalog-identity', 'confirmed-reference')),
    constraint wine_merge_events_snapshots_check
        check (
            jsonb_typeof(source_snapshot) = 'object'
            and jsonb_typeof(target_snapshot_before) = 'object'
            and jsonb_typeof(target_snapshot_after) = 'object'
        ),
    constraint wine_merge_events_counts_check
        check (
            bottles_transferred >= 0
            and positions_transferred >= 0
            and positions_combined >= 0
            and observations_transferred >= 0
        )
);

create index wine_merge_events_household_idx
    on public.wine_merge_events(household_id, created_at desc);

alter table public.wine_merge_events enable row level security;

create policy wine_merge_events_select_member
on public.wine_merge_events
for select
to authenticated
using ((select private.is_household_member(household_id)));

revoke all privileges on table public.wine_merge_events
from public, anon, authenticated, powersync_role;

grant select, insert on table public.wine_merge_events
to service_role;

grant select on table public.wine_merge_events
to authenticated;


create or replace function private.normalized_wine_merge_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
    select pg_catalog.lower(
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_value, '')),
            '[[:space:]]+',
            ' ',
            'g'
        )
    );
$$;

revoke execute
on function private.normalized_wine_merge_text(text)
from public, anon, authenticated;


create or replace function private.wine_duplicate_basis(
    p_source public.wines,
    p_target public.wines
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_same_identity boolean;
    v_same_reference boolean;
begin
    if p_source.household_id is distinct from p_target.household_id
       or p_source.id = p_target.id
       or p_source.merged_into_wine_id is not null
       or p_target.merged_into_wine_id is not null
    then
        return null;
    end if;

    v_same_reference :=
        p_source.wine_reference_id is not null
        and p_source.wine_reference_id = p_target.wine_reference_id
        and p_source.wine_reference_type = p_target.wine_reference_type
        and p_source.vintage is not distinct from p_target.vintage
        and private.normalized_wine_merge_text(p_source.color) =
            private.normalized_wine_merge_text(p_target.color)
        and p_source.format_ml = p_target.format_ml;

    if v_same_reference then
        return 'confirmed-reference';
    end if;

    v_same_identity :=
        private.normalized_wine_merge_text(p_source.producer) =
            private.normalized_wine_merge_text(p_target.producer)
        and private.normalized_wine_merge_text(p_source.cuvee) =
            private.normalized_wine_merge_text(p_target.cuvee)
        and p_source.vintage is not distinct from p_target.vintage
        and private.normalized_wine_merge_text(p_source.color) =
            private.normalized_wine_merge_text(p_target.color)
        and p_source.format_ml = p_target.format_ml
        and (
            p_source.wine_reference_id is null
            or p_target.wine_reference_id is null
            or (
                p_source.wine_reference_id = p_target.wine_reference_id
                and p_source.wine_reference_type = p_target.wine_reference_type
            )
        );

    return case when v_same_identity then 'catalog-identity' else null end;
end;
$$;

revoke execute
on function private.wine_duplicate_basis(public.wines, public.wines)
from public, anon, authenticated;


create or replace function private.protect_wine_merge_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.merged_into_wine_id is not null then
        raise exception using
            errcode = '23514',
            message = 'A merged catalog entry is immutable';
    end if;

    if new.merged_into_wine_id is not null
       and not exists (
            select 1
            from public.wines target
            where target.id = new.merged_into_wine_id
              and target.household_id = new.household_id
              and target.merged_into_wine_id is null
       )
    then
        raise exception using
            errcode = '23514',
            message = 'A wine can merge only into an active entry in the same household';
    end if;

    return new;
end;
$$;

revoke execute
on function private.protect_wine_merge_state()
from public, anon, authenticated;

create trigger wines_protect_merge_state
before update on public.wines
for each row
execute function private.protect_wine_merge_state();


create or replace function private.resolve_active_wine_id(
    p_household_id uuid,
    p_wine_id uuid
)
returns uuid
language sql
stable
set search_path = ''
as $$
    with recursive chain as (
        select wine.id, wine.merged_into_wine_id, 1 as depth
        from public.wines wine
        where wine.id = p_wine_id
          and wine.household_id = p_household_id

        union all

        select target.id, target.merged_into_wine_id, chain.depth + 1
        from chain
        join public.wines target
          on target.id = chain.merged_into_wine_id
         and target.household_id = p_household_id
        where chain.depth < 32
    )
    select id
    from chain
    order by depth desc
    limit 1;
$$;

revoke execute
on function private.resolve_active_wine_id(uuid, uuid)
from public, anon, authenticated;


create or replace function private.canonicalize_holding_wine()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_active_wine_id uuid;
begin
    v_active_wine_id := private.resolve_active_wine_id(
        new.household_id,
        new.wine_id
    );

    if v_active_wine_id is null then
        raise exception using
            errcode = '23503',
            message = 'Holding wine does not belong to the household';
    end if;

    new.wine_id := v_active_wine_id;
    return new;
end;
$$;

revoke execute
on function private.canonicalize_holding_wine()
from public, anon, authenticated;

create trigger holdings_canonicalize_merged_wine
before insert or update of wine_id, household_id on public.holdings
for each row
execute function private.canonicalize_holding_wine();


create or replace function public.merge_wines(
    p_source_wine_id uuid,
    p_target_wine_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_source public.wines%rowtype;
    v_target public.wines%rowtype;
    v_target_after public.wines%rowtype;
    v_basis text;
    v_holding public.holdings%rowtype;
    v_target_holding_id uuid;
    v_bottles integer := 0;
    v_positions integer := 0;
    v_combined integer := 0;
    v_observations integer := 0;
    v_serving_transferred boolean := false;
    v_serving_conflict boolean := false;
    v_maturity_transferred boolean := false;
    v_maturity_conflict boolean := false;
    v_event_id uuid;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if p_source_wine_id is null
       or p_target_wine_id is null
       or p_source_wine_id = p_target_wine_id
    then
        raise exception using
            errcode = '22023',
            message = 'Choose two distinct catalog entries to merge';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            least(p_source_wine_id::text, p_target_wine_id::text)
            || '|'
            || greatest(p_source_wine_id::text, p_target_wine_id::text),
            0
        )
    );

    select wine.*
    into v_source
    from public.wines wine
    where wine.id = p_source_wine_id
    for update;

    select wine.*
    into v_target
    from public.wines wine
    where wine.id = p_target_wine_id
    for update;

    if v_source.id is null or v_target.id is null then
        raise exception using
            errcode = '22023',
            message = 'Both catalog entries must exist';
    end if;

    if v_source.household_id is distinct from v_target.household_id
       or not exists (
            select 1
            from public.household_members member
            where member.household_id = v_source.household_id
              and member.user_id = v_user_id
              and member.role = 'owner'
       )
    then
        raise exception using
            errcode = '42501',
            message = 'Only a household owner can merge its catalog entries';
    end if;

    v_basis := private.wine_duplicate_basis(v_source, v_target);

    if v_basis is null then
        raise exception using
            errcode = '22023',
            message = 'These entries are not a conservative duplicate match';
    end if;

    -- The selected target controls display values. Missing descriptive facts
    -- and a missing confirmed reference are filled from the retired row.
    update public.wines
    set appellation = coalesce(appellation, v_source.appellation),
        area = coalesce(area, v_source.area),
        country = coalesce(country, v_source.country),
        classification = coalesce(classification, v_source.classification),
        vineyard = coalesce(vineyard, v_source.vineyard),
        grape_composition = case
            when grape_composition = '[]'::jsonb
                then v_source.grape_composition
            else grape_composition
        end,
        sweetness_category = coalesce(
            sweetness_category,
            v_source.sweetness_category
        ),
        alcohol_percent = coalesce(
            alcohol_percent,
            v_source.alcohol_percent
        ),
        certifications = case
            when certifications = '[]'::jsonb
                then v_source.certifications
            else certifications
        end,
        wine_reference_id = coalesce(
            wine_reference_id,
            v_source.wine_reference_id
        ),
        wine_reference_type = coalesce(
            wine_reference_type,
            v_source.wine_reference_type
        )
    where id = v_target.id;

    for v_holding in
        select holding.*
        from public.holdings holding
        where holding.household_id = v_source.household_id
          and holding.wine_id = v_source.id
        order by holding.location_id
        for update
    loop
        v_bottles := v_bottles + v_holding.quantity;
        v_positions := v_positions + 1;

        select holding.id
        into v_target_holding_id
        from public.holdings holding
        where holding.wine_id = v_target.id
          and holding.location_id = v_holding.location_id
        for update;

        if v_target_holding_id is null then
            update public.holdings
            set wine_id = v_target.id,
                revision = revision + 1,
                updated_at = now()
            where id = v_holding.id;
        else
            update public.holdings
            set quantity = quantity + v_holding.quantity,
                revision = revision + 1,
                updated_at = now()
            where id = v_target_holding_id;

            delete from public.holdings
            where id = v_holding.id;

            v_combined := v_combined + 1;
        end if;
    end loop;

    update public.household_wine_observations
    set wine_id = v_target.id
    where household_id = v_source.household_id
      and wine_id = v_source.id;
    get diagnostics v_observations = row_count;

    if exists (
        select 1
        from public.wine_serving_overrides
        where household_id = v_source.household_id
          and wine_id = v_source.id
    ) then
        if exists (
            select 1
            from public.wine_serving_overrides
            where household_id = v_target.household_id
              and wine_id = v_target.id
        ) then
            v_serving_conflict := true;
        else
            update public.wine_serving_overrides
            set wine_id = v_target.id,
                updated_at = now()
            where household_id = v_source.household_id
              and wine_id = v_source.id;
            v_serving_transferred := true;
        end if;
    end if;

    if exists (
        select 1
        from public.wine_maturity_overrides
        where household_id = v_source.household_id
          and wine_id = v_source.id
    ) then
        if exists (
            select 1
            from public.wine_maturity_overrides
            where household_id = v_target.household_id
              and wine_id = v_target.id
        ) then
            v_maturity_conflict := true;
        else
            update public.wine_maturity_overrides
            set wine_id = v_target.id,
                updated_at = now()
            where household_id = v_source.household_id
              and wine_id = v_source.id;
            v_maturity_transferred := true;
        end if;
    end if;

    update public.enrichment_research_subscriptions
    set exemplar_wine_id = v_target.id
    where household_id = v_source.household_id
      and exemplar_wine_id = v_source.id;

    update public.wine_enrichment_projections
    set status = 'superseded'
    where household_id = v_source.household_id
      and wine_id = v_source.id
      and status = 'current';

    delete from public.enrichment_demands
    where household_id = v_source.household_id
      and wine_id = v_source.id;

    update public.wines
    set merged_into_wine_id = v_target.id,
        merged_at = now(),
        merged_by = v_user_id
    where id = v_source.id;

    select wine.*
    into v_target_after
    from public.wines wine
    where wine.id = v_target.id;

    insert into public.wine_merge_events (
        household_id,
        source_wine_id,
        target_wine_id,
        merged_by,
        detection_basis,
        source_snapshot,
        target_snapshot_before,
        target_snapshot_after,
        bottles_transferred,
        positions_transferred,
        positions_combined,
        observations_transferred,
        serving_override_transferred,
        serving_override_conflict,
        maturity_override_transferred,
        maturity_override_conflict
    )
    values (
        v_source.household_id,
        v_source.id,
        v_target.id,
        v_user_id,
        v_basis,
        to_jsonb(v_source),
        to_jsonb(v_target),
        to_jsonb(v_target_after),
        v_bottles,
        v_positions,
        v_combined,
        v_observations,
        v_serving_transferred,
        v_serving_conflict,
        v_maturity_transferred,
        v_maturity_conflict
    )
    returning id into v_event_id;

    return jsonb_build_object(
        'merge_event_id', v_event_id,
        'source_wine_id', v_source.id,
        'target_wine_id', v_target.id,
        'detection_basis', v_basis,
        'bottles_transferred', v_bottles,
        'positions_transferred', v_positions,
        'positions_combined', v_combined,
        'observations_transferred', v_observations,
        'serving_override_transferred', v_serving_transferred,
        'serving_override_conflict', v_serving_conflict,
        'maturity_override_transferred', v_maturity_transferred,
        'maturity_override_conflict', v_maturity_conflict
    );
end;
$$;

revoke all
on function public.merge_wines(uuid, uuid)
from public, anon;

grant execute
on function public.merge_wines(uuid, uuid)
to authenticated;


-- The historical ADD resolver counts all semantic matches. Retired rows must
-- remain queryable for activity, but they must not make a later new-wine ADD
-- ambiguous when exactly one active catalogue entry has that identity.
alter function public.apply_add_inventory_operation(
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    integer,
    text,
    text,
    text,
    integer,
    uuid,
    integer,
    timestamptz
)
rename to apply_add_inventory_operation_unfiltered;

revoke all
on function public.apply_add_inventory_operation_unfiltered(
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    integer,
    text,
    text,
    text,
    integer,
    uuid,
    integer,
    timestamptz
)
from public, anon, authenticated;

create function public.apply_add_inventory_operation(
    p_operation_id uuid,
    p_household_id uuid,
    p_device_id uuid,
    p_requested_wine_id uuid,
    p_wine_producer text,
    p_wine_cuvee text,
    p_wine_vintage integer,
    p_wine_color text,
    p_wine_appellation text,
    p_wine_area text,
    p_wine_format_ml integer,
    p_destination_location_id uuid,
    p_quantity integer default 1,
    p_created_at_client timestamptz default now()
)
returns table (
    operation_id uuid,
    operation_status text,
    operation_error_code text,
    operation_error_message text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_requested_wine_id uuid := p_requested_wine_id;
    v_active_match_count bigint;
    v_active_match_id uuid;
begin
    if not exists (
        select 1
        from public.wines wine
        where wine.id = p_requested_wine_id
    ) then
        select count(*), min(wine.id::text)::uuid
        into v_active_match_count, v_active_match_id
        from public.wines wine
        where wine.household_id = p_household_id
          and wine.merged_into_wine_id is null
          and private.normalized_wine_merge_text(wine.producer) =
              private.normalized_wine_merge_text(p_wine_producer)
          and private.normalized_wine_merge_text(wine.cuvee) =
              private.normalized_wine_merge_text(p_wine_cuvee)
          and wine.vintage is not distinct from p_wine_vintage
          and private.normalized_wine_merge_text(wine.color) =
              private.normalized_wine_merge_text(p_wine_color)
          and wine.format_ml = p_wine_format_ml;

        if v_active_match_count = 1 then
            v_requested_wine_id := v_active_match_id;
        end if;
    end if;

    return query
    select result.operation_id,
           result.operation_status,
           result.operation_error_code,
           result.operation_error_message
    from public.apply_add_inventory_operation_unfiltered(
        p_operation_id,
        p_household_id,
        p_device_id,
        v_requested_wine_id,
        p_wine_producer,
        p_wine_cuvee,
        p_wine_vintage,
        p_wine_color,
        p_wine_appellation,
        p_wine_area,
        p_wine_format_ml,
        p_destination_location_id,
        p_quantity,
        p_created_at_client
    ) result;
end;
$$;

revoke all
on function public.apply_add_inventory_operation(
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    integer,
    text,
    text,
    text,
    integer,
    uuid,
    integer,
    timestamptz
)
from public, anon;

grant execute
on function public.apply_add_inventory_operation(
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    integer,
    text,
    text,
    text,
    integer,
    uuid,
    integer,
    timestamptz
)
to authenticated;

commit;
