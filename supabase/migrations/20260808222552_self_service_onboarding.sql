begin;

create or replace function public.create_first_household(
    p_household_name text,
    p_cellar_name text,
    p_location_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_name text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(
                coalesce(p_household_name, '')
            ),
            '[[:space:]]+',
            ' ',
            'g'
        );
    v_cellar_name text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(
                coalesce(p_cellar_name, '')
            ),
            '[[:space:]]+',
            ' ',
            'g'
        );
    v_location_code text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(
                coalesce(p_location_code, '')
            ),
            '[[:space:]]+',
            ' ',
            'g'
        );
    v_household_id uuid;
    v_cellar_id uuid;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if v_household_name = '' then
        raise exception using
            errcode = '22023',
            message = 'Household name is required';
    end if;

    if v_cellar_name = '' then
        raise exception using
            errcode = '22023',
            message = 'Cellar name is required';
    end if;

    if v_location_code = '' then
        raise exception using
            errcode = '22023',
            message = 'Location code is required';
    end if;

    -- Prevent a double-click/retry from creating two first households.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_user_id::text, 0)
    );

    if exists (
        select 1
        from public.household_members hm
        where hm.user_id = v_user_id
    ) then
        raise exception using
            errcode = '23505',
            message = 'User already belongs to a household';
    end if;

    insert into public.households (name)
    values (v_household_name)
    returning id into v_household_id;

    insert into public.household_members (
        household_id,
        user_id,
        role
    )
    values (
        v_household_id,
        v_user_id,
        'owner'
    );

    insert into public.cellars (
        household_id,
        name
    )
    values (
        v_household_id,
        v_cellar_name
    )
    returning id into v_cellar_id;

    insert into public.locations (
        household_id,
        cellar_id,
        code
    )
    values (
        v_household_id,
        v_cellar_id,
        v_location_code
    );

    return v_household_id;
end;
$$;

revoke all
on function public.create_first_household(
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.create_first_household(
    text,
    text,
    text
)
to authenticated;

commit;
