begin;

-- Members read the shared cellar. Only Owners mutate stock, including legacy
-- clients and operations queued before a role change. Preserve the existing
-- validation/idempotency implementations behind non-callable private facades.
alter function public.apply_inventory_operation(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text)
    set schema private;
alter function private.apply_inventory_operation(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text)
    rename to apply_inventory_operation_owner_unchecked;
revoke all on function private.apply_inventory_operation_owner_unchecked(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text)
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
returns table (operation_id uuid, operation_status text,
    operation_error_code text, operation_error_message text)
language plpgsql security definer set search_path = ''
as $$
begin
    -- Same household lock as membership role changes/removal. Once demotion
    -- wins, no in-flight or queued stock write can use the old Owner role.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_household_id::text, 0));
    perform private.require_household_owner(p_household_id);
    return query select * from private.apply_inventory_operation_owner_unchecked(
        p_operation_id, p_household_id, p_device_id, p_operation_type,
        p_wine_id, p_source_location_id, p_destination_location_id,
        p_quantity, p_created_at_client, p_remove_reason);
end;
$$;
revoke all on function public.apply_inventory_operation(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text)
    from public, anon;
grant execute on function public.apply_inventory_operation(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text)
    to authenticated;

alter function public.apply_add_inventory_operation(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz)
    set schema private;
alter function private.apply_add_inventory_operation(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz)
    rename to apply_add_inventory_operation_owner_unchecked;
revoke all on function private.apply_add_inventory_operation_owner_unchecked(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz)
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
returns table (operation_id uuid, operation_status text,
    operation_error_code text, operation_error_message text)
language plpgsql security definer set search_path = ''
as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_household_id::text, 0));
    perform private.require_household_owner(p_household_id);
    return query select * from private.apply_add_inventory_operation_owner_unchecked(
        p_operation_id, p_household_id, p_device_id, p_requested_wine_id,
        p_wine_producer, p_wine_cuvee, p_wine_vintage, p_wine_color,
        p_wine_appellation, p_wine_area, p_wine_format_ml,
        p_destination_location_id, p_quantity, p_created_at_client);
end;
$$;
revoke all on function public.apply_add_inventory_operation(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz)
    from public, anon;
grant execute on function public.apply_add_inventory_operation(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz)
    to authenticated;

-- The old 10-argument ADD overload delegates to the guarded 14-argument RPC.
-- No catalog or stock rows, user accounts, or device registrations are changed.
create or replace function public.get_household_permissions(p_household_id uuid)
returns table (
    household_id uuid, household_role text, can_manage_inventory boolean,
    can_import_inventory boolean, can_manage_catalog boolean,
    can_manage_cellar_setup boolean, can_manage_household_guidance boolean,
    can_manage_shared_knowledge boolean, can_manage_members boolean,
    can_manage_own_devices boolean, can_manage_household_devices boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_role text;
    v_is_owner boolean;
begin
    v_role := private.require_household_member(p_household_id);
    v_is_owner := v_role = 'owner';
    return query select p_household_id, v_role,
        v_is_owner, v_is_owner, v_is_owner, v_is_owner, v_is_owner,
        v_is_owner, v_is_owner, true, v_is_owner;
end;
$$;

commit;
