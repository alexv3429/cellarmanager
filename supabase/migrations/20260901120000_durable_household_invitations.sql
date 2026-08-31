begin;

-- Invitations are durable application records, independent from email
-- delivery and Supabase Auth confirmation links. The raw bearer token is
-- returned only by the future creation workflow; this model stores only its
-- SHA-256 digest.
create function private.normalize_household_invitation_email(
    p_email text
)
returns text
language sql
immutable
set search_path = ''
as $$
    select pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_email, ''))
    );
$$;

revoke execute
on function private.normalize_household_invitation_email(text)
from public, anon, authenticated;


create function private.hash_household_invitation_token(
    p_token text
)
returns bytea
language sql
immutable
strict
set search_path = ''
as $$
    select extensions.digest(
        pg_catalog.convert_to(p_token, 'UTF8'),
        'sha256'
    );
$$;

revoke execute
on function private.hash_household_invitation_token(text)
from public, anon, authenticated;


create function private.effective_household_invitation_status(
    p_status text,
    p_expires_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
    select case
        when p_status = 'pending'
         and p_expires_at <= pg_catalog.now()
            then 'expired'
        else p_status
    end;
$$;

revoke execute
on function private.effective_household_invitation_status(
    text,
    timestamptz
)
from public, anon, authenticated;


create table private.household_invitations (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    invitee_email text not null,
    invitee_email_normalized text generated always as (
        pg_catalog.lower(pg_catalog.btrim(invitee_email))
    ) stored,
    requested_role text not null default 'member',
    token_digest bytea not null,
    created_by_user_id uuid not null,
    status text not null default 'pending',
    expires_at timestamptz not null,
    resolved_at timestamptz,
    resolved_by_user_id uuid,
    accepted_by_user_id uuid,
    accepted_membership_id uuid,
    supersedes_invitation_id uuid
        references private.household_invitations(id),
    created_at timestamptz not null default now(),

    constraint household_invitations_email_check
        check (
            invitee_email = pg_catalog.btrim(invitee_email)
            and pg_catalog.length(invitee_email) between 3 and 320
            and invitee_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
        ),
    constraint household_invitations_role_check
        check (requested_role = 'member'),
    constraint household_invitations_token_digest_check
        check (pg_catalog.octet_length(token_digest) = 32),
    constraint household_invitations_status_check
        check (
            status in (
                'pending',
                'accepted',
                'revoked',
                'expired',
                'superseded'
            )
        ),
    constraint household_invitations_expiry_check
        check (
            expires_at > created_at
            and expires_at <= created_at + interval '30 days'
        ),
    constraint household_invitations_resolution_shape_check
        check (
            (
                status = 'pending'
                and resolved_at is null
                and resolved_by_user_id is null
                and accepted_by_user_id is null
                and accepted_membership_id is null
            )
            or (
                status = 'accepted'
                and resolved_at is not null
                and resolved_by_user_id is not null
                and accepted_by_user_id = resolved_by_user_id
                and accepted_membership_id is not null
            )
            or (
                status in ('revoked', 'superseded')
                and resolved_at is not null
                and resolved_by_user_id is not null
                and accepted_by_user_id is null
                and accepted_membership_id is null
            )
            or (
                status = 'expired'
                and resolved_at is not null
                and resolved_by_user_id is null
                and accepted_by_user_id is null
                and accepted_membership_id is null
            )
        ),
    constraint household_invitations_supersedes_self_check
        check (
            supersedes_invitation_id is null
            or supersedes_invitation_id <> id
        ),
    constraint household_invitations_token_digest_unique
        unique (token_digest),
    constraint household_invitations_supersedes_unique
        unique (supersedes_invitation_id)
);

create unique index household_invitations_pending_recipient_idx
on private.household_invitations (
    household_id,
    invitee_email_normalized
)
where status = 'pending';

create index household_invitations_household_status_created_idx
on private.household_invitations (
    household_id,
    status,
    created_at desc
);

create index household_invitations_recipient_status_idx
on private.household_invitations (
    invitee_email_normalized,
    status,
    created_at desc
);

comment on table private.household_invitations is
    'Private durable invitation lifecycle. Raw bearer tokens are never stored; public workflows are introduced separately.';

comment on column private.household_invitations.status is
    'Stored lifecycle state. A pending row whose deadline passed has effective status expired even before cleanup records the terminal state.';

comment on column private.household_invitations.supersedes_invitation_id is
    'Links a replacement attempt to the prior terminal invitation while each token remains immutable.';

revoke all privileges
on table private.household_invitations
from public, anon, authenticated;


-- Keep invitation history append-mostly. A pending record may make exactly
-- one terminal transition; identity, recipient, token digest, deadline, and
-- provenance cannot be rewritten in place. Reissuing creates a new row that
-- points to the superseded attempt.
create function private.enforce_household_invitation_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := (select auth.uid());
    v_current_role text;
    v_invitee_email_normalized text;
begin
    if tg_op = 'INSERT' then
        v_invitee_email_normalized :=
            private.normalize_household_invitation_email(
                new.invitee_email
            );

        if new.status <> 'pending' then
            raise exception using
                errcode = '23514',
                message = 'A household invitation must begin pending';
        end if;

        if v_actor_user_id is null
           or new.created_by_user_id <> v_actor_user_id
        then
            raise exception using
                errcode = '42501',
                message = 'Invitation creator must be the authenticated user';
        end if;

        select member.role
        into v_current_role
        from public.household_members member
        where member.household_id = new.household_id
          and member.user_id = v_actor_user_id;

        if v_current_role is distinct from 'owner' then
            raise exception using
                errcode = '42501',
                message = 'Household owner permission is required';
        end if;

        if exists (
            select 1
            from auth.users user_row
            join public.household_members member
              on member.user_id = user_row.id
             and member.household_id = new.household_id
            where private.normalize_household_invitation_email(
                user_row.email::text
            ) = v_invitee_email_normalized
        ) then
            raise exception using
                errcode = '23505',
                message = 'The invited account is already a household member';
        end if;

        if new.supersedes_invitation_id is not null
           and not exists (
                select 1
                from private.household_invitations previous
                where previous.id = new.supersedes_invitation_id
                  and previous.household_id = new.household_id
                  and previous.invitee_email_normalized =
                        v_invitee_email_normalized
                  and previous.status = 'superseded'
           )
        then
            raise exception using
                errcode = '23514',
                message = 'A replacement must follow a superseded invitation for the same recipient';
        end if;

        return new;
    end if;

    if new.id is distinct from old.id
       or new.household_id is distinct from old.household_id
       or new.invitee_email is distinct from old.invitee_email
       or new.requested_role is distinct from old.requested_role
       or new.token_digest is distinct from old.token_digest
       or new.created_by_user_id is distinct from
            old.created_by_user_id
       or new.expires_at is distinct from old.expires_at
       or new.supersedes_invitation_id is distinct from
            old.supersedes_invitation_id
       or new.created_at is distinct from old.created_at
    then
        raise exception using
            errcode = '55000',
            message = 'Invitation identity and token fields are immutable';
    end if;

    if old.status <> 'pending' then
        raise exception using
            errcode = '55000',
            message = 'A resolved invitation is immutable';
    end if;

    if new.status = 'pending' then
        raise exception using
            errcode = '55000',
            message = 'Pending invitations are replaced rather than edited';
    end if;

    if new.resolved_at < old.created_at then
        raise exception using
            errcode = '23514',
            message = 'Invitation resolution cannot predate creation';
    end if;

    if new.status = 'accepted' then
        if pg_catalog.now() >= old.expires_at then
            raise exception using
                errcode = '22023',
                message = 'Invitation has expired';
        end if;

        if v_actor_user_id is null
           or new.accepted_by_user_id <> v_actor_user_id
           or new.resolved_by_user_id <> v_actor_user_id
        then
            raise exception using
                errcode = '42501',
                message = 'Only the invited account can accept this invitation';
        end if;

        if not exists (
            select 1
            from auth.users user_row
            where user_row.id = v_actor_user_id
              and private.normalize_household_invitation_email(
                    user_row.email::text
                  ) = old.invitee_email_normalized
        ) then
            raise exception using
                errcode = '42501',
                message = 'Invitation email does not match the authenticated account';
        end if;

        if not exists (
            select 1
            from public.household_members member
            where member.id = new.accepted_membership_id
              and member.household_id = old.household_id
              and member.user_id = v_actor_user_id
              and member.role = old.requested_role
        ) then
            raise exception using
                errcode = '23503',
                message = 'Accepted invitation must reference its matching membership';
        end if;

        return new;
    end if;

    if new.status in ('revoked', 'superseded') then
        if v_actor_user_id is null
           or new.resolved_by_user_id <> v_actor_user_id
        then
            raise exception using
                errcode = '42501',
                message = 'Invitation resolver must be the authenticated user';
        end if;

        select member.role
        into v_current_role
        from public.household_members member
        where member.household_id = old.household_id
          and member.user_id = v_actor_user_id;

        if v_current_role is distinct from 'owner' then
            raise exception using
                errcode = '42501',
                message = 'Household owner permission is required';
        end if;

        return new;
    end if;

    if new.status = 'expired' then
        if pg_catalog.now() < old.expires_at then
            raise exception using
                errcode = '22023',
                message = 'Invitation has not expired';
        end if;

        return new;
    end if;

    raise exception using
        errcode = '23514',
        message = 'Unsupported invitation lifecycle transition';
end;
$$;

revoke execute
on function private.enforce_household_invitation_lifecycle()
from public, anon, authenticated;

create trigger household_invitations_lifecycle
before insert or update
on private.household_invitations
for each row
execute function private.enforce_household_invitation_lifecycle();

commit;
