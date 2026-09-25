begin;

-- Zero means catalog only, never ADD(0), a zero holding, or removal of stock.
-- Existing receipts and inventory remain unchanged.
alter table private.csv_import_receipts
    drop constraint csv_import_receipts_imported_bottle_count_check;
alter table private.csv_import_receipts
    add constraint csv_import_receipts_imported_bottle_count_check
    check (imported_bottle_count >= 0);

create function private.resolve_csv_catalog_wine(
    p_household_id uuid, p_requested_wine_id uuid,
    p_producer text, p_cuvee text, p_vintage integer, p_color text,
    p_appellation text, p_area text, p_format_ml integer
)
returns uuid
language plpgsql set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_matches uuid[];
    v_producer text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_producer, '')), '[[:space:]]+', ' ', 'g');
    v_cuvee text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_cuvee, '')), '[[:space:]]+', ' ', 'g');
    v_color text := private.normalized_wine_merge_text(p_color);
begin
    if p_requested_wine_id is null or v_producer = '' or v_cuvee = '' or v_color = ''
       or p_format_ml is null or p_format_ml <= 0
       or (p_vintage is not null and p_vintage not between 1800 and 2200) then
        raise exception using errcode = '22023', message = 'Catalog-only row has an invalid wine identity';
    end if;

    -- Use the same semantic identity as stock imports. The caller already holds
    -- the household lock; this identity lock also coordinates with catalog edits.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        p_household_id::text || '|' || pg_catalog.lower(v_producer) || '|' ||
        pg_catalog.lower(v_cuvee) || '|' || coalesce(p_vintage::text, 'NV') ||
        '|' || v_color || '|' || p_format_ml::text, 0));

    select * into v_wine from public.wines where id = p_requested_wine_id;
    if found then
        if v_wine.household_id is distinct from p_household_id
           or v_wine.merged_into_wine_id is not null
           or private.normalized_wine_merge_text(v_wine.producer) is distinct from pg_catalog.lower(v_producer)
           or private.normalized_wine_merge_text(v_wine.cuvee) is distinct from pg_catalog.lower(v_cuvee)
           or v_wine.vintage is distinct from p_vintage
           or private.normalized_wine_merge_text(v_wine.color) is distinct from v_color
           or v_wine.format_ml is distinct from p_format_ml then
            raise exception using errcode = '22023', message = 'Requested catalog wine does not match the household and active wine identity';
        end if;
        return v_wine.id;
    end if;

    select pg_catalog.array_agg(w.id) into v_matches
    from public.wines w
    where w.household_id = p_household_id and w.merged_into_wine_id is null
      and private.normalized_wine_merge_text(w.producer) = pg_catalog.lower(v_producer)
      and private.normalized_wine_merge_text(w.cuvee) = pg_catalog.lower(v_cuvee)
      and w.vintage is not distinct from p_vintage
      and private.normalized_wine_merge_text(w.color) = v_color and w.format_ml = p_format_ml;
    if pg_catalog.cardinality(v_matches) > 1 then
        raise exception using errcode = '22023', message = 'Wine identity is ambiguous; select an existing catalog wine explicitly';
    elsif pg_catalog.cardinality(v_matches) = 1 then
        return v_matches[1];
    end if;

    insert into public.wines(id, household_id, producer, cuvee, vintage, color, appellation, area, format_ml)
    values (p_requested_wine_id, p_household_id, v_producer, v_cuvee, p_vintage, v_color,
        nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_appellation, '')), '[[:space:]]+', ' ', 'g'), ''),
        nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_area, '')), '[[:space:]]+', ' ', 'g'), ''),
        p_format_ml);
    return p_requested_wine_id;
end;
$$;

revoke all on function private.resolve_csv_catalog_wine(uuid,uuid,text,text,integer,text,text,text,integer)
from public, anon, authenticated;

create or replace function private.commit_csv_import_unchecked(
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

    -- Serialize with membership/device changes and stock operations, then recheck authority.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    perform private.require_household_owner(p_household_id);

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
          and d.revoked_at is null
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

        if v_wine_action is null or v_wine_action not in ('create', 'reuse') then
            raise exception using
                errcode = '22023',
                message = pg_catalog.format(
                    'Import row %s has an invalid wine action',
                    v_record_number
                );
        end if;

        if v_quantity is null or v_quantity < 0 then
            raise exception using errcode = '22023', message = 'Quantity must be a whole number of zero or more';
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

        if v_quantity = 0 then
            if v_destination_location_id is not null then
                raise exception using errcode = '22023', message = 'Catalog-only rows must not specify a destination';
            end if;
            v_actual_wine_id := private.resolve_csv_catalog_wine(
                p_household_id, v_requested_wine_id, v_wine_producer, v_wine_cuvee,
                v_wine_vintage, v_wine_color, v_wine_appellation, v_wine_area, v_wine_format_ml
            );
        else
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

        end if;

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

-- Keep the existing public owner-only facade and private implementation ACLs.
revoke all on function private.commit_csv_import_unchecked(uuid,uuid,uuid,jsonb,timestamptz)
from public, anon, authenticated;

commit;
