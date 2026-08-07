begin;

-- Internal helpers used by Row Level Security policies.
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;


-- Future application objects must not automatically become writable or
-- executable by browser roles. Each migration grants required access
-- explicitly.
alter default privileges for role postgres in schema public
    revoke all privileges on tables from anon, authenticated;

alter default privileges for role postgres in schema public
    revoke all privileges on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
    revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Household and identity
-- ---------------------------------------------------------------------------

create table public.households (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(trim(name)) > 0),
    created_at timestamptz not null default now()
);

create table public.household_members (
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    user_id uuid not null
        references auth.users(id)
        on delete cascade,
    role text not null default 'member'
        check (role in ('owner', 'member')),
    created_at timestamptz not null default now(),

    primary key (household_id, user_id)
);

create index household_members_user_id_idx
    on public.household_members(user_id);


create table public.devices (
    id uuid primary key,
    household_id uuid not null,
    user_id uuid not null,
    name text not null check (length(trim(name)) > 0),
    created_at timestamptz not null default now(),
    last_seen_at timestamptz,

    constraint devices_membership_fk
        foreign key (household_id, user_id)
        references public.household_members(household_id, user_id)
        on delete cascade,

    constraint devices_identity_unique
        unique (id, household_id, user_id)
);

create index devices_household_id_idx
    on public.devices(household_id);

create index devices_user_id_idx
    on public.devices(user_id);


-- ---------------------------------------------------------------------------
-- Minimal cellar catalogue
-- ---------------------------------------------------------------------------

create table public.wines (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    producer text not null check (length(trim(producer)) > 0),
    cuvee text not null check (length(trim(cuvee)) > 0),
    vintage integer
        check (vintage is null or vintage between 1800 and 2200),
    color text,
    created_at timestamptz not null default now(),

    constraint wines_household_identity_unique
        unique (id, household_id)
);

create index wines_household_id_idx
    on public.wines(household_id);


create table public.cellars (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    name text not null check (length(trim(name)) > 0),
    created_at timestamptz not null default now(),

    constraint cellars_household_identity_unique
        unique (id, household_id),

    constraint cellars_household_name_unique
        unique (household_id, name)
);

create index cellars_household_id_idx
    on public.cellars(household_id);


create table public.locations (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    cellar_id uuid not null,
    code text not null check (length(trim(code)) > 0),
    created_at timestamptz not null default now(),

    constraint locations_cellar_fk
        foreign key (cellar_id, household_id)
        references public.cellars(id, household_id)
        on delete cascade,

    constraint locations_household_identity_unique
        unique (id, household_id),

    constraint locations_cellar_code_unique
        unique (cellar_id, code)
);

create index locations_household_id_idx
    on public.locations(household_id);

create index locations_cellar_id_idx
    on public.locations(cellar_id);


-- ---------------------------------------------------------------------------
-- Authoritative stock projection
-- ---------------------------------------------------------------------------

create table public.holdings (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    location_id uuid not null,
    quantity integer not null default 0
        check (quantity >= 0),
    revision bigint not null default 0
        check (revision >= 0),
    updated_at timestamptz not null default now(),

    constraint holdings_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,

    constraint holdings_location_fk
        foreign key (location_id, household_id)
        references public.locations(id, household_id)
        on delete cascade,

    constraint holdings_wine_location_unique
        unique (wine_id, location_id)
);

create index holdings_household_id_idx
    on public.holdings(household_id);

create index holdings_wine_id_idx
    on public.holdings(wine_id);

create index holdings_location_id_idx
    on public.holdings(location_id);


-- ---------------------------------------------------------------------------
-- Immutable inventory journal
-- ---------------------------------------------------------------------------

create table public.inventory_operations (
    id uuid primary key,
    household_id uuid not null,
    device_id uuid not null,
    user_id uuid not null,
    operation_type text not null
        check (operation_type in ('ADD', 'MOVE', 'REMOVE')),
    wine_id uuid not null,
    source_location_id uuid,
    destination_location_id uuid,
    quantity integer not null
        check (quantity > 0),
    remove_reason text
        check (
            remove_reason is null
            or remove_reason in (
                'DRANK',
                'GIFTED',
                'BROKEN',
                'LOST',
                'OTHER'
            )
        ),
    status text not null
        check (status in ('ACCEPTED', 'REJECTED')),
    error_code text,
    error_message text,
    created_at_client timestamptz not null,
    received_at_server timestamptz not null default now(),

    constraint inventory_operations_device_fk
        foreign key (device_id, household_id, user_id)
        references public.devices(id, household_id, user_id),

    constraint inventory_operations_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id),

    constraint inventory_operations_source_location_fk
        foreign key (source_location_id, household_id)
        references public.locations(id, household_id),

    constraint inventory_operations_destination_location_fk
        foreign key (destination_location_id, household_id)
        references public.locations(id, household_id),

    constraint inventory_operations_shape_check
        check (
            (
                operation_type = 'ADD'
                and source_location_id is null
                and destination_location_id is not null
                and remove_reason is null
            )
            or
            (
                operation_type = 'MOVE'
                and source_location_id is not null
                and destination_location_id is not null
                and destination_location_id <> source_location_id
                and remove_reason is null
            )
            or
            (
                operation_type = 'REMOVE'
                and source_location_id is not null
                and destination_location_id is null
                and remove_reason is not null
            )
        ),

    constraint inventory_operations_result_check
        check (
            (
                status = 'ACCEPTED'
                and error_code is null
                and error_message is null
            )
            or status = 'REJECTED'
        )
);

create index inventory_operations_household_id_idx
    on public.inventory_operations(household_id);

create index inventory_operations_user_id_idx
    on public.inventory_operations(user_id);

create index inventory_operations_device_id_idx
    on public.inventory_operations(device_id);

create index inventory_operations_received_at_idx
    on public.inventory_operations(received_at_server);


-- ---------------------------------------------------------------------------
-- RLS membership helper
-- ---------------------------------------------------------------------------

create or replace function private.is_household_member(
    p_household_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.household_members hm
        where hm.household_id = p_household_id
          and hm.user_id = (select auth.uid())
    );
$$;

revoke execute
    on function private.is_household_member(uuid)
    from public;

grant execute
    on function private.is_household_member(uuid)
    to authenticated;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.devices enable row level security;
alter table public.wines enable row level security;
alter table public.cellars enable row level security;
alter table public.locations enable row level security;
alter table public.holdings enable row level security;
alter table public.inventory_operations enable row level security;


create policy households_select_member
on public.households
for select
to authenticated
using (
    (select private.is_household_member(id))
);


create policy household_members_select_member
on public.household_members
for select
to authenticated
using (
    (select private.is_household_member(household_id))
);


create policy devices_select_own
on public.devices
for select
to authenticated
using (
    user_id = (select auth.uid())
    and (select private.is_household_member(household_id))
);


create policy wines_select_member
on public.wines
for select
to authenticated
using (
    (select private.is_household_member(household_id))
);


create policy cellars_select_member
on public.cellars
for select
to authenticated
using (
    (select private.is_household_member(household_id))
);


create policy locations_select_member
on public.locations
for select
to authenticated
using (
    (select private.is_household_member(household_id))
);


create policy holdings_select_member
on public.holdings
for select
to authenticated
using (
    (select private.is_household_member(household_id))
);


create policy inventory_operations_select_member
on public.inventory_operations
for select
to authenticated
using (
    (select private.is_household_member(household_id))
);


-- Browser clients may read synchronized state, but may not directly alter it.
--
-- Supabase may grant additional table privileges through its default
-- privileges. Remove all access first, then grant only the privileges required
-- by the browser application.
revoke all privileges on table
    public.households,
    public.household_members,
    public.devices,
    public.wines,
    public.cellars,
    public.locations,
    public.holdings,
    public.inventory_operations
from anon, authenticated;

grant select on table
    public.households,
    public.household_members,
    public.devices,
    public.wines,
    public.cellars,
    public.locations,
    public.holdings,
    public.inventory_operations
to authenticated;


-- ---------------------------------------------------------------------------
-- Authoritative mutation RPC
-- ---------------------------------------------------------------------------

create or replace function public.apply_inventory_operation(
    p_operation_id uuid,
    p_household_id uuid,
    p_device_id uuid,
    p_operation_type text,
    p_wine_id uuid,
    p_source_location_id uuid,
    p_destination_location_id uuid default null,
    p_quantity integer default 1,
    p_created_at_client timestamptz default now(),
    p_remove_reason text default null
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
    v_user_id uuid := (select auth.uid());
    v_operation_type text := upper(trim(p_operation_type));
    v_remove_reason text :=
        nullif(upper(trim(p_remove_reason)), '');
    v_existing public.inventory_operations%rowtype;
    v_available integer;
    v_error_message text;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if p_operation_id is null then
        raise exception using
            errcode = '22023',
            message = 'operation_id is required';
    end if;

    -- Serialize retries and concurrent delivery of the same operation UUID.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_operation_id::text, 0)
    );

    select op.*
    into v_existing
    from public.inventory_operations op
    where op.id = p_operation_id;

    if found then
        if v_existing.user_id is distinct from v_user_id
           or v_existing.household_id is distinct from p_household_id
           or v_existing.device_id is distinct from p_device_id
           or v_existing.operation_type is distinct from v_operation_type
           or v_existing.wine_id is distinct from p_wine_id
           or v_existing.source_location_id
                is distinct from p_source_location_id
           or v_existing.destination_location_id
                is distinct from p_destination_location_id
           or v_existing.quantity is distinct from p_quantity
           or v_existing.remove_reason
                is distinct from v_remove_reason
        then
            raise exception using
                errcode = '22023',
                message = 'operation_id was reused with a different payload';
        end if;

        return query
        select
            v_existing.id,
            v_existing.status,
            v_existing.error_code,
            v_existing.error_message;

        return;
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = p_household_id
          and hm.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'User is not a member of this household';
    end if;

    if not exists (
        select 1
        from public.devices d
        where d.id = p_device_id
          and d.household_id = p_household_id
          and d.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'Device is not registered for this user and household';
    end if;

    if v_operation_type not in ('ADD', 'MOVE', 'REMOVE') then
        raise exception using
            errcode = '22023',
            message = 'Unsupported inventory operation type';
    end if;

    if p_quantity is null or p_quantity <= 0 then
        raise exception using
            errcode = '22023',
            message = 'Quantity must be greater than zero';
    end if;

    if not exists (
        select 1
        from public.wines w
        where w.id = p_wine_id
          and w.household_id = p_household_id
    ) then
        raise exception using
            errcode = '22023',
            message = 'Wine does not belong to the household';
    end if;

    if v_operation_type = 'ADD' then
        if p_source_location_id is not null then
            raise exception using
                errcode = '22023',
                message = 'ADD must not define a source location';
        end if;

        if p_destination_location_id is null then
            raise exception using
                errcode = '22023',
                message = 'ADD requires a destination location';
        end if;

        if v_remove_reason is not null then
            raise exception using
                errcode = '22023',
                message = 'ADD must not define a remove reason';
        end if;

        if not exists (
            select 1
            from public.locations loc
            where loc.id = p_destination_location_id
              and loc.household_id = p_household_id
        ) then
            raise exception using
                errcode = '22023',
                message = 'Destination location does not belong to the household';
        end if;

    elsif v_operation_type = 'MOVE' then
        if p_source_location_id is null then
            raise exception using
                errcode = '22023',
                message = 'MOVE requires a source location';
        end if;

        if p_destination_location_id is null
           or p_destination_location_id = p_source_location_id
        then
            raise exception using
                errcode = '22023',
                message = 'MOVE requires a different destination location';
        end if;

        if v_remove_reason is not null then
            raise exception using
                errcode = '22023',
                message = 'MOVE must not define a remove reason';
        end if;

        if not exists (
            select 1
            from public.locations loc
            where loc.id = p_source_location_id
              and loc.household_id = p_household_id
        ) then
            raise exception using
                errcode = '22023',
                message = 'Source location does not belong to the household';
        end if;

        if not exists (
            select 1
            from public.locations loc
            where loc.id = p_destination_location_id
              and loc.household_id = p_household_id
        ) then
            raise exception using
                errcode = '22023',
                message = 'Destination location does not belong to the household';
        end if;

    else
        if p_source_location_id is null then
            raise exception using
                errcode = '22023',
                message = 'REMOVE requires a source location';
        end if;

        if p_destination_location_id is not null then
            raise exception using
                errcode = '22023',
                message = 'REMOVE must not define a destination location';
        end if;

        if v_remove_reason not in (
            'DRANK',
            'GIFTED',
            'BROKEN',
            'LOST',
            'OTHER'
        ) then
            raise exception using
                errcode = '22023',
                message = 'REMOVE requires a valid remove reason';
        end if;

        if not exists (
            select 1
            from public.locations loc
            where loc.id = p_source_location_id
              and loc.household_id = p_household_id
        ) then
            raise exception using
                errcode = '22023',
                message = 'Source location does not belong to the household';
        end if;
    end if;

    if v_operation_type in ('MOVE', 'REMOVE') then
        select h.quantity
        into v_available
        from public.holdings h
        where h.household_id = p_household_id
          and h.wine_id = p_wine_id
          and h.location_id = p_source_location_id
        for update;

        if coalesce(v_available, 0) < p_quantity then
            v_error_message := format(
                'Requested quantity %s exceeds available quantity %s',
                p_quantity,
                coalesce(v_available, 0)
            );

            insert into public.inventory_operations (
                id,
                household_id,
                device_id,
                user_id,
                operation_type,
                wine_id,
                source_location_id,
                destination_location_id,
                quantity,
                remove_reason,
                status,
                error_code,
                error_message,
                created_at_client
            )
            values (
                p_operation_id,
                p_household_id,
                p_device_id,
                v_user_id,
                v_operation_type,
                p_wine_id,
                p_source_location_id,
                p_destination_location_id,
                p_quantity,
                v_remove_reason,
                'REJECTED',
                'INSUFFICIENT_STOCK',
                v_error_message,
                coalesce(p_created_at_client, now())
            );

            return query
            select
                p_operation_id,
                'REJECTED'::text,
                'INSUFFICIENT_STOCK'::text,
                v_error_message;

            return;
        end if;

        update public.holdings
        set quantity = quantity - p_quantity,
            revision = revision + 1,
            updated_at = now()
        where household_id = p_household_id
          and wine_id = p_wine_id
          and location_id = p_source_location_id;
    end if;

    if v_operation_type in ('ADD', 'MOVE') then
        insert into public.holdings as destination (
            household_id,
            wine_id,
            location_id,
            quantity,
            revision,
            updated_at
        )
        values (
            p_household_id,
            p_wine_id,
            p_destination_location_id,
            p_quantity,
            1,
            now()
        )
        on conflict (wine_id, location_id)
        do update
        set quantity = destination.quantity + excluded.quantity,
            revision = destination.revision + 1,
            updated_at = now();
    end if;

    insert into public.inventory_operations (
        id,
        household_id,
        device_id,
        user_id,
        operation_type,
        wine_id,
        source_location_id,
        destination_location_id,
        quantity,
        remove_reason,
        status,
        created_at_client
    )
    values (
        p_operation_id,
        p_household_id,
        p_device_id,
        v_user_id,
        v_operation_type,
        p_wine_id,
        p_source_location_id,
        p_destination_location_id,
        p_quantity,
        v_remove_reason,
        'ACCEPTED',
        coalesce(p_created_at_client, now())
    );

    return query
    select
        p_operation_id,
        'ACCEPTED'::text,
        null::text,
        null::text;
end;
$$;


revoke all
on function public.apply_inventory_operation(
    uuid,
    uuid,
    uuid,
    text,
    uuid,
    uuid,
    uuid,
    integer,
    timestamptz,
    text
)
from public;

revoke all
on function public.apply_inventory_operation(
    uuid,
    uuid,
    uuid,
    text,
    uuid,
    uuid,
    uuid,
    integer,
    timestamptz,
    text
)
from anon;

grant execute
on function public.apply_inventory_operation(
    uuid,
    uuid,
    uuid,
    text,
    uuid,
    uuid,
    uuid,
    integer,
    timestamptz,
    text
)
to authenticated;

commit;
