begin;

-- Import receipts make an online bulk commit safely retryable. The payload is
-- retained only for server-side idempotency checks and is never exposed as a
-- browser-readable table.
create table private.csv_import_receipts (
    id uuid primary key,
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    device_id uuid not null,
    user_id uuid not null,
    payload jsonb not null,
    imported_row_count integer not null
        check (imported_row_count > 0),
    imported_bottle_count bigint not null
        check (imported_bottle_count > 0),
    created_wine_count integer not null
        check (created_wine_count >= 0),
    reused_wine_count integer not null
        check (reused_wine_count >= 0),
    committed_at timestamptz not null default now(),

    constraint csv_import_receipts_device_fk
        foreign key (device_id, household_id, user_id)
        references public.devices(id, household_id, user_id)
);

create index csv_import_receipts_household_id_idx
on private.csv_import_receipts (household_id);

revoke all privileges
on table private.csv_import_receipts
from public, anon, authenticated;

create function public.commit_csv_import(
    p_import_id uuid,
    p_household_id uuid,
    p_device_id uuid,
    p_rows jsonb,
    p_created_at_client timestamptz default now()
)
returns table (
    import_id uuid,
    imported_row_count integer,
    imported_bottle_count bigint,
    created_wine_count integer,
    reused_wine_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_payload jsonb;
    v_receipt private.csv_import_receipts%rowtype;
    v_row jsonb;
    v_row_index integer := 0;
    v_record_number integer;
    v_operation_id uuid;
    v_requested_wine_id uuid;
    v_destination_location_id uuid;
    v_quantity integer;
    v_wine_action text;
    v_wine_producer text;
    v_wine_cuvee text;
    v_wine_vintage integer;
    v_wine_color text;
    v_wine_appellation text;
    v_wine_area text;
    v_wine_format_ml integer;
    v_operation_status text;
    v_operation_error_code text;
    v_operation_error_message text;
    v_actual_wine_id uuid;
    v_requested_wine_existed boolean;
    v_seen_record_numbers integer[] := array[]::integer[];
    v_seen_operation_ids uuid[] := array[]::uuid[];
    v_created_requested_wine_ids uuid[] := array[]::uuid[];
    v_created_actual_wine_ids uuid[] := array[]::uuid[];
    v_reused_wine_ids uuid[] := array[]::uuid[];
    v_imported_bottle_count bigint := 0;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if p_import_id is null then
        raise exception using
            errcode = '22023',
            message = 'import_id is required';
    end if;

    if p_created_at_client is null then
        raise exception using
            errcode = '22023',
            message = 'created_at_client is required';
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

    if p_rows is null
       or pg_catalog.jsonb_typeof(p_rows) is distinct from 'array'
    then
        raise exception using
            errcode = '22023',
            message = 'Import rows must be a JSON array';
    end if;

    if pg_catalog.jsonb_array_length(p_rows) = 0 then
        raise exception using
            errcode = '22023',
            message = 'Import must contain at least one row';
    end if;

    if pg_catalog.jsonb_array_length(p_rows) > 100000 then
        raise exception using
            errcode = '22023',
            message = 'Import cannot contain more than 100000 rows';
    end if;

    v_payload := pg_catalog.jsonb_build_object(
        'created_at_client', p_created_at_client,
        'rows', p_rows
    );

    -- A retry with the same receipt waits for any concurrent first attempt and
    -- then returns that committed result. Reusing the receipt for another
    -- payload is rejected.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_import_id::text, 0)
    );

    select receipt.*
    into v_receipt
    from private.csv_import_receipts receipt
    where receipt.id = p_import_id;

    if found then
        if v_receipt.household_id is distinct from p_household_id
           or v_receipt.device_id is distinct from p_device_id
           or v_receipt.user_id is distinct from v_user_id
           or v_receipt.payload is distinct from v_payload
        then
            raise exception using
                errcode = '22023',
                message = 'import_id was reused with a different payload';
        end if;

        return query
        select
            v_receipt.id,
            v_receipt.imported_row_count,
            v_receipt.imported_bottle_count,
            v_receipt.created_wine_count,
            v_receipt.reused_wine_count;
        return;
    end if;

    for v_row in
        select item.value
        from pg_catalog.jsonb_array_elements(p_rows) as item(value)
    loop
        v_row_index := v_row_index + 1;

        if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
           or not (
               v_row ?& array[
                   'record_number',
                   'operation_id',
                   'requested_wine_id',
                   'destination_location_id',
                   'quantity',
                   'wine_action',
                   'wine_producer',
                   'wine_cuvee',
                   'wine_vintage',
                   'wine_color',
                   'wine_appellation',
                   'wine_area',
                   'wine_format_ml'
               ]
           )
        then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s is incomplete',
                    v_row_index
                );
        end if;

        begin
            v_record_number := (v_row ->> 'record_number')::integer;
            v_operation_id := (v_row ->> 'operation_id')::uuid;
            v_requested_wine_id :=
                (v_row ->> 'requested_wine_id')::uuid;
            v_destination_location_id :=
                (v_row ->> 'destination_location_id')::uuid;
            v_quantity := (v_row ->> 'quantity')::integer;
            v_wine_action := pg_catalog.lower(
                pg_catalog.btrim(v_row ->> 'wine_action')
            );
            v_wine_producer := v_row ->> 'wine_producer';
            v_wine_cuvee := v_row ->> 'wine_cuvee';
            v_wine_vintage := (v_row ->> 'wine_vintage')::integer;
            v_wine_color := v_row ->> 'wine_color';
            v_wine_appellation := v_row ->> 'wine_appellation';
            v_wine_area := v_row ->> 'wine_area';
            v_wine_format_ml := (v_row ->> 'wine_format_ml')::integer;
        exception
            when invalid_text_representation
                or numeric_value_out_of_range
            then
                raise exception using
                    errcode = '22023',
                    message = pg_catalog.format(
                        'Import row %s contains an invalid typed value',
                        v_row_index
                    );
        end;

        if v_record_number is null or v_record_number <= 0 then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s has an invalid source record number',
                    v_row_index
                );
        end if;

        if v_record_number = any(v_seen_record_numbers) then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Source record %s appears more than once',
                    v_record_number
                );
        end if;
        v_seen_record_numbers := pg_catalog.array_append(
            v_seen_record_numbers,
            v_record_number
        );

        if v_operation_id is null then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s has no operation ID',
                    v_record_number
                );
        end if;

        if v_operation_id = any(v_seen_operation_ids)
           or exists (
               select 1
               from public.inventory_operations operation
               where operation.id = v_operation_id
           )
        then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s uses an existing operation ID',
                    v_record_number
                );
        end if;
        v_seen_operation_ids := pg_catalog.array_append(
            v_seen_operation_ids,
            v_operation_id
        );

        if v_wine_action not in ('create', 'reuse') then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s has an invalid wine action',
                    v_record_number
                );
        end if;

        select exists (
            select 1
            from public.wines wine
            where wine.id = v_requested_wine_id
        )
        into v_requested_wine_existed;

        if v_wine_action = 'reuse'
           and not v_requested_wine_existed
        then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s references a missing existing wine',
                    v_record_number
                );
        end if;

        if v_wine_action = 'create'
           and v_requested_wine_existed
           and not (
               v_requested_wine_id = any(
                   v_created_requested_wine_ids
               )
           )
        then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s cannot create an existing wine ID',
                    v_record_number
                );
        end if;

        select
            result.operation_status,
            result.operation_error_code,
            result.operation_error_message
        into
            v_operation_status,
            v_operation_error_code,
            v_operation_error_message
        from public.apply_add_inventory_operation(
            v_operation_id,
            p_household_id,
            p_device_id,
            v_requested_wine_id,
            v_wine_producer,
            v_wine_cuvee,
            v_wine_vintage,
            v_wine_color,
            v_wine_appellation,
            v_wine_area,
            v_wine_format_ml,
            v_destination_location_id,
            v_quantity,
            p_created_at_client
        ) as result;

        if v_operation_status is distinct from 'ACCEPTED' then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s was rejected: %s',
                    v_record_number,
                    coalesce(
                        v_operation_error_message,
                        v_operation_error_code,
                        'unknown inventory error'
                    )
                );
        end if;

        select operation.wine_id
        into v_actual_wine_id
        from public.inventory_operations operation
        where operation.id = v_operation_id;

        if v_actual_wine_id is null then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s has no committed catalog reference',
                    v_record_number
                );
        end if;

        if v_wine_action = 'create'
           and not v_requested_wine_existed
           and v_actual_wine_id = v_requested_wine_id
        then
            if not (
                v_actual_wine_id = any(v_created_actual_wine_ids)
            ) then
                v_created_actual_wine_ids := pg_catalog.array_append(
                    v_created_actual_wine_ids,
                    v_actual_wine_id
                );
            end if;

            if not (
                v_requested_wine_id = any(
                    v_created_requested_wine_ids
                )
            ) then
                v_created_requested_wine_ids := pg_catalog.array_append(
                    v_created_requested_wine_ids,
                    v_requested_wine_id
                );
            end if;
        elsif not (
            v_actual_wine_id = any(v_created_actual_wine_ids)
        ) and not (
            v_actual_wine_id = any(v_reused_wine_ids)
        ) then
            v_reused_wine_ids := pg_catalog.array_append(
                v_reused_wine_ids,
                v_actual_wine_id
            );
        end if;

        v_imported_bottle_count :=
            v_imported_bottle_count + v_quantity;
    end loop;

    insert into private.csv_import_receipts (
        id,
        household_id,
        device_id,
        user_id,
        payload,
        imported_row_count,
        imported_bottle_count,
        created_wine_count,
        reused_wine_count
    )
    values (
        p_import_id,
        p_household_id,
        p_device_id,
        v_user_id,
        v_payload,
        v_row_index,
        v_imported_bottle_count,
        pg_catalog.cardinality(v_created_actual_wine_ids),
        pg_catalog.cardinality(v_reused_wine_ids)
    );

    return query
    select
        p_import_id,
        v_row_index,
        v_imported_bottle_count,
        pg_catalog.cardinality(v_created_actual_wine_ids),
        pg_catalog.cardinality(v_reused_wine_ids);
end;
$$;

create function public.get_csv_import_receipt(
    p_import_id uuid,
    p_household_id uuid
)
returns table (
    import_id uuid,
    imported_row_count integer,
    imported_bottle_count bigint,
    created_wine_count integer,
    reused_wine_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'User is not a member of this household';
    end if;

    if p_import_id is null then
        raise exception using
            errcode = '22023',
            message = 'import_id is required';
    end if;

    -- Wait for a possibly still-running commit with this ID. Once acquired,
    -- a missing receipt proves that transaction finished without committing.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_import_id::text, 0)
    );

    return query
    select
        receipt.id,
        receipt.imported_row_count,
        receipt.imported_bottle_count,
        receipt.created_wine_count,
        receipt.reused_wine_count
    from private.csv_import_receipts receipt
    where receipt.id = p_import_id
      and receipt.household_id = p_household_id
      and receipt.user_id = v_user_id;
end;
$$;

revoke all
on function public.commit_csv_import(
    uuid,
    uuid,
    uuid,
    jsonb,
    timestamptz
)
from public, anon;

grant execute
on function public.commit_csv_import(
    uuid,
    uuid,
    uuid,
    jsonb,
    timestamptz
)
to authenticated;

revoke all
on function public.get_csv_import_receipt(uuid, uuid)
from public, anon;

grant execute
on function public.get_csv_import_receipt(uuid, uuid)
to authenticated;

commit;
