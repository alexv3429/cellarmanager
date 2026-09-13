begin;

-- This private record is separate from the immutable stock journal: a stopped
-- new-wine ADD must not create a catalog wine just to satisfy a journal FK.
create table private.stopped_inventory_uploads (
    operation_id uuid primary key,
    household_id uuid not null,
    user_id uuid not null,
    device_id uuid not null,
    request jsonb not null check (jsonb_typeof(request) = 'object' and octet_length(request::text) <= 8192),
    stopped_at timestamptz not null default now()
);
create index stopped_inventory_uploads_user_household_idx
    on private.stopped_inventory_uploads(user_id, household_id, stopped_at desc);
alter table private.stopped_inventory_uploads enable row level security;
revoke all on private.stopped_inventory_uploads from public, anon, authenticated;

create function private.inventory_upload_was_stopped(p_operation_id uuid, p_household_id uuid, p_device_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_stop private.stopped_inventory_uploads%rowtype;
begin
    select * into v_stop from private.stopped_inventory_uploads where operation_id = p_operation_id;
    if not found then return false; end if;
    if v_stop.user_id is distinct from (select auth.uid())
       or v_stop.household_id is distinct from p_household_id
       or v_stop.device_id is distinct from p_device_id then
        raise exception using errcode = '42501', message = 'This inventory request belongs to another account or registration';
    end if;
    return true;
end;
$$;
revoke all on function private.inventory_upload_was_stopped(uuid,uuid,uuid) from public, anon, authenticated;

create function public.stop_inventory_upload(p_operation_id uuid, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_device_id uuid;
    v_operation public.inventory_operations%rowtype;
    v_stop private.stopped_inventory_uploads%rowtype;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    if p_operation_id is null or p_request is null or jsonb_typeof(p_request) <> 'object'
       or octet_length(p_request::text) > 8192 then
        raise exception using errcode = '22023', message = 'A bounded original inventory request is required';
    end if;
    v_household_id := (p_request->>'household_id')::uuid;
    v_device_id := (p_request->>'device_id')::uuid;
    if (p_request->>'id')::uuid is distinct from p_operation_id
       or (p_request->>'user_id')::uuid is distinct from v_user_id
       or v_household_id is null or v_device_id is null
       or (p_request->>'wine_id')::uuid is null
       or coalesce(p_request->>'operation_type', '') not in ('ADD', 'MOVE', 'REMOVE')
       or coalesce((p_request->>'quantity')::integer, 0) <= 0
       or (p_request->>'created_at_client')::timestamptz is null then
        raise exception using errcode = '22023', message = 'The original request identity and quantity are required';
    end if;
    -- Same order as stock acceptance and membership/device changes. Holding
    -- both locks closes the accepted-but-response-lost and in-flight races.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_household_id::text, 0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text, 0));
    if not exists (select 1 from public.devices d where d.id = v_device_id
        and d.household_id = v_household_id and d.user_id = v_user_id) then
        raise exception using errcode = '42501', message = 'Only the originating account can stop this upload';
    end if;
    -- No active membership/device requirement: a removed or demoted member
    -- must be able to stop their own old queue, but cannot read anyone else's.
    select * into v_operation from public.inventory_operations where id = p_operation_id;
    if found then
        if v_operation.user_id <> v_user_id or v_operation.device_id <> v_device_id
           or v_operation.household_id <> v_household_id then
            raise exception using errcode = '42501', message = 'Only the originating account can stop this upload';
        end if;
        -- Do not use an old receipt to silently acknowledge a different stock
        -- intent. New-wine ADD may have resolved to an existing canonical UUID;
        -- in that case compare the immutable journal's resolved wine identity.
        if v_operation.operation_type is distinct from p_request->>'operation_type'
           or v_operation.quantity is distinct from (p_request->>'quantity')::integer
           or v_operation.source_location_id is distinct from (p_request->>'source_location_id')::uuid
           or v_operation.destination_location_id is distinct from (p_request->>'destination_location_id')::uuid
           or v_operation.remove_reason is distinct from nullif(upper(trim(p_request->>'remove_reason')), '')
           or (v_operation.wine_id is distinct from (p_request->>'wine_id')::uuid and not (
               v_operation.operation_type = 'ADD' and v_operation.wine_producer is not null
               and private.normalized_wine_merge_text(v_operation.wine_producer) = private.normalized_wine_merge_text(p_request->>'wine_producer')
               and private.normalized_wine_merge_text(v_operation.wine_cuvee) = private.normalized_wine_merge_text(p_request->>'wine_cuvee')
               and v_operation.wine_vintage is not distinct from (p_request->>'wine_vintage')::integer
               and v_operation.wine_color is not distinct from lower(trim(p_request->>'wine_color'))
               and v_operation.wine_format_ml is not distinct from (p_request->>'wine_format_ml')::integer
           )) then
            raise exception using errcode = '22023', message = 'operation_id was reused with a different payload';
        end if;
        return jsonb_build_object('operation_id', p_operation_id, 'household_id', v_household_id,
            'user_id', v_user_id, 'device_id', v_device_id, 'status', v_operation.status,
            'error_code', v_operation.error_code);
    end if;
    select * into v_stop from private.stopped_inventory_uploads where operation_id = p_operation_id;
    if found then
        perform private.inventory_upload_was_stopped(p_operation_id, v_household_id, v_device_id);
        if (v_stop.request - array['wine_label','household_label','device_label','source_label','destination_label'])
           is distinct from (p_request - array['wine_label','household_label','device_label','source_label','destination_label']) then
            raise exception using errcode = '22023', message = 'A stopped request cannot be rewritten';
        end if;
    else
        if (select count(*) from private.stopped_inventory_uploads where user_id = v_user_id
            and stopped_at > now() - interval '1 day') >= 1000 then
            raise exception using errcode = '54000', message = 'Daily upload-stop limit reached';
        end if;
        insert into private.stopped_inventory_uploads(operation_id, household_id, user_id, device_id, request)
        values (p_operation_id, v_household_id, v_user_id, v_device_id, p_request);
    end if;
    return jsonb_build_object('operation_id', p_operation_id, 'household_id', v_household_id,
        'user_id', v_user_id, 'device_id', v_device_id, 'status', 'STOPPED', 'error_code', 'USER_CANCELLED');
end;
$$;

create function public.get_stopped_inventory_uploads(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    if (select auth.uid()) is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    return coalesce((select jsonb_agg(to_jsonb(s) order by s.stopped_at desc, s.operation_id)
        from (select operation_id, household_id, user_id, device_id, request, stopped_at
            from private.stopped_inventory_uploads where user_id = (select auth.uid())
            and (p_household_id is null or household_id = p_household_id) order by stopped_at desc, operation_id limit 100) s), '[]'::jsonb);
end;
$$;
revoke all on function public.stop_inventory_upload(uuid,jsonb), public.get_stopped_inventory_uploads(uuid) from public, anon;
grant execute on function public.stop_inventory_upload(uuid,jsonb), public.get_stopped_inventory_uploads(uuid) to authenticated;

-- Preserve the existing Owner/active-device checks in non-callable facades.
alter function public.apply_inventory_operation(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text) set schema private;
alter function private.apply_inventory_operation(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text) rename to apply_inventory_operation_before_stop;
revoke all on function private.apply_inventory_operation_before_stop(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text) from public, anon, authenticated;

create function public.apply_inventory_operation(
    p_operation_id uuid, p_household_id uuid, p_device_id uuid, p_operation_type text, p_wine_id uuid,
    p_source_location_id uuid, p_destination_location_id uuid default null, p_quantity integer default 1,
    p_created_at_client timestamptz default now(), p_remove_reason text default null
)
returns table(operation_id uuid, operation_status text, operation_error_code text, operation_error_message text)
language plpgsql security definer set search_path = '' as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text, 0));
    if private.inventory_upload_was_stopped(p_operation_id, p_household_id, p_device_id) then
        return query select p_operation_id, 'REJECTED'::text, 'USER_CANCELLED'::text, 'The originating user stopped this request before acceptance'::text;
        return;
    end if;
    return query select * from private.apply_inventory_operation_before_stop(p_operation_id, p_household_id, p_device_id,
        p_operation_type, p_wine_id, p_source_location_id, p_destination_location_id, p_quantity, p_created_at_client, p_remove_reason);
end;
$$;

alter function public.apply_add_inventory_operation(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz) set schema private;
alter function private.apply_add_inventory_operation(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz) rename to apply_add_inventory_operation_before_stop;
revoke all on function private.apply_add_inventory_operation_before_stop(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz) from public, anon, authenticated;

create function public.apply_add_inventory_operation(
    p_operation_id uuid, p_household_id uuid, p_device_id uuid, p_requested_wine_id uuid,
    p_wine_producer text, p_wine_cuvee text, p_wine_vintage integer, p_wine_color text,
    p_wine_appellation text, p_wine_area text, p_wine_format_ml integer, p_destination_location_id uuid,
    p_quantity integer default 1, p_created_at_client timestamptz default now()
)
returns table(operation_id uuid, operation_status text, operation_error_code text, operation_error_message text)
language plpgsql security definer set search_path = '' as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text, 0));
    if private.inventory_upload_was_stopped(p_operation_id, p_household_id, p_device_id) then
        return query select p_operation_id, 'REJECTED'::text, 'USER_CANCELLED'::text, 'The originating user stopped this request before acceptance'::text;
        return;
    end if;
    return query select * from private.apply_add_inventory_operation_before_stop(p_operation_id, p_household_id, p_device_id,
        p_requested_wine_id, p_wine_producer, p_wine_cuvee, p_wine_vintage, p_wine_color, p_wine_appellation,
        p_wine_area, p_wine_format_ml, p_destination_location_id, p_quantity, p_created_at_client);
end;
$$;
revoke all on function public.apply_inventory_operation(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text),
    public.apply_add_inventory_operation(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz) from public, anon;
grant execute on function public.apply_inventory_operation(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,timestamptz,text),
    public.apply_add_inventory_operation(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,integer,uuid,integer,timestamptz) to authenticated;
commit;
