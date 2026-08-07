begin;

-- Keep setup labels canonical and prevent case/whitespace-only duplicates.
create unique index cellars_household_normalized_name_unique
on public.cellars (
    household_id,
    lower(
        regexp_replace(
            trim(name),
            '[[:space:]]+',
            ' ',
            'g'
        )
    )
);

create unique index locations_cellar_normalized_code_unique
on public.locations (
    cellar_id,
    lower(
        regexp_replace(
            trim(code),
            '[[:space:]]+',
            ' ',
            'g'
        )
    )
);

create or replace function public.create_cellar(
    p_household_id uuid,
    p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_name text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_name, '')),
            '[[:space:]]+',
            ' ',
            'g'
        );
    v_cellar_id uuid;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if v_name = '' then
        raise exception using
            errcode = '22023',
            message = 'Cellar name is required';
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

    begin
        insert into public.cellars (
            household_id,
            name
        )
        values (
            p_household_id,
            v_name
        )
        returning id into v_cellar_id;
    exception
        when unique_violation then
            raise exception using
                errcode = '22023',
                message = 'A cellar with this name already exists';
    end;

    return v_cellar_id;
end;
$$;

create or replace function public.rename_cellar(
    p_cellar_id uuid,
    p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_name text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_name, '')),
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

    if v_name = '' then
        raise exception using
            errcode = '22023',
            message = 'Cellar name is required';
    end if;

    select c.household_id
    into v_household_id
    from public.cellars c
    where c.id = p_cellar_id;

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

    begin
        update public.cellars
        set name = v_name
        where id = p_cellar_id;
    exception
        when unique_violation then
            raise exception using
                errcode = '22023',
                message = 'A cellar with this name already exists';
    end;

    return p_cellar_id;
end;
$$;

create or replace function public.create_location(
    p_household_id uuid,
    p_cellar_id uuid,
    p_code text
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

    begin
        insert into public.locations (
            household_id,
            cellar_id,
            code
        )
        values (
            p_household_id,
            p_cellar_id,
            v_code
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

create or replace function public.rename_location(
    p_location_id uuid,
    p_code text
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
        set code = v_code
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

revoke all
on function public.create_cellar(uuid, text)
from public, anon;

revoke all
on function public.rename_cellar(uuid, text)
from public, anon;

revoke all
on function public.create_location(uuid, uuid, text)
from public, anon;

revoke all
on function public.rename_location(uuid, text)
from public, anon;

grant execute
on function public.create_cellar(uuid, text)
to authenticated;

grant execute
on function public.rename_cellar(uuid, text)
to authenticated;

grant execute
on function public.create_location(uuid, uuid, text)
to authenticated;

grant execute
on function public.rename_location(uuid, text)
to authenticated;

commit;
