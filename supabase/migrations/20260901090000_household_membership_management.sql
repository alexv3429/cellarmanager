begin;

-- A revoked membership must stop authorizing future work without erasing the
-- immutable inventory journal or household-visible knowledge contributed by
-- that account. Devices therefore become durable registrations with an
-- explicit revocation timestamp instead of children deleted with membership.
alter table public.devices
    add column revoked_at timestamptz;

comment on column public.devices.revoked_at is
    'When set, this registration cannot authorize new inventory operations; the row remains for immutable history.';

alter table public.devices
    drop constraint devices_membership_fk;

alter table public.devices
    add constraint devices_household_fk
        foreign key (household_id)
        references public.households(id)
        on delete cascade;

alter table public.devices
    add constraint devices_user_fk
        foreign key (user_id)
        references auth.users(id)
        on delete cascade;

-- Shared observations and shared serving overrides retain their author after
-- the author leaves. Their existing direct auth.users foreign keys continue to
-- protect attribution. Private observations are removed explicitly by the
-- revocation RPC below.
alter table public.household_wine_observations
    drop constraint household_wine_observations_member_fk;

alter table public.wine_serving_overrides
    drop constraint wine_serving_overrides_member_fk;


-- Preserve the former composite-FK write invariant without retaining its
-- cascading-delete behavior. Updates that do not change attribution remain
-- possible after a contributor leaves, while new or reassigned attribution
-- must always point to a current household membership.
create function private.require_observation_attribution_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1
        from public.household_members member
        where member.household_id = new.household_id
          and member.user_id = new.recorded_by
    ) then
        raise exception using
            errcode = '23503',
            message =
                'insert or update on table "household_wine_observations" violates foreign key constraint "household_wine_observations_member_fk"';
    end if;

    return new;
end;
$$;

revoke execute
on function private.require_observation_attribution_membership()
from public, anon, authenticated;

create trigger household_wine_observations_member_insert
before insert on public.household_wine_observations
for each row
execute function private.require_observation_attribution_membership();

create trigger household_wine_observations_member_update
before update of household_id, recorded_by
on public.household_wine_observations
for each row
execute function private.require_observation_attribution_membership();


create function private.require_serving_override_attribution_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1
        from public.household_members member
        where member.household_id = new.household_id
          and member.user_id = new.updated_by
    ) then
        raise exception using
            errcode = '23503',
            message =
                'insert or update on table "wine_serving_overrides" violates foreign key constraint "wine_serving_overrides_member_fk"';
    end if;

    return new;
end;
$$;

revoke execute
on function private.require_serving_override_attribution_membership()
from public, anon, authenticated;

create trigger wine_serving_overrides_member_insert
before insert on public.wine_serving_overrides
for each row
execute function private.require_serving_override_attribution_membership();

create trigger wine_serving_overrides_member_update
before update of household_id, updated_by
on public.wine_serving_overrides
for each row
execute function private.require_serving_override_attribution_membership();


create table private.household_membership_events (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    membership_id uuid not null,
    member_user_id uuid
        references auth.users(id)
        on delete set null,
    actor_user_id uuid
        references auth.users(id)
        on delete set null,
    event_type text not null,
    previous_role text,
    new_role text,
    created_at timestamptz not null default now(),

    constraint household_membership_events_type_check
        check (
            event_type in (
                'invited',
                'accepted',
                'role_changed',
                'revoked',
                'ownership_transferred',
                'left'
            )
        ),
    constraint household_membership_events_previous_role_check
        check (
            previous_role is null
            or previous_role in ('owner', 'member')
        ),
    constraint household_membership_events_new_role_check
        check (
            new_role is null
            or new_role in ('owner', 'member')
        ),
    constraint household_membership_events_shape_check
        check (
            (
                event_type = 'role_changed'
                and previous_role is not null
                and new_role is not null
                and previous_role <> new_role
            )
            or (
                event_type = 'revoked'
                and previous_role is not null
                and new_role is null
            )
            or event_type in (
                'invited',
                'accepted',
                'ownership_transferred',
                'left'
            )
        )
);

create index household_membership_events_household_created_idx
on private.household_membership_events (household_id, created_at desc);

comment on table private.household_membership_events is
    'Server-only audit trail for membership lifecycle changes. Later invitation, transfer, and leaving workflows reuse the same event vocabulary.';

revoke all privileges
on table private.household_membership_events
from public, anon, authenticated;


-- Defense in depth: every new inventory journal row must use a registration
-- that is still active. This prevents an old offline device from resuming work
-- if its account is invited to the household again later.
create function private.require_active_inventory_device()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1
        from public.devices device
        where device.id = new.device_id
          and device.household_id = new.household_id
          and device.user_id = new.user_id
          and device.revoked_at is null
    ) then
        raise exception using
            errcode = '42501',
            message = 'Device registration is no longer active';
    end if;

    return new;
end;
$$;

revoke execute
on function private.require_active_inventory_device()
from public, anon, authenticated;

create trigger inventory_operations_require_active_device
before insert on public.inventory_operations
for each row
execute function private.require_active_inventory_device();


-- Registration keeps its existing public shape. A revoked UUID is never
-- silently reactivated: a later membership must register a fresh device ID so
-- operations queued under the former membership remain invalid.
create or replace function public.register_device(
    p_device_id uuid,
    p_household_id uuid,
    p_name text
)
returns table (
    device_id uuid,
    device_household_id uuid,
    device_user_id uuid,
    device_name text,
    device_created_at timestamptz,
    device_last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_name text := pg_catalog.btrim(p_name);
    v_existing public.devices%rowtype;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if p_device_id is null then
        raise exception using
            errcode = '22023',
            message = 'device_id is required';
    end if;

    if p_household_id is null then
        raise exception using
            errcode = '22023',
            message = 'household_id is required';
    end if;

    if v_name is null or pg_catalog.length(v_name) = 0 then
        raise exception using
            errcode = '22023',
            message = 'Device name is required';
    end if;

    if pg_catalog.length(v_name) > 120 then
        raise exception using
            errcode = '22023',
            message = 'Device name must not exceed 120 characters';
    end if;

    perform private.require_household_member(p_household_id);

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_device_id::text, 0)
    );

    select device.*
    into v_existing
    from public.devices device
    where device.id = p_device_id;

    if found then
        if v_existing.household_id is distinct from p_household_id
           or v_existing.user_id is distinct from v_user_id
        then
            raise exception using
                errcode = '42501',
                message =
                    'Device identifier is already registered to another user or household';
        end if;

        if v_existing.revoked_at is not null then
            raise exception using
                errcode = '55000',
                message =
                    'Device registration was revoked; register a new device identifier';
        end if;

        update public.devices
        set name = v_name,
            last_seen_at = now()
        where id = p_device_id;
    else
        insert into public.devices (
            id,
            household_id,
            user_id,
            name,
            last_seen_at
        )
        values (
            p_device_id,
            p_household_id,
            v_user_id,
            v_name,
            now()
        );
    end if;

    return query
    select
        device.id,
        device.household_id,
        device.user_id,
        device.name,
        device.created_at,
        device.last_seen_at
    from public.devices device
    where device.id = p_device_id;
end;
$$;

revoke all
on function public.register_device(uuid, uuid, text)
from public, anon;

grant execute
on function public.register_device(uuid, uuid, text)
to authenticated;


-- Members need a safe collaborator label, but never raw auth metadata. The
-- RPC returns only the account email and optional conventional display name.
create function public.get_household_members(
    p_household_id uuid
)
returns table (
    membership_id uuid,
    member_user_id uuid,
    member_email text,
    member_display_name text,
    member_role text,
    member_created_at timestamptz,
    is_current_user boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    perform private.require_household_member(p_household_id);

    return query
    select
        member.id,
        member.user_id,
        user_row.email::text,
        nullif(
            pg_catalog.btrim(
                coalesce(
                    user_row.raw_user_meta_data ->> 'full_name',
                    user_row.raw_user_meta_data ->> 'name',
                    ''
                )
            ),
            ''
        ),
        member.role,
        member.created_at,
        member.user_id = (select auth.uid())
    from public.household_members member
    join auth.users user_row
      on user_row.id = member.user_id
    where member.household_id = p_household_id
    order by
        case member.role when 'owner' then 0 else 1 end,
        member.created_at,
        member.id;
end;
$$;

comment on function public.get_household_members(uuid) is
    'Lists current collaborators and safe identity labels for any member of the household.';

revoke all
on function public.get_household_members(uuid)
from public, anon;

grant execute
on function public.get_household_members(uuid)
to authenticated;


create function public.update_household_member_role(
    p_household_id uuid,
    p_membership_id uuid,
    p_role text
)
returns table (
    membership_id uuid,
    member_user_id uuid,
    previous_role text,
    member_role text,
    changed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := (select auth.uid());
    v_role text := pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_role, ''))
    );
    v_member public.household_members%rowtype;
    v_changed_at timestamptz := now();
begin
    if p_household_id is null then
        raise exception using
            errcode = '22023',
            message = 'household_id is required';
    end if;

    if p_membership_id is null then
        raise exception using
            errcode = '22023',
            message = 'membership_id is required';
    end if;

    if v_role not in ('owner', 'member') then
        raise exception using
            errcode = '22023',
            message = 'Member role must be owner or member';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_household_id::text, 0)
    );

    perform private.require_household_owner(p_household_id);

    select member.*
    into v_member
    from public.household_members member
    where member.id = p_membership_id
      and member.household_id = p_household_id
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Household membership was not found';
    end if;

    if v_member.role = v_role then
        return query
        select
            v_member.id,
            v_member.user_id,
            v_member.role,
            v_member.role,
            v_changed_at;
        return;
    end if;

    if v_member.user_id = v_actor_user_id
       and v_member.role = 'owner'
       and v_role <> 'owner'
    then
        raise exception using
            errcode = '42501',
            message =
                'Use the ownership transfer workflow to change your own owner role';
    end if;

    if v_member.role = 'owner'
       and v_role <> 'owner'
       and (
            select pg_catalog.count(*)
            from public.household_members owner_member
            where owner_member.household_id = p_household_id
              and owner_member.role = 'owner'
       ) <= 1
    then
        raise exception using
            errcode = '23514',
            message = 'A household must retain at least one owner';
    end if;

    update public.household_members member
    set role = v_role
    where member.id = v_member.id;

    insert into private.household_membership_events (
        household_id,
        membership_id,
        member_user_id,
        actor_user_id,
        event_type,
        previous_role,
        new_role,
        created_at
    )
    values (
        p_household_id,
        v_member.id,
        v_member.user_id,
        v_actor_user_id,
        'role_changed',
        v_member.role,
        v_role,
        v_changed_at
    );

    return query
    select
        v_member.id,
        v_member.user_id,
        v_member.role,
        v_role,
        v_changed_at;
end;
$$;

comment on function public.update_household_member_role(uuid, uuid, text) is
    'Owner-only role change for another current membership, serialized per household and audited.';

revoke all
on function public.update_household_member_role(uuid, uuid, text)
from public, anon;

grant execute
on function public.update_household_member_role(uuid, uuid, text)
to authenticated;


create function public.revoke_household_member(
    p_household_id uuid,
    p_membership_id uuid
)
returns table (
    membership_id uuid,
    member_user_id uuid,
    former_role text,
    revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := (select auth.uid());
    v_member public.household_members%rowtype;
    v_revoked_at timestamptz := now();
begin
    if p_household_id is null then
        raise exception using
            errcode = '22023',
            message = 'household_id is required';
    end if;

    if p_membership_id is null then
        raise exception using
            errcode = '22023',
            message = 'membership_id is required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_household_id::text, 0)
    );

    perform private.require_household_owner(p_household_id);

    select member.*
    into v_member
    from public.household_members member
    where member.id = p_membership_id
      and member.household_id = p_household_id
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Household membership was not found';
    end if;

    if v_member.user_id = v_actor_user_id then
        raise exception using
            errcode = '42501',
            message =
                'Use the leaving or ownership transfer workflow to remove your own membership';
    end if;

    if v_member.role = 'owner'
       and (
            select pg_catalog.count(*)
            from public.household_members owner_member
            where owner_member.household_id = p_household_id
              and owner_member.role = 'owner'
       ) <= 1
    then
        raise exception using
            errcode = '23514',
            message = 'A household must retain at least one owner';
    end if;

    update public.devices device
    set revoked_at = v_revoked_at
    where device.household_id = p_household_id
      and device.user_id = v_member.user_id
      and device.revoked_at is null;

    delete from public.household_wine_observations observation
    where observation.household_id = p_household_id
      and observation.recorded_by = v_member.user_id
      and observation.visibility = 'personal';

    insert into private.household_membership_events (
        household_id,
        membership_id,
        member_user_id,
        actor_user_id,
        event_type,
        previous_role,
        new_role,
        created_at
    )
    values (
        p_household_id,
        v_member.id,
        v_member.user_id,
        v_actor_user_id,
        'revoked',
        v_member.role,
        null,
        v_revoked_at
    );

    delete from public.household_members member
    where member.id = v_member.id;

    return query
    select
        v_member.id,
        v_member.user_id,
        v_member.role,
        v_revoked_at;
end;
$$;

comment on function public.revoke_household_member(uuid, uuid) is
    'Owner-only revocation of another membership. Invalidates devices, removes private per-household data, and preserves shared history.';

revoke all
on function public.revoke_household_member(uuid, uuid)
from public, anon;

grant execute
on function public.revoke_household_member(uuid, uuid)
to authenticated;

commit;
