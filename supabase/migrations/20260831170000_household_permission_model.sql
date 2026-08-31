begin;

-- The membership row is the authority for every household capability. Keep
-- role resolution behind security-definer helpers so later membership RPCs do
-- not duplicate RLS-sensitive lookups or invent subtly different role rules.
create or replace function private.current_household_role(
    p_household_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select member.role
    from public.household_members member
    where member.household_id = p_household_id
      and member.user_id = (select auth.uid());
$$;

comment on function private.current_household_role(uuid) is
    'Returns the authenticated user role in one household, or null when no membership exists.';

revoke execute
on function private.current_household_role(uuid)
from public, anon, authenticated;


create or replace function private.is_household_member(
    p_household_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select private.current_household_role(p_household_id) is not null;
$$;

comment on function private.is_household_member(uuid) is
    'RLS-safe membership predicate for the authenticated user.';

revoke execute
on function private.is_household_member(uuid)
from public, anon;

grant execute
on function private.is_household_member(uuid)
to authenticated;


create or replace function private.is_household_owner(
    p_household_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select private.current_household_role(p_household_id) = 'owner';
$$;

comment on function private.is_household_owner(uuid) is
    'Owner predicate for trusted household RPC implementations.';

revoke execute
on function private.is_household_owner(uuid)
from public, anon, authenticated;


create or replace function private.require_household_member(
    p_household_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_role text;
begin
    if (select auth.uid()) is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    v_role := private.current_household_role(p_household_id);

    if v_role is null then
        raise exception using
            errcode = '42501',
            message = 'User is not a member of this household';
    end if;

    return v_role;
end;
$$;

revoke execute
on function private.require_household_member(uuid)
from public, anon, authenticated;


create or replace function private.require_household_owner(
    p_household_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using
            errcode = '42501',
            message = 'Household owner permission is required';
    end if;
end;
$$;

revoke execute
on function private.require_household_owner(uuid)
from public, anon, authenticated;


create or replace function private.require_wine_owner(
    p_wine_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_household_id uuid;
begin
    select wine.household_id
    into v_household_id
    from public.wines wine
    where wine.id = p_wine_id;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Wine was not found';
    end if;

    perform private.require_household_owner(v_household_id);
    return v_household_id;
end;
$$;

revoke execute
on function private.require_wine_owner(uuid)
from public, anon, authenticated;


-- A narrow read RPC gives online clients and security tests one canonical,
-- typed description of the role contract. Offline clients derive the same
-- values from the synchronized household_members.role column.
create function public.get_household_permissions(
    p_household_id uuid
)
returns table (
    household_id uuid,
    household_role text,
    can_manage_inventory boolean,
    can_import_inventory boolean,
    can_manage_catalog boolean,
    can_manage_cellar_setup boolean,
    can_manage_household_guidance boolean,
    can_manage_shared_knowledge boolean,
    can_manage_members boolean,
    can_manage_own_devices boolean,
    can_manage_household_devices boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_role text;
    v_is_owner boolean;
begin
    v_role := private.require_household_member(p_household_id);
    v_is_owner := v_role = 'owner';

    return query
    select
        p_household_id,
        v_role,
        true,
        v_is_owner,
        v_is_owner,
        v_is_owner,
        v_is_owner,
        v_is_owner,
        v_is_owner,
        true,
        v_is_owner;
end;
$$;

comment on function public.get_household_permissions(uuid) is
    'Returns the final owner/member capability contract for the authenticated household member.';

revoke all
on function public.get_household_permissions(uuid)
from public, anon;

grant execute
on function public.get_household_permissions(uuid)
to authenticated;


-- CSV import creates catalog entries in bulk and is therefore an owner action.
-- Move the already-tested implementation behind an owner-checking facade so
-- its payload, receipt, and idempotency behavior stay unchanged.
alter function public.commit_csv_import(
    uuid,
    uuid,
    uuid,
    jsonb,
    timestamptz
)
set schema private;

alter function private.commit_csv_import(
    uuid,
    uuid,
    uuid,
    jsonb,
    timestamptz
)
rename to commit_csv_import_unchecked;

revoke all
on function private.commit_csv_import_unchecked(
    uuid,
    uuid,
    uuid,
    jsonb,
    timestamptz
)
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
begin
    perform private.require_household_owner(p_household_id);

    return query
    select
        result.import_id,
        result.imported_row_count,
        result.imported_bottle_count,
        result.created_wine_count,
        result.reused_wine_count
    from private.commit_csv_import_unchecked(
        p_import_id,
        p_household_id,
        p_device_id,
        p_rows,
        p_created_at_client
    ) result;
end;
$$;

revoke all
on function public.commit_csv_import(uuid, uuid, uuid, jsonb, timestamptz)
from public, anon;

grant execute
on function public.commit_csv_import(uuid, uuid, uuid, jsonb, timestamptz)
to authenticated;


-- Manual maturity and serving values override the estimate for every member
-- of a household. Preserve the existing implementations but require an owner
-- before those shared values can be changed or cleared.
alter function public.set_wine_maturity_override(
    uuid,
    integer,
    integer,
    integer,
    integer,
    text,
    text
)
set schema private;

alter function private.set_wine_maturity_override(
    uuid,
    integer,
    integer,
    integer,
    integer,
    text,
    text
)
rename to set_wine_maturity_override_unchecked;

revoke all
on function private.set_wine_maturity_override_unchecked(
    uuid,
    integer,
    integer,
    integer,
    integer,
    text,
    text
)
from public, anon, authenticated;

create function public.set_wine_maturity_override(
    p_wine_id uuid,
    p_first_trial_year integer,
    p_best_start_year integer,
    p_best_end_year integer,
    p_drink_by_year integer,
    p_storage_purpose text default null,
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.require_wine_owner(p_wine_id);

    return private.set_wine_maturity_override_unchecked(
        p_wine_id,
        p_first_trial_year,
        p_best_start_year,
        p_best_end_year,
        p_drink_by_year,
        p_storage_purpose,
        p_note
    );
end;
$$;

revoke all
on function public.set_wine_maturity_override(
    uuid,
    integer,
    integer,
    integer,
    integer,
    text,
    text
)
from public, anon;

grant execute
on function public.set_wine_maturity_override(
    uuid,
    integer,
    integer,
    integer,
    integer,
    text,
    text
)
to authenticated;


alter function public.clear_wine_maturity_override(uuid)
set schema private;

alter function private.clear_wine_maturity_override(uuid)
rename to clear_wine_maturity_override_unchecked;

revoke all
on function private.clear_wine_maturity_override_unchecked(uuid)
from public, anon, authenticated;

create function public.clear_wine_maturity_override(
    p_wine_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.require_wine_owner(p_wine_id);
    return private.clear_wine_maturity_override_unchecked(p_wine_id);
end;
$$;

revoke all
on function public.clear_wine_maturity_override(uuid)
from public, anon;

grant execute
on function public.clear_wine_maturity_override(uuid)
to authenticated;


alter function public.set_wine_serving_override(
    uuid,
    numeric,
    numeric,
    integer,
    integer,
    text,
    text
)
set schema private;

alter function private.set_wine_serving_override(
    uuid,
    numeric,
    numeric,
    integer,
    integer,
    text,
    text
)
rename to set_wine_serving_override_unchecked;

revoke all
on function private.set_wine_serving_override_unchecked(
    uuid,
    numeric,
    numeric,
    integer,
    integer,
    text,
    text
)
from public, anon, authenticated;

create function public.set_wine_serving_override(
    p_wine_id uuid,
    p_temperature_min_c numeric,
    p_temperature_max_c numeric,
    p_aeration_min_minutes integer,
    p_aeration_max_minutes integer,
    p_method text,
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.require_wine_owner(p_wine_id);

    return private.set_wine_serving_override_unchecked(
        p_wine_id,
        p_temperature_min_c,
        p_temperature_max_c,
        p_aeration_min_minutes,
        p_aeration_max_minutes,
        p_method,
        p_note
    );
end;
$$;

revoke all
on function public.set_wine_serving_override(
    uuid,
    numeric,
    numeric,
    integer,
    integer,
    text,
    text
)
from public, anon;

grant execute
on function public.set_wine_serving_override(
    uuid,
    numeric,
    numeric,
    integer,
    integer,
    text,
    text
)
to authenticated;


alter function public.clear_wine_serving_override(uuid)
set schema private;

alter function private.clear_wine_serving_override(uuid)
rename to clear_wine_serving_override_unchecked;

revoke all
on function private.clear_wine_serving_override_unchecked(uuid)
from public, anon, authenticated;

create function public.clear_wine_serving_override(
    p_wine_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.require_wine_owner(p_wine_id);
    return private.clear_wine_serving_override_unchecked(p_wine_id);
end;
$$;

revoke all
on function public.clear_wine_serving_override(uuid)
from public, anon;

grant execute
on function public.clear_wine_serving_override(uuid)
to authenticated;

commit;
