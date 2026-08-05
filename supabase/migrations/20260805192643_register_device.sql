begin;

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
    v_name text := trim(p_name);
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

    if v_name is null or length(v_name) = 0 then
        raise exception using
            errcode = '22023',
            message = 'Device name is required';
    end if;

    if length(v_name) > 120 then
        raise exception using
            errcode = '22023',
            message = 'Device name must not exceed 120 characters';
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

    -- Serialize simultaneous registration attempts for the same UUID.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_device_id::text, 0)
    );

    select d.*
    into v_existing
    from public.devices d
    where d.id = p_device_id;

    if found then
        if v_existing.household_id is distinct from p_household_id
           or v_existing.user_id is distinct from v_user_id
        then
            raise exception using
                errcode = '42501',
                message =
                    'Device identifier is already registered to another user or household';
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
        d.id,
        d.household_id,
        d.user_id,
        d.name,
        d.created_at,
        d.last_seen_at
    from public.devices d
    where d.id = p_device_id;
end;
$$;

revoke all
on function public.register_device(uuid, uuid, text)
from public;

revoke all
on function public.register_device(uuid, uuid, text)
from anon;

grant execute
on function public.register_device(uuid, uuid, text)
to authenticated;

commit;
