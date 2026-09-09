begin;

-- Delivery is separate from immutable invitation identity/lifecycle. No raw
-- tokens, email bodies, SMTP credentials or provider error text are retained.
create table private.household_invitation_deliveries (
    id uuid primary key default gen_random_uuid(),
    invitation_id uuid not null references private.household_invitations(id),
    actor_user_id uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    status text not null default 'sending'
        check (status in ('sending', 'sent', 'failed', 'unconfirmed'))
);
create index household_invitation_deliveries_invitation_idx
on private.household_invitation_deliveries (invitation_id, created_at desc);
create index household_invitation_deliveries_created_idx
on private.household_invitation_deliveries (created_at desc);
alter table private.household_invitation_deliveries enable row level security;
revoke all on private.household_invitation_deliveries from public, anon, authenticated;

-- The trusted Worker authenticates the bearer using Supabase Auth, then calls
-- this service-only function. It cannot substitute a recipient or invitation URL.
create function public.claim_household_invitation_email(
    p_actor_user_id uuid, p_invitation_id uuid, p_invitation_token text
)
returns table (
    delivery_id uuid, invitee_email text, household_name text, expires_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
    v_invitation private.household_invitations;
    v_delivery_id uuid;
begin
    select * into v_invitation from private.household_invitations
    where id = p_invitation_id for update;
    if not found or v_invitation.status <> 'pending'
       or v_invitation.expires_at <= now()
       or not private.is_valid_household_invitation_token(p_invitation_token)
       or v_invitation.token_digest <> extensions.digest(p_invitation_token, 'sha256')
       or not exists (
           select 1 from public.household_members
           where household_id = v_invitation.household_id
             and user_id = p_actor_user_id and role = 'owner'
       ) then
        raise exception using errcode = '42501', message = 'Invitation cannot be emailed';
    end if;

    -- Serialize the small global sending budget across Worker instances. Failed
    -- and interrupted attempts count too. Replacing a link cannot bypass limits.
    perform pg_catalog.pg_advisory_xact_lock(5072026, 54);
    if (select count(*) from private.household_invitation_deliveries
        where created_at > now() - interval '1 hour') >= 50
       or (select count(*) from private.household_invitation_deliveries d
           join private.household_invitations i on i.id = d.invitation_id
           where i.household_id = v_invitation.household_id
             and d.created_at > now() - interval '1 hour') >= 20
       or exists (
           select 1 from private.household_invitation_deliveries d
           join private.household_invitations i on i.id = d.invitation_id
           where i.invitee_email_normalized = v_invitation.invitee_email_normalized
             and d.created_at > now() - interval '1 minute'
       ) then
        raise exception using errcode = 'P0001', message = 'Invitation email rate limit reached';
    end if;

    insert into private.household_invitation_deliveries (invitation_id, actor_user_id)
    values (v_invitation.id, p_actor_user_id) returning id into v_delivery_id;
    return query select v_delivery_id, v_invitation.invitee_email,
        h.name, v_invitation.expires_at
    from public.households h where h.id = v_invitation.household_id;
end;
$$;
revoke all on function public.claim_household_invitation_email(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.claim_household_invitation_email(uuid,uuid,text) to service_role;

create function public.complete_household_invitation_email(p_delivery_id uuid, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
    if p_status is null or p_status not in ('sent', 'failed', 'unconfirmed') then
        raise exception using errcode = '22023', message = 'Invalid delivery outcome';
    end if;
    update private.household_invitation_deliveries set status = p_status, completed_at = now()
    where id = p_delivery_id and status = 'sending';
end;
$$;
revoke all on function public.complete_household_invitation_email(uuid,text)
from public, anon, authenticated;
grant execute on function public.complete_household_invitation_email(uuid,text) to service_role;

-- Keep the existing list RPC contract intact; delivery details have their own
-- owner-only projection. Interrupted sends become visibly uncertain, not stuck.
create function public.get_household_invitation_deliveries(p_household_id uuid)
returns table (invitation_id uuid, delivery_status text, attempted_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
    perform private.require_household_owner(p_household_id);
    return query select distinct on (d.invitation_id) d.invitation_id,
        case when d.status = 'sending' and d.created_at < now() - interval '2 minutes'
            then 'unconfirmed' else d.status end, d.created_at
    from private.household_invitation_deliveries d
    join private.household_invitations i on i.id = d.invitation_id
    where i.household_id = p_household_id
    order by d.invitation_id, d.created_at desc, d.id desc;
end;
$$;
revoke all on function public.get_household_invitation_deliveries(uuid) from public, anon;
grant execute on function public.get_household_invitation_deliveries(uuid) to authenticated;

commit;
