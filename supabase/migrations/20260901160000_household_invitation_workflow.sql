begin;

-- Invitation audit events precede membership creation, so they identify the
-- durable invitation instead of inventing a membership ID. Accepted events
-- bind both records. Existing role-change and revocation history remains
-- unchanged.
alter table private.household_membership_events
    alter column membership_id drop not null;

alter table private.household_membership_events
    add column invitation_id uuid
        references private.household_invitations(id);

create index household_membership_events_invitation_idx
on private.household_membership_events (invitation_id, created_at desc);

alter table private.household_membership_events
    drop constraint household_membership_events_type_check;

alter table private.household_membership_events
    drop constraint household_membership_events_shape_check;

alter table private.household_membership_events
    add constraint household_membership_events_type_check
        check (
            event_type in (
                'invited',
                'accepted',
                'invitation_revoked',
                'invitation_superseded',
                'role_changed',
                'revoked',
                'ownership_transferred',
                'left'
            )
        );

alter table private.household_membership_events
    add constraint household_membership_events_shape_check
        check (
            (
                event_type = 'invited'
                and invitation_id is not null
                and membership_id is null
                and member_user_id is null
                and previous_role is null
                and new_role = 'member'
            )
            or (
                event_type = 'accepted'
                and invitation_id is not null
                and membership_id is not null
                and member_user_id is not null
                and previous_role is null
                and new_role = 'member'
            )
            or (
                event_type in (
                    'invitation_revoked',
                    'invitation_superseded'
                )
                and invitation_id is not null
                and membership_id is null
                and member_user_id is null
                and previous_role is null
                and new_role is null
            )
            or (
                event_type = 'role_changed'
                and invitation_id is null
                and membership_id is not null
                and previous_role is not null
                and new_role is not null
                and previous_role <> new_role
            )
            or (
                event_type = 'revoked'
                and invitation_id is null
                and membership_id is not null
                and previous_role is not null
                and new_role is null
            )
            or event_type in ('ownership_transferred', 'left')
        );


create function private.generate_household_invitation_token()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
    select pg_catalog.encode(
        extensions.gen_random_bytes(32),
        'hex'
    );
$$;

revoke execute
on function private.generate_household_invitation_token()
from public, anon, authenticated;


create function private.is_valid_household_invitation_token(
    p_token text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select coalesce(p_token ~ '^[0-9a-f]{64}$', false);
$$;

revoke execute
on function private.is_valid_household_invitation_token(text)
from public, anon, authenticated;


create function private.mask_household_invitation_email(
    p_email text
)
returns text
language sql
immutable
set search_path = ''
as $$
    select case
        when pg_catalog.strpos(p_email, '@') <= 1
            then '***@' || pg_catalog.split_part(p_email, '@', 2)
        else pg_catalog.left(p_email, 1)
            || '***@'
            || pg_catalog.split_part(p_email, '@', 2)
    end;
$$;

revoke execute
on function private.mask_household_invitation_email(text)
from public, anon, authenticated;


create function public.create_household_invitation(
    p_household_id uuid,
    p_invitee_email text
)
returns table (
    invitation_id uuid,
    invitee_email text,
    invitation_token text,
    invitation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := (select auth.uid());
    v_email text := private.normalize_household_invitation_email(
        p_invitee_email
    );
    v_invitation_id uuid := gen_random_uuid();
    v_token text;
    v_expires_at timestamptz := now() + interval '7 days';
begin
    if p_household_id is null then
        raise exception using
            errcode = '22023',
            message = 'household_id is required';
    end if;

    if pg_catalog.length(v_email) not between 3 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    then
        raise exception using
            errcode = '22023',
            message = 'Enter a valid invitation email address';
    end if;

    perform private.require_household_owner(p_household_id);

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            p_household_id::text || ':' || v_email,
            0
        )
    );

    update private.household_invitations invitation
    set status = 'expired',
        resolved_at = now()
    where invitation.household_id = p_household_id
      and invitation.invitee_email_normalized = v_email
      and invitation.status = 'pending'
      and invitation.expires_at <= now();

    if exists (
        select 1
        from private.household_invitations invitation
        where invitation.household_id = p_household_id
          and invitation.invitee_email_normalized = v_email
          and invitation.status = 'pending'
    ) then
        raise exception using
            errcode = '23505',
            message = 'A pending invitation already exists; reissue or revoke it';
    end if;

    v_token := private.generate_household_invitation_token();

    insert into private.household_invitations (
        id,
        household_id,
        invitee_email,
        token_digest,
        created_by_user_id,
        expires_at
    )
    values (
        v_invitation_id,
        p_household_id,
        v_email,
        private.hash_household_invitation_token(v_token),
        v_actor_user_id,
        v_expires_at
    );

    insert into private.household_membership_events (
        household_id,
        membership_id,
        invitation_id,
        member_user_id,
        actor_user_id,
        event_type,
        previous_role,
        new_role
    )
    values (
        p_household_id,
        null,
        v_invitation_id,
        null,
        v_actor_user_id,
        'invited',
        null,
        'member'
    );

    return query
    select
        v_invitation_id,
        v_email,
        v_token,
        v_expires_at;
end;
$$;

comment on function public.create_household_invitation(uuid, text) is
    'Owner-only creation of a seven-day member invitation. Returns the one-time raw bearer token without storing it.';

revoke all
on function public.create_household_invitation(uuid, text)
from public, anon;

grant execute
on function public.create_household_invitation(uuid, text)
to authenticated;


create function public.get_household_invitations(
    p_household_id uuid
)
returns table (
    invitation_id uuid,
    invitee_email text,
    requested_role text,
    invitation_status text,
    created_at timestamptz,
    expires_at timestamptz,
    resolved_at timestamptz,
    can_reissue boolean,
    can_revoke boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    perform private.require_household_owner(p_household_id);

    return query
    select
        invitation.id,
        invitation.invitee_email,
        invitation.requested_role,
        private.effective_household_invitation_status(
            invitation.status,
            invitation.expires_at
        ),
        invitation.created_at,
        invitation.expires_at,
        invitation.resolved_at,
        invitation.status = 'pending',
        invitation.status = 'pending'
            and invitation.expires_at > now()
    from private.household_invitations invitation
    where invitation.household_id = p_household_id
    order by
        case
            when invitation.status = 'pending'
             and invitation.expires_at > now()
                then 0
            else 1
        end,
        invitation.created_at desc,
        invitation.id desc;
end;
$$;

comment on function public.get_household_invitations(uuid) is
    'Owner-only invitation list. Never returns token digests or raw bearer tokens.';

revoke all
on function public.get_household_invitations(uuid)
from public, anon;

grant execute
on function public.get_household_invitations(uuid)
to authenticated;


create function public.preview_household_invitation(
    p_invitation_token text
)
returns table (
    household_name text,
    invitee_email_hint text,
    requested_role text,
    invitation_status text,
    expires_at timestamptz,
    account_matches boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not private.is_valid_household_invitation_token(
        p_invitation_token
    ) then
        return;
    end if;

    return query
    select
        household.name,
        private.mask_household_invitation_email(
            invitation.invitee_email_normalized
        ),
        invitation.requested_role,
        private.effective_household_invitation_status(
            invitation.status,
            invitation.expires_at
        ),
        invitation.expires_at,
        case
            when (select auth.uid()) is null then null
            else exists (
                select 1
                from auth.users user_row
                where user_row.id = (select auth.uid())
                  and private.normalize_household_invitation_email(
                        user_row.email::text
                      ) = invitation.invitee_email_normalized
            )
        end
    from private.household_invitations invitation
    join public.households household
      on household.id = invitation.household_id
    where invitation.token_digest =
        private.hash_household_invitation_token(
            p_invitation_token
        );
end;
$$;

comment on function public.preview_household_invitation(text) is
    'Bearer-token invitation preview with a masked recipient and optional authenticated-account match.';

revoke all
on function public.preview_household_invitation(text)
from public;

grant execute
on function public.preview_household_invitation(text)
to anon, authenticated;


create function public.accept_household_invitation(
    p_invitation_token text
)
returns table (
    household_id uuid,
    household_name text,
    membership_id uuid,
    membership_role text,
    accepted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := (select auth.uid());
    v_actor_email text;
    v_invitation private.household_invitations%rowtype;
    v_membership public.household_members%rowtype;
    v_household_name text;
    v_accepted_at timestamptz := now();
begin
    if v_actor_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if not private.is_valid_household_invitation_token(
        p_invitation_token
    ) then
        raise exception using
            errcode = '22023',
            message = 'Invitation link is invalid or no longer available';
    end if;

    select invitation.*
    into v_invitation
    from private.household_invitations invitation
    where invitation.token_digest =
        private.hash_household_invitation_token(
            p_invitation_token
        )
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Invitation link is invalid or no longer available';
    end if;

    select household.name
    into v_household_name
    from public.households household
    where household.id = v_invitation.household_id;

    if v_invitation.status = 'accepted'
       and v_invitation.accepted_by_user_id = v_actor_user_id
    then
        select member.*
        into v_membership
        from public.household_members member
        where member.id = v_invitation.accepted_membership_id;

        if found then
            return query
            select
                v_invitation.household_id,
                v_household_name,
                v_membership.id,
                v_membership.role,
                v_invitation.resolved_at;
            return;
        end if;
    end if;

    if v_invitation.status <> 'pending' then
        raise exception using
            errcode = '22023',
            message = case v_invitation.status
                when 'expired' then 'Invitation has expired'
                else 'Invitation link is invalid or no longer available'
            end;
    end if;

    if v_invitation.expires_at <= now() then
        raise exception using
            errcode = '22023',
            message = 'Invitation has expired';
    end if;

    select private.normalize_household_invitation_email(
        user_row.email::text
    )
    into v_actor_email
    from auth.users user_row
    where user_row.id = v_actor_user_id;

    if v_actor_email is distinct from
        v_invitation.invitee_email_normalized
    then
        raise exception using
            errcode = '42501',
            message = 'Sign in with the invited email address';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            v_invitation.household_id::text,
            0
        )
    );

    select member.*
    into v_membership
    from public.household_members member
    where member.household_id = v_invitation.household_id
      and member.user_id = v_actor_user_id
    for update;

    if found then
        if v_membership.role <> v_invitation.requested_role then
            raise exception using
                errcode = '23505',
                message = 'The invited account already belongs to this household';
        end if;
    else
        insert into public.household_members (
            household_id,
            user_id,
            role
        )
        values (
            v_invitation.household_id,
            v_actor_user_id,
            v_invitation.requested_role
        )
        returning * into v_membership;
    end if;

    update private.household_invitations invitation
    set status = 'accepted',
        resolved_at = v_accepted_at,
        resolved_by_user_id = v_actor_user_id,
        accepted_by_user_id = v_actor_user_id,
        accepted_membership_id = v_membership.id
    where invitation.id = v_invitation.id;

    insert into private.household_membership_events (
        household_id,
        membership_id,
        invitation_id,
        member_user_id,
        actor_user_id,
        event_type,
        previous_role,
        new_role,
        created_at
    )
    values (
        v_invitation.household_id,
        v_membership.id,
        v_invitation.id,
        v_actor_user_id,
        v_actor_user_id,
        'accepted',
        null,
        v_membership.role,
        v_accepted_at
    );

    return query
    select
        v_invitation.household_id,
        v_household_name,
        v_membership.id,
        v_membership.role,
        v_accepted_at;
end;
$$;

comment on function public.accept_household_invitation(text) is
    'Accepts an unexpired bearer invitation only for the authenticated matching email and atomically creates the member record.';

revoke all
on function public.accept_household_invitation(text)
from public, anon;

grant execute
on function public.accept_household_invitation(text)
to authenticated;


create function public.reissue_household_invitation(
    p_household_id uuid,
    p_invitation_id uuid
)
returns table (
    invitation_id uuid,
    invitee_email text,
    invitation_token text,
    invitation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := (select auth.uid());
    v_previous private.household_invitations%rowtype;
    v_invitation_id uuid := gen_random_uuid();
    v_token text;
    v_expires_at timestamptz := now() + interval '7 days';
begin
    if p_household_id is null or p_invitation_id is null then
        raise exception using
            errcode = '22023',
            message = 'household_id and invitation_id are required';
    end if;

    perform private.require_household_owner(p_household_id);

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_household_id::text, 0)
    );

    select invitation.*
    into v_previous
    from private.household_invitations invitation
    where invitation.id = p_invitation_id
      and invitation.household_id = p_household_id
    for update;

    if not found or v_previous.status <> 'pending' then
        raise exception using
            errcode = '22023',
            message = 'Only a pending invitation can be reissued';
    end if;

    update private.household_invitations invitation
    set status = 'superseded',
        resolved_at = now(),
        resolved_by_user_id = v_actor_user_id
    where invitation.id = v_previous.id;

    v_token := private.generate_household_invitation_token();

    insert into private.household_invitations (
        id,
        household_id,
        invitee_email,
        requested_role,
        token_digest,
        created_by_user_id,
        supersedes_invitation_id,
        expires_at
    )
    values (
        v_invitation_id,
        p_household_id,
        v_previous.invitee_email,
        v_previous.requested_role,
        private.hash_household_invitation_token(v_token),
        v_actor_user_id,
        v_previous.id,
        v_expires_at
    );

    insert into private.household_membership_events (
        household_id,
        invitation_id,
        actor_user_id,
        event_type
    )
    values (
        p_household_id,
        v_previous.id,
        v_actor_user_id,
        'invitation_superseded'
    );

    insert into private.household_membership_events (
        household_id,
        invitation_id,
        actor_user_id,
        event_type,
        new_role
    )
    values (
        p_household_id,
        v_invitation_id,
        v_actor_user_id,
        'invited',
        'member'
    );

    return query
    select
        v_invitation_id,
        v_previous.invitee_email,
        v_token,
        v_expires_at;
end;
$$;

comment on function public.reissue_household_invitation(uuid, uuid) is
    'Owner-only replacement of a pending invitation with a fresh one-time bearer token.';

revoke all
on function public.reissue_household_invitation(uuid, uuid)
from public, anon;

grant execute
on function public.reissue_household_invitation(uuid, uuid)
to authenticated;


create function public.revoke_household_invitation(
    p_household_id uuid,
    p_invitation_id uuid
)
returns table (
    invitation_id uuid,
    invitation_status text,
    revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := (select auth.uid());
    v_invitation private.household_invitations%rowtype;
    v_revoked_at timestamptz := now();
begin
    if p_household_id is null or p_invitation_id is null then
        raise exception using
            errcode = '22023',
            message = 'household_id and invitation_id are required';
    end if;

    perform private.require_household_owner(p_household_id);

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_household_id::text, 0)
    );

    select invitation.*
    into v_invitation
    from private.household_invitations invitation
    where invitation.id = p_invitation_id
      and invitation.household_id = p_household_id
    for update;

    if not found or v_invitation.status <> 'pending' then
        raise exception using
            errcode = '22023',
            message = 'Only a pending invitation can be revoked';
    end if;

    if v_invitation.expires_at <= now() then
        raise exception using
            errcode = '22023',
            message = 'Invitation has already expired';
    end if;

    update private.household_invitations invitation
    set status = 'revoked',
        resolved_at = v_revoked_at,
        resolved_by_user_id = v_actor_user_id
    where invitation.id = v_invitation.id;

    insert into private.household_membership_events (
        household_id,
        invitation_id,
        actor_user_id,
        event_type,
        created_at
    )
    values (
        p_household_id,
        v_invitation.id,
        v_actor_user_id,
        'invitation_revoked',
        v_revoked_at
    );

    return query
    select
        v_invitation.id,
        'revoked'::text,
        v_revoked_at;
end;
$$;

comment on function public.revoke_household_invitation(uuid, uuid) is
    'Owner-only cancellation of an unexpired pending invitation.';

revoke all
on function public.revoke_household_invitation(uuid, uuid)
from public, anon;

grant execute
on function public.revoke_household_invitation(uuid, uuid)
to authenticated;

commit;
