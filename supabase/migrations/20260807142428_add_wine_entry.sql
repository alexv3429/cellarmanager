begin;

alter table public.inventory_operations
    add column wine_producer text,
    add column wine_cuvee text,
    add column wine_vintage integer;

alter table public.inventory_operations
    add constraint inventory_operations_wine_producer_check
        check (
            wine_producer is null
            or length(trim(wine_producer)) > 0
        ),
    add constraint inventory_operations_wine_cuvee_check
        check (
            wine_cuvee is null
            or length(trim(wine_cuvee)) > 0
        ),
    add constraint inventory_operations_wine_vintage_check
        check (
            wine_vintage is null
            or wine_vintage between 1800 and 2200
        ),
    add constraint inventory_operations_wine_identity_shape_check
        check (
            (
                operation_type = 'ADD'
                and (
                    (
                        wine_producer is null
                        and wine_cuvee is null
                        and wine_vintage is null
                    )
                    or (
                        wine_producer is not null
                        and wine_cuvee is not null
                    )
                )
            )
            or (
                operation_type in ('MOVE', 'REMOVE')
                and wine_producer is null
                and wine_cuvee is null
                and wine_vintage is null
            )
        );

create unique index wines_household_normalized_identity_unique
on public.wines (
    household_id,
    lower(
        regexp_replace(
            trim(producer),
            '[[:space:]]+',
            ' ',
            'g'
        )
    ),
    lower(
        regexp_replace(
            trim(cuvee),
            '[[:space:]]+',
            ' ',
            'g'
        )
    ),
    coalesce(vintage, -1)
);

create or replace function public.apply_add_inventory_operation(
    p_operation_id uuid,
    p_household_id uuid,
    p_device_id uuid,
    p_requested_wine_id uuid,
    p_wine_producer text,
    p_wine_cuvee text,
    p_wine_vintage integer,
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
    v_user_id uuid := (select auth.uid());
    v_producer text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(
                coalesce(
                    p_wine_producer,
                    ''
                )
            ),
            '[[:space:]]+',
            ' ',
            'g'
        );
    v_cuvee text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(
                coalesce(
                    p_wine_cuvee,
                    ''
                )
            ),
            '[[:space:]]+',
            ' ',
            'g'
        );
    v_wine public.wines%rowtype;
    v_result_operation_id uuid;
    v_result_status text;
    v_result_error_code text;
    v_result_error_message text;
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

    if p_requested_wine_id is null then
        raise exception using
            errcode = '22023',
            message = 'requested_wine_id is required';
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

    if p_quantity is null or p_quantity <= 0 then
        raise exception using
            errcode = '22023',
            message = 'Quantity must be greater than zero';
    end if;

    if v_producer = '' then
        raise exception using
            errcode = '22023',
            message = 'Wine producer is required';
    end if;

    if v_cuvee = '' then
        raise exception using
            errcode = '22023',
            message = 'Wine cuvée is required';
    end if;

    if p_wine_vintage is not null
       and (
           p_wine_vintage < 1800
           or p_wine_vintage > 2200
       )
    then
        raise exception using
            errcode = '22023',
            message = 'Wine vintage must be between 1800 and 2200';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            p_household_id::text
            || '|'
            || pg_catalog.lower(v_producer)
            || '|'
            || pg_catalog.lower(v_cuvee)
            || '|'
            || coalesce(
                p_wine_vintage::text,
                'NV'
            ),
            0
        )
    );

    select w.*
    into v_wine
    from public.wines w
    where w.id = p_requested_wine_id;

    if found then
        if v_wine.household_id
            is distinct from p_household_id
        then
            raise exception using
                errcode = '22023',
                message = 'Requested wine does not belong to the household';
        end if;

        if pg_catalog.lower(
               pg_catalog.regexp_replace(
                   pg_catalog.btrim(v_wine.producer),
                   '[[:space:]]+',
                   ' ',
                   'g'
               )
           ) is distinct from pg_catalog.lower(v_producer)
           or pg_catalog.lower(
               pg_catalog.regexp_replace(
                   pg_catalog.btrim(v_wine.cuvee),
                   '[[:space:]]+',
                   ' ',
                   'g'
               )
           ) is distinct from pg_catalog.lower(v_cuvee)
           or v_wine.vintage is distinct from p_wine_vintage
        then
            raise exception using
                errcode = '22023',
                message = 'Requested wine id does not match the supplied wine identity';
        end if;
    else
        select w.*
        into v_wine
        from public.wines w
        where w.household_id = p_household_id
          and pg_catalog.lower(
                  pg_catalog.regexp_replace(
                      pg_catalog.btrim(w.producer),
                      '[[:space:]]+',
                      ' ',
                      'g'
                  )
              ) = pg_catalog.lower(v_producer)
          and pg_catalog.lower(
                  pg_catalog.regexp_replace(
                      pg_catalog.btrim(w.cuvee),
                      '[[:space:]]+',
                      ' ',
                      'g'
                  )
              ) = pg_catalog.lower(v_cuvee)
          and w.vintage is not distinct from p_wine_vintage;

        if not found then
            insert into public.wines (
                id,
                household_id,
                producer,
                cuvee,
                vintage
            )
            values (
                p_requested_wine_id,
                p_household_id,
                v_producer,
                v_cuvee,
                p_wine_vintage
            )
            on conflict do nothing;

            select w.*
            into v_wine
            from public.wines w
            where w.household_id = p_household_id
              and pg_catalog.lower(
                      pg_catalog.regexp_replace(
                          pg_catalog.btrim(w.producer),
                          '[[:space:]]+',
                          ' ',
                          'g'
                      )
                  ) = pg_catalog.lower(v_producer)
              and pg_catalog.lower(
                      pg_catalog.regexp_replace(
                          pg_catalog.btrim(w.cuvee),
                          '[[:space:]]+',
                          ' ',
                          'g'
                      )
                  ) = pg_catalog.lower(v_cuvee)
              and w.vintage
                    is not distinct from p_wine_vintage;

            if not found then
                raise exception using
                    errcode = '22023',
                    message = 'Unable to resolve wine identity';
            end if;
        end if;
    end if;

    select
        result.operation_id,
        result.operation_status,
        result.operation_error_code,
        result.operation_error_message
    into
        v_result_operation_id,
        v_result_status,
        v_result_error_code,
        v_result_error_message
    from public.apply_inventory_operation(
        p_operation_id,
        p_household_id,
        p_device_id,
        'ADD',
        v_wine.id,
        null,
        p_destination_location_id,
        p_quantity,
        p_created_at_client,
        null
    ) as result;

    update public.inventory_operations
    set wine_producer = v_wine.producer,
        wine_cuvee = v_wine.cuvee,
        wine_vintage = v_wine.vintage
    where id = p_operation_id;

    return query
    select
        v_result_operation_id,
        v_result_status,
        v_result_error_code,
        v_result_error_message;
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
    uuid,
    integer,
    timestamptz
)
to authenticated;

commit;
