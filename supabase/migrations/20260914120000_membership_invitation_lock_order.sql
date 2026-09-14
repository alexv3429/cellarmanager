begin;

-- All invitation mutations acquire the household lock before any invitation
-- row lock. Acceptance previously locked the row first, which could deadlock
-- against cancellation/replacement. Owner authority is checked after waiting,
-- so a concurrent demotion cannot retain earlier management authority.
alter function public.accept_household_invitation(text) set schema private;
alter function private.accept_household_invitation(text) rename to accept_household_invitation_before_membership_lock;
revoke all on function private.accept_household_invitation_before_membership_lock(text) from public, anon, authenticated;

create function public.accept_household_invitation(p_invitation_token text)
returns table (household_id uuid, household_name text, membership_id uuid, membership_role text, accepted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_household_id uuid;
begin
    if (select auth.uid()) is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    if not private.is_valid_household_invitation_token(p_invitation_token) then
        raise exception using errcode = '22023', message = 'Invitation link is invalid or no longer available';
    end if;
    -- Only resolve immutable household identity here. The original workflow
    -- rereads/locks the invitation and validates email, status and expiry under
    -- the household lock. This initial lookup grants no membership or receipt.
    select i.household_id into v_household_id from private.household_invitations i
        where i.token_digest = private.hash_household_invitation_token(p_invitation_token);
    if not found then
        raise exception using errcode = '22023', message = 'Invitation link is invalid or no longer available';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_household_id::text, 0));
    return query select * from private.accept_household_invitation_before_membership_lock(p_invitation_token);
end;
$$;

alter function public.create_household_invitation(uuid,text) set schema private;
alter function private.create_household_invitation(uuid,text) rename to create_household_invitation_before_membership_lock;
revoke all on function private.create_household_invitation_before_membership_lock(uuid,text) from public, anon, authenticated;
create function public.create_household_invitation(p_household_id uuid, p_invitee_email text)
returns table (invitation_id uuid, invitee_email text, invitation_token text, invitation_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
    if p_household_id is null then
        raise exception using errcode = '22023', message = 'household_id is required';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    perform private.require_household_owner(p_household_id);
    return query select * from private.create_household_invitation_before_membership_lock(p_household_id, p_invitee_email);
end;
$$;

alter function public.reissue_household_invitation(uuid,uuid) set schema private;
alter function private.reissue_household_invitation(uuid,uuid) rename to reissue_household_invitation_before_membership_lock;
revoke all on function private.reissue_household_invitation_before_membership_lock(uuid,uuid) from public, anon, authenticated;
create function public.reissue_household_invitation(p_household_id uuid, p_invitation_id uuid)
returns table (invitation_id uuid, invitee_email text, invitation_token text, invitation_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
    if p_household_id is null or p_invitation_id is null then
        raise exception using errcode = '22023', message = 'household_id and invitation_id are required';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    perform private.require_household_owner(p_household_id);
    return query select * from private.reissue_household_invitation_before_membership_lock(p_household_id, p_invitation_id);
end;
$$;

alter function public.revoke_household_invitation(uuid,uuid) set schema private;
alter function private.revoke_household_invitation(uuid,uuid) rename to revoke_household_invitation_before_membership_lock;
revoke all on function private.revoke_household_invitation_before_membership_lock(uuid,uuid) from public, anon, authenticated;
create function public.revoke_household_invitation(p_household_id uuid, p_invitation_id uuid)
returns table (invitation_id uuid, invitation_status text, revoked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
    if p_household_id is null or p_invitation_id is null then
        raise exception using errcode = '22023', message = 'household_id and invitation_id are required';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text, 0));
    perform private.require_household_owner(p_household_id);
    return query select * from private.revoke_household_invitation_before_membership_lock(p_household_id, p_invitation_id);
end;
$$;

revoke all on function public.accept_household_invitation(text), public.create_household_invitation(uuid,text),
    public.reissue_household_invitation(uuid,uuid), public.revoke_household_invitation(uuid,uuid) from public, anon;
grant execute on function public.accept_household_invitation(text), public.create_household_invitation(uuid,text),
    public.reissue_household_invitation(uuid,uuid), public.revoke_household_invitation(uuid,uuid) to authenticated;

comment on function public.accept_household_invitation(text) is
    'Email-bound Member acceptance; serializes with invitation cancellation/replacement and membership changes, household lock first.';
commit;
