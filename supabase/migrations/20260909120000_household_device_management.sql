-- Device registrations authorize inventory uploads, not authentication sessions.
-- Never delete or revive a registration referenced by immutable stock history.
create table private.household_device_events (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households(id) on delete cascade,
    device_id uuid not null references public.devices(id),
    actor_user_id uuid not null,
    event_type text not null check (event_type in ('renamed', 'revoked')),
    previous_name text not null,
    device_name text not null,
    created_at timestamptz not null default now()
);
revoke all on private.household_device_events from public, anon, authenticated;
alter table private.household_device_events enable row level security;

-- Registration must serialize with member removal and device revocation, just
-- like Owner-only stock uploads. Preserve the existing registration contract.
alter function public.register_device(uuid, uuid, text) set schema private;
alter function private.register_device(uuid, uuid, text) rename to register_device_unlocked;
revoke all on function private.register_device_unlocked(uuid, uuid, text) from public, anon, authenticated;

create function public.register_device(p_device_id uuid, p_household_id uuid, p_name text)
returns table (device_id uuid, device_household_id uuid, device_user_id uuid,
    device_name text, device_created_at timestamptz, device_last_seen_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    return query select * from private.register_device_unlocked(p_device_id, p_household_id, p_name);
end;
$$;

create function public.get_household_devices(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_role text := private.require_household_member(p_household_id);
    v_user_id uuid := (select auth.uid());
begin
    return pg_catalog.jsonb_build_object(
        'household_id', p_household_id, 'user_id', v_user_id, 'role', v_role,
        'devices', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', d.id, 'user_id', d.user_id, 'name', d.name,
            'account_label', coalesce(nullif(pg_catalog.btrim(coalesce(
                u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ''),
                u.email::text, 'Account ' || pg_catalog.left(d.user_id::text, 8)),
            'created_at', d.created_at, 'last_seen_at', d.last_seen_at, 'revoked_at', d.revoked_at
        ) order by d.revoked_at nulls first, d.created_at desc, d.id)
        from public.devices d join auth.users u on u.id = d.user_id
        where d.household_id = p_household_id and (v_role = 'owner' or d.user_id = v_user_id)), '[]'::jsonb)
    );
end;
$$;

create function public.manage_household_device(p_household_id uuid, p_device_id uuid, p_action text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_role text;
    v_device public.devices%rowtype;
    v_name text := pg_catalog.btrim(p_name);
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    v_role := private.require_household_member(p_household_id);
    select * into v_device from public.devices d
        where d.id = p_device_id and d.household_id = p_household_id for update;
    if not found or (v_role <> 'owner' and v_device.user_id <> (select auth.uid())) then
        raise exception using errcode = '42501', message = 'Device is not available for this account and household';
    end if;
    if p_action is null or p_action not in ('rename', 'revoke') then
        raise exception using errcode = '22023', message = 'Choose rename or revoke';
    end if;
    if p_action = 'rename' then
        if v_device.revoked_at is not null then
            raise exception using errcode = '55000', message = 'A revoked registration cannot be renamed';
        end if;
        if v_name is null or pg_catalog.length(v_name) not between 1 and 120 then
            raise exception using errcode = '22023', message = 'Device name must contain 1 to 120 characters';
        end if;
        if v_name <> v_device.name then
            update public.devices set name = v_name where id = p_device_id;
            insert into private.household_device_events(household_id, device_id, actor_user_id, event_type, previous_name, device_name)
                values (p_household_id, p_device_id, (select auth.uid()), 'renamed', v_device.name, v_name);
        end if;
    elsif v_device.revoked_at is null then
        update public.devices set revoked_at = now() where id = p_device_id;
        insert into private.household_device_events(household_id, device_id, actor_user_id, event_type, previous_name, device_name)
            values (p_household_id, p_device_id, (select auth.uid()), 'revoked', v_device.name, v_device.name);
    end if;
    return (select pg_catalog.jsonb_build_object('id', d.id, 'name', d.name, 'revoked_at', d.revoked_at)
        from public.devices d where d.id = p_device_id);
end;
$$;

revoke all on function public.register_device(uuid, uuid, text),
    public.get_household_devices(uuid), public.manage_household_device(uuid, uuid, text, text) from public, anon;
grant execute on function public.register_device(uuid, uuid, text),
    public.get_household_devices(uuid), public.manage_household_device(uuid, uuid, text, text) to authenticated;

comment on function public.manage_household_device(uuid, uuid, text, text) is
    'Online device-registration management: Members manage their own; Owners manage all in the household. Not a session sign-out or remote wipe.';
