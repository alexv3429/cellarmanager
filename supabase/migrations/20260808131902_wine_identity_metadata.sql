begin;

-- Preserve the v0.1 catalogue facts needed for finding and distinguishing
-- bottles. Appellation/area remain editable metadata; color and physical
-- bottle volume participate in conservative semantic matching.
alter table public.wines
    add column appellation text,
    add column area text,
    add column format_ml integer;

update public.wines
set color = pg_catalog.lower(
        pg_catalog.regexp_replace(
            pg_catalog.btrim(color),
            '[[:space:]]+',
            ' ',
            'g'
        )
    )
where color is not null
  and pg_catalog.btrim(color) <> '';

update public.wines
set color = 'other'
where color is null
   or pg_catalog.btrim(color) = '';

update public.wines
set format_ml = 750
where format_ml is null;

alter table public.wines
    alter column color set default 'other',
    alter column color set not null,
    alter column format_ml set default 750,
    alter column format_ml set not null,
    add constraint wines_color_check
        check (length(trim(color)) > 0),
    add constraint wines_appellation_check
        check (
            appellation is null
            or length(trim(appellation)) > 0
        ),
    add constraint wines_area_check
        check (
            area is null
            or length(trim(area)) > 0
        ),
    add constraint wines_format_ml_check
        check (format_ml > 0);

-- The previous index made a deliberately minimal identity definition into a
-- hard uniqueness rule. v0.1 proves that producer/cuvee/vintage alone is too
-- lossy. Do not replace it with another hard semantic uniqueness constraint:
-- imported data may legitimately contain ambiguous references, and such rows
-- must remain explicit rather than be silently merged.
drop index if exists public.wines_household_normalized_identity_unique;

create index wines_household_semantic_lookup_idx
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
    coalesce(vintage, -1),
    lower(
        regexp_replace(
            trim(color),
            '[[:space:]]+',
            ' ',
            'g'
        )
    ),
    format_ml
);

alter table public.inventory_operations
    add column wine_color text,
    add column wine_appellation text,
    add column wine_area text,
    add column wine_format_ml integer;

-- Older accepted new-wine ADD journal rows already carry producer/cuvee/vintage.
-- Backfill the newly introduced metadata from their canonical wine before the
-- stricter operation-shape constraint is installed.
update public.inventory_operations as operation
set wine_color = wine.color,
    wine_appellation = wine.appellation,
    wine_area = wine.area,
    wine_format_ml = wine.format_ml
from public.wines as wine
where wine.id = operation.wine_id
  and wine.household_id = operation.household_id
  and operation.operation_type = 'ADD'
  and operation.wine_producer is not null;

alter table public.inventory_operations
    drop constraint inventory_operations_wine_identity_shape_check;

-- Backfill journal rows created by pre-metadata v0.2 clients before
-- installing the stricter identity-shape constraint.
update public.inventory_operations operation
set wine_color = wine.color,
    wine_appellation = wine.appellation,
    wine_area = wine.area,
    wine_format_ml = wine.format_ml
from public.wines wine
where operation.operation_type = 'ADD'
  and operation.wine_producer is not null
  and operation.wine_cuvee is not null
  and operation.wine_id = wine.id;

update public.inventory_operations
set wine_color = coalesce(wine_color, 'other'),
    wine_format_ml = coalesce(wine_format_ml, 750)
where operation_type = 'ADD'
  and wine_producer is not null
  and wine_cuvee is not null;

alter table public.inventory_operations
    add constraint inventory_operations_wine_color_check
        check (
            wine_color is null
            or length(trim(wine_color)) > 0
        ),
    add constraint inventory_operations_wine_appellation_check
        check (
            wine_appellation is null
            or length(trim(wine_appellation)) > 0
        ),
    add constraint inventory_operations_wine_area_check
        check (
            wine_area is null
            or length(trim(wine_area)) > 0
        ),
    add constraint inventory_operations_wine_format_ml_check
        check (
            wine_format_ml is null
            or wine_format_ml > 0
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
                        and wine_color is null
                        and wine_appellation is null
                        and wine_area is null
                        and wine_format_ml is null
                    )
                    or (
                        wine_producer is not null
                        and wine_cuvee is not null
                        and wine_color is not null
                        and wine_format_ml is not null
                    )
                )
            )
            or (
                operation_type in ('MOVE', 'REMOVE')
                and wine_producer is null
                and wine_cuvee is null
                and wine_vintage is null
                and wine_color is null
                and wine_appellation is null
                and wine_area is null
                and wine_format_ml is null
            )
        );

-- Expanded ADD RPC. Semantic resolution is conservative:
-- producer + cuvee + vintage + color + format_ml.
-- Appellation and area are supporting/search metadata and never silently make
-- two physical references merge or split.
create or replace function public.apply_add_inventory_operation(
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
            pg_catalog.btrim(coalesce(p_wine_producer, '')),
            '[[:space:]]+',
            ' ',
            'g'
        );
    v_cuvee text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_wine_cuvee, '')),
            '[[:space:]]+',
            ' ',
            'g'
        );
    v_color text :=
        pg_catalog.lower(
            pg_catalog.regexp_replace(
                pg_catalog.btrim(coalesce(p_wine_color, '')),
                '[[:space:]]+',
                ' ',
                'g'
            )
        );
    v_appellation text :=
        nullif(
            pg_catalog.regexp_replace(
                pg_catalog.btrim(coalesce(p_wine_appellation, '')),
                '[[:space:]]+',
                ' ',
                'g'
            ),
            ''
        );
    v_area text :=
        nullif(
            pg_catalog.regexp_replace(
                pg_catalog.btrim(coalesce(p_wine_area, '')),
                '[[:space:]]+',
                ' ',
                'g'
            ),
            ''
        );
    v_wine public.wines%rowtype;
    v_match_count bigint;
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

    if v_color = '' then
        raise exception using
            errcode = '22023',
            message = 'Wine color is required';
    end if;

    if p_wine_format_ml is null
       or p_wine_format_ml <= 0
    then
        raise exception using
            errcode = '22023',
            message = 'Wine format must be a positive number of millilitres';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            p_household_id::text
            || '|'
            || pg_catalog.lower(v_producer)
            || '|'
            || pg_catalog.lower(v_cuvee)
            || '|'
            || coalesce(p_wine_vintage::text, 'NV')
            || '|'
            || v_color
            || '|'
            || p_wine_format_ml::text,
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
           or pg_catalog.lower(
               pg_catalog.regexp_replace(
                   pg_catalog.btrim(v_wine.color),
                   '[[:space:]]+',
                   ' ',
                   'g'
               )
           ) is distinct from v_color
           or v_wine.format_ml is distinct from p_wine_format_ml
        then
            raise exception using
                errcode = '22023',
                message = 'Requested wine id does not match the supplied wine identity';
        end if;
    else
        select count(*)
        into v_match_count
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
          and w.vintage is not distinct from p_wine_vintage
          and pg_catalog.lower(
                  pg_catalog.regexp_replace(
                      pg_catalog.btrim(w.color),
                      '[[:space:]]+',
                      ' ',
                      'g'
                  )
              ) = v_color
          and w.format_ml = p_wine_format_ml;

        if v_match_count > 1 then
            raise exception using
                errcode = '22023',
                message = 'Wine identity is ambiguous; select an existing catalog wine explicitly';
        end if;

        if v_match_count = 1 then
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
              and w.vintage is not distinct from p_wine_vintage
              and pg_catalog.lower(
                      pg_catalog.regexp_replace(
                          pg_catalog.btrim(w.color),
                          '[[:space:]]+',
                          ' ',
                          'g'
                      )
                  ) = v_color
              and w.format_ml = p_wine_format_ml;
        else
            insert into public.wines (
                id,
                household_id,
                producer,
                cuvee,
                vintage,
                color,
                appellation,
                area,
                format_ml
            )
            values (
                p_requested_wine_id,
                p_household_id,
                v_producer,
                v_cuvee,
                p_wine_vintage,
                v_color,
                v_appellation,
                v_area,
                p_wine_format_ml
            )
            returning *
            into v_wine;
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
        wine_vintage = v_wine.vintage,
        wine_color = v_wine.color,
        wine_appellation = v_wine.appellation,
        wine_area = v_wine.area,
        wine_format_ml = v_wine.format_ml
    where id = p_operation_id;

    return query
    select
        v_result_operation_id,
        v_result_status,
        v_result_error_code,
        v_result_error_message;
end;
$$;

-- Keep the old RPC signature temporarily compatible with already-deployed
-- clients. A legacy new-wine ADD gets the safe fallback identity other/750ml.
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
language sql
security definer
set search_path = ''
as $$
    select *
    from public.apply_add_inventory_operation(
        p_operation_id,
        p_household_id,
        p_device_id,
        p_requested_wine_id,
        p_wine_producer,
        p_wine_cuvee,
        p_wine_vintage,
        'other',
        null,
        null,
        750,
        p_destination_location_id,
        p_quantity,
        p_created_at_client
    );
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
    text,
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
    text,
    text,
    text,
    integer,
    uuid,
    integer,
    timestamptz
)
to authenticated;

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
