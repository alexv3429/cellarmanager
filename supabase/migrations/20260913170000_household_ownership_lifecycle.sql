begin;

-- An online receipt/read can restrict the browser immediately, before its
-- synchronized membership snapshot catches up. This never lists other users.
create function public.get_my_household_membership(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    if (select auth.uid()) is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    if p_household_id is null then
        raise exception using errcode = '22023', message = 'household_id is required';
    end if;
    return pg_catalog.jsonb_build_object(
        'household_id', p_household_id, 'user_id', (select auth.uid()),
        'membership_id', (select id from public.household_members
            where household_id = p_household_id and user_id = (select auth.uid())),
        'role', private.current_household_role(p_household_id));
end;
$$;

create function public.transfer_household_ownership(
    p_household_id uuid, p_membership_id uuid,
    p_successor_membership_id uuid, p_expected_successor_role text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_actor public.household_members%rowtype;
    v_successor public.household_members%rowtype;
    v_now timestamptz := now();
begin
    if p_household_id is null or p_membership_id is null or p_successor_membership_id is null
       or p_expected_successor_role is null or p_expected_successor_role not in ('owner', 'member') then
        raise exception using errcode = '22023', message = 'Household, current membership, successor and expected role are required';
    end if;
    -- Same lock as role changes, revocation, device registration and stock.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    perform private.require_household_owner(p_household_id);
    select * into v_actor from public.household_members
        where id = p_membership_id and household_id = p_household_id and user_id = (select auth.uid()) for update;
    if not found then
        raise exception using errcode = '42501', message = 'Your membership changed; refresh before transferring ownership';
    end if;
    select * into v_successor from public.household_members
        where id = p_successor_membership_id and household_id = p_household_id for update;
    if not found or v_successor.user_id = v_actor.user_id then
        raise exception using errcode = '22023', message = 'Choose another current household member';
    end if;
    if v_successor.role <> p_expected_successor_role then
        raise exception using errcode = '40001', message = 'The successor role changed; refresh before transferring ownership';
    end if;

    -- Promote first, then demote the actor in the same transaction. Other
    -- Owners retain their roles. No devices, preferences or stock are removed.
    update public.household_members set role = 'owner' where id = v_successor.id;
    update public.household_members set role = 'member' where id = v_actor.id;
    insert into private.household_membership_events
        (household_id, membership_id, member_user_id, actor_user_id, event_type, previous_role, new_role, created_at)
    values
        (p_household_id, v_successor.id, v_successor.user_id, v_actor.user_id, 'ownership_transferred', v_successor.role, 'owner', v_now),
        (p_household_id, v_actor.id, v_actor.user_id, v_actor.user_id, 'ownership_transferred', 'owner', 'member', v_now);
    return pg_catalog.jsonb_build_object('household_id', p_household_id,
        'user_id', v_actor.user_id, 'membership_id', v_actor.id, 'role', 'member',
        'successor_membership_id', v_successor.id, 'successor_user_id', v_successor.user_id,
        'successor_role', 'owner', 'changed_at', v_now);
end;
$$;

create function public.leave_household(p_household_id uuid, p_membership_id uuid, p_expected_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_actor public.household_members%rowtype;
    v_now timestamptz := now();
begin
    if p_household_id is null or p_membership_id is null or p_expected_role is null
       or p_expected_role not in ('owner', 'member') then
        raise exception using errcode = '22023', message = 'Household, current membership and expected role are required';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    perform private.require_household_member(p_household_id);
    select * into v_actor from public.household_members
        where id = p_membership_id and household_id = p_household_id and user_id = (select auth.uid()) for update;
    if not found or v_actor.role <> p_expected_role then
        raise exception using errcode = '40001', message = 'Your membership changed; refresh before leaving';
    end if;
    if v_actor.role = 'owner' and not exists (
        select 1 from public.household_members where household_id = p_household_id
            and role = 'owner' and id <> v_actor.id
    ) then
        raise exception using errcode = '23514', message = 'Transfer ownership before leaving: a household must retain at least one Owner';
    end if;

    -- Same private-data cleanup as removing access; preserve attributed shared
    -- notes and inventory history. Membership FKs remove private preferences.
    update public.devices set revoked_at = v_now
        where household_id = p_household_id and user_id = v_actor.user_id and revoked_at is null;
    delete from public.household_wine_observations
        where household_id = p_household_id and recorded_by = v_actor.user_id and visibility = 'personal';
    insert into private.household_membership_events
        (household_id, membership_id, member_user_id, actor_user_id, event_type, previous_role, new_role, created_at)
    values (p_household_id, v_actor.id, v_actor.user_id, v_actor.user_id, 'left', v_actor.role, null, v_now);
    delete from public.household_members where id = v_actor.id;
    return pg_catalog.jsonb_build_object('household_id', p_household_id,
        'user_id', v_actor.user_id, 'membership_id', v_actor.id, 'role', null, 'changed_at', v_now);
end;
$$;

revoke all on function public.get_my_household_membership(uuid),
    public.transfer_household_ownership(uuid, uuid, uuid, text),
    public.leave_household(uuid, uuid, text) from public, anon;
grant execute on function public.get_my_household_membership(uuid),
    public.transfer_household_ownership(uuid, uuid, uuid, text),
    public.leave_household(uuid, uuid, text) to authenticated;

comment on function public.transfer_household_ownership(uuid, uuid, uuid, text) is
    'Atomically hands ownership to a current collaborator and keeps the acting Owner as a Member. No stock changes.';
comment on function public.leave_household(uuid, uuid, text) is
    'Self-only departure, never the last Owner. Revokes devices and deletes household-private notes/preferences, not the account or shared history.';

commit;
