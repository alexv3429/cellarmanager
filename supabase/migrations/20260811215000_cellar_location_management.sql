begin;

alter table public.cellars
    add column is_active boolean not null default true;

alter table public.locations
    add column is_active boolean not null default true,
    add column display_order integer,
    add column capacity integer,
    add constraint locations_display_order_nonnegative
        check (display_order is null or display_order >= 0),
    add constraint locations_capacity_positive
        check (capacity is null or capacity > 0);

create index cellars_household_active_idx
on public.cellars (household_id, is_active);

create index locations_cellar_active_order_idx
on public.locations (
    cellar_id,
    is_active,
    display_order
);

-- The four-argument form is the permanent creation API. Capacity is optional;
-- display order remains implicit until the user first customizes a cellar.
create function public.create_location(
    p_household_id uuid,
    p_cellar_id uuid,
    p_code text,
    p_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_code text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_code, '')),
            '[[:space:]]+',
            ' ',
            'g'
        );
    v_location_id uuid;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if v_code = '' then
        raise exception using
            errcode = '22023',
            message = 'Location code is required';
    end if;

    if p_capacity is not null and p_capacity <= 0 then
        raise exception using
            errcode = '22023',
            message = 'Location capacity must be greater than zero';
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = p_household_id
          and hm.user_id = v_user_id
          and hm.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can manage cellar setup';
    end if;

    if not exists (
        select 1
        from public.cellars c
        where c.id = p_cellar_id
          and c.household_id = p_household_id
    ) then
        raise exception using
            errcode = '22023',
            message = 'Cellar does not belong to the household';
    end if;

    perform 1
    from public.cellars c
    where c.id = p_cellar_id
      and c.is_active
    for share;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Restore the cellar before adding a location';
    end if;

    begin
        insert into public.locations (
            household_id,
            cellar_id,
            code,
            capacity
        )
        values (
            p_household_id,
            p_cellar_id,
            v_code,
            p_capacity
        )
        returning id into v_location_id;
    exception
        when unique_violation then
            raise exception using
                errcode = '22023',
                message = 'A location with this code already exists in the cellar';
    end;

    return v_location_id;
end;
$$;

-- Preserve the v0.2 client signature while deployed clients upgrade.
create or replace function public.create_location(
    p_household_id uuid,
    p_cellar_id uuid,
    p_code text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
    select public.create_location(
        p_household_id,
        p_cellar_id,
        p_code,
        null
    );
$$;

create function public.update_location(
    p_location_id uuid,
    p_code text,
    p_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_code text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_code, '')),
            '[[:space:]]+',
            ' ',
            'g'
        );
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if v_code = '' then
        raise exception using
            errcode = '22023',
            message = 'Location code is required';
    end if;

    if p_capacity is not null and p_capacity <= 0 then
        raise exception using
            errcode = '22023',
            message = 'Location capacity must be greater than zero';
    end if;

    select l.household_id
    into v_household_id
    from public.locations l
    where l.id = p_location_id;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Location was not found';
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = v_household_id
          and hm.user_id = v_user_id
          and hm.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can manage cellar setup';
    end if;

    begin
        update public.locations
        set code = v_code,
            capacity = p_capacity
        where id = p_location_id;
    exception
        when unique_violation then
            raise exception using
                errcode = '22023',
                message = 'A location with this code already exists in the cellar';
    end;

    return p_location_id;
end;
$$;

create function public.set_location_order(
    p_cellar_id uuid,
    p_location_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_active_count bigint;
    v_requested_count bigint :=
        coalesce(pg_catalog.cardinality(p_location_ids), 0);
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select c.household_id
    into v_household_id
    from public.cellars c
    where c.id = p_cellar_id
      and c.is_active;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Active cellar was not found';
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = v_household_id
          and hm.user_id = v_user_id
          and hm.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can manage cellar setup';
    end if;

    select count(*)
    into v_active_count
    from public.locations l
    where l.cellar_id = p_cellar_id
      and l.is_active;

    if v_requested_count is distinct from v_active_count
       or exists (
           select requested.location_id
           from pg_catalog.unnest(p_location_ids)
               as requested(location_id)
           group by requested.location_id
           having requested.location_id is null
               or count(*) > 1
       )
       or (
           select count(*)
           from public.locations l
           where l.cellar_id = p_cellar_id
             and l.is_active
             and l.id = any(p_location_ids)
       ) is distinct from v_active_count
    then
        raise exception using
            errcode = '22023',
            message = 'Location order must include every active location exactly once';
    end if;

    update public.locations l
    set display_order = requested.ordinality::integer * 10
    from pg_catalog.unnest(p_location_ids)
        with ordinality as requested(location_id, ordinality)
    where l.id = requested.location_id
      and l.cellar_id = p_cellar_id;
end;
$$;

create function public.archive_location(
    p_location_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select l.household_id
    into v_household_id
    from public.locations l
    where l.id = p_location_id
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Location was not found';
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = v_household_id
          and hm.user_id = v_user_id
          and hm.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can manage cellar setup';
    end if;

    if exists (
        select 1
        from public.holdings h
        where h.location_id = p_location_id
          and h.quantity > 0
    ) then
        raise exception using
            errcode = '22023',
            message = 'Move or remove every bottle before archiving this location';
    end if;

    update public.locations
    set is_active = false
    where id = p_location_id;

    return p_location_id;
end;
$$;

create function public.restore_location(
    p_location_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_cellar_id uuid;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select l.household_id, l.cellar_id
    into v_household_id, v_cellar_id
    from public.locations l
    where l.id = p_location_id
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Location was not found';
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = v_household_id
          and hm.user_id = v_user_id
          and hm.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can manage cellar setup';
    end if;

    perform 1
    from public.cellars c
    where c.id = v_cellar_id
      and c.is_active
    for share;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Restore the cellar before restoring this location';
    end if;

    update public.locations
    set is_active = true,
        display_order = (
            select coalesce(max(other.display_order), 0) + 10
            from public.locations other
            where other.cellar_id = v_cellar_id
              and other.is_active
              and other.id <> p_location_id
        )
    where id = p_location_id;

    return p_location_id;
end;
$$;

create function public.archive_cellar(
    p_cellar_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select c.household_id
    into v_household_id
    from public.cellars c
    where c.id = p_cellar_id
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Cellar was not found';
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = v_household_id
          and hm.user_id = v_user_id
          and hm.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can manage cellar setup';
    end if;

    if exists (
        select 1
        from public.locations l
        where l.cellar_id = p_cellar_id
          and l.is_active
    ) then
        raise exception using
            errcode = '22023',
            message = 'Archive every active location before archiving this cellar';
    end if;

    if exists (
        select 1
        from public.holdings h
        join public.locations l
          on l.id = h.location_id
        where l.cellar_id = p_cellar_id
          and h.quantity > 0
    ) then
        raise exception using
            errcode = '22023',
            message = 'Move or remove every bottle before archiving this cellar';
    end if;

    update public.cellars
    set is_active = false
    where id = p_cellar_id;

    return p_cellar_id;
end;
$$;

create function public.restore_cellar(
    p_cellar_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select c.household_id
    into v_household_id
    from public.cellars c
    where c.id = p_cellar_id
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Cellar was not found';
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = v_household_id
          and hm.user_id = v_user_id
          and hm.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can manage cellar setup';
    end if;

    update public.cellars
    set is_active = true
    where id = p_cellar_id;

    return p_cellar_id;
end;
$$;

-- Keep the original operation implementation intact behind a private name.
-- The public wrapper records stale offline operations against archived
-- locations as rejected operations instead of mutating holdings or retrying
-- forever.
alter function public.apply_inventory_operation(
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
rename to apply_inventory_operation_without_location_state;

revoke all
on function public.apply_inventory_operation_without_location_state(
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
from public, anon, authenticated;

create function public.apply_inventory_operation(
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
    v_operation_type text :=
        pg_catalog.upper(pg_catalog.btrim(p_operation_type));
    v_remove_reason text := nullif(
        pg_catalog.upper(pg_catalog.btrim(p_remove_reason)),
        ''
    );
    v_inactive_location boolean;
    v_error_message text :=
        'A cellar location used by this operation is archived';
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

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_operation_id::text, 0)
    );

    if exists (
        select 1
        from public.inventory_operations op
        where op.id = p_operation_id
    ) then
        return query
        select *
        from public.apply_inventory_operation_without_location_state(
            p_operation_id,
            p_household_id,
            p_device_id,
            p_operation_type,
            p_wine_id,
            p_source_location_id,
            p_destination_location_id,
            p_quantity,
            p_created_at_client,
            p_remove_reason
        );
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

    -- Serialize inventory changes with location archival. If the operation
    -- wins the lock, archival sees the new holding; if archival wins, this
    -- operation sees the inactive state and is recorded as rejected.
    perform 1
    from public.locations l
    where l.household_id = p_household_id
      and l.id in (
          p_source_location_id,
          p_destination_location_id
      )
    order by l.id
    for share;

    select exists (
        select 1
        from public.locations l
        join public.cellars c
          on c.id = l.cellar_id
        where l.household_id = p_household_id
          and l.id in (
              p_source_location_id,
              p_destination_location_id
          )
          and (not l.is_active or not c.is_active)
    )
    into v_inactive_location;

    if v_inactive_location then
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
            'LOCATION_ARCHIVED',
            v_error_message,
            coalesce(p_created_at_client, now())
        );

        return query
        select
            p_operation_id,
            'REJECTED'::text,
            'LOCATION_ARCHIVED'::text,
            v_error_message;
        return;
    end if;

    return query
    select *
    from public.apply_inventory_operation_without_location_state(
        p_operation_id,
        p_household_id,
        p_device_id,
        p_operation_type,
        p_wine_id,
        p_source_location_id,
        p_destination_location_id,
        p_quantity,
        p_created_at_client,
        p_remove_reason
    );
end;
$$;

revoke all
on function public.create_location(uuid, uuid, text, integer)
from public, anon;

revoke all
on function public.update_location(uuid, text, integer)
from public, anon;

revoke all
on function public.set_location_order(uuid, uuid[])
from public, anon;

revoke all
on function public.archive_location(uuid)
from public, anon;

revoke all
on function public.restore_location(uuid)
from public, anon;

revoke all
on function public.archive_cellar(uuid)
from public, anon;

revoke all
on function public.restore_cellar(uuid)
from public, anon;

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
from public, anon;

grant execute
on function public.create_location(uuid, uuid, text, integer)
to authenticated;

grant execute
on function public.update_location(uuid, text, integer)
to authenticated;

grant execute
on function public.set_location_order(uuid, uuid[])
to authenticated;

grant execute
on function public.archive_location(uuid)
to authenticated;

grant execute
on function public.restore_location(uuid)
to authenticated;

grant execute
on function public.archive_cellar(uuid)
to authenticated;

grant execute
on function public.restore_cellar(uuid)
to authenticated;

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
