begin;

-- Supabase deliberately returns an indistinguishable successful signup response
-- for an already registered address. A valid invitation bearer already reveals
-- its exact recipient, so it can also safely select the correct authentication
-- mode before the user reaches that misleading response.
drop function public.preview_household_invitation(text);

create function public.preview_household_invitation(
    p_invitation_token text
)
returns table (
    household_name text,
    invitee_email text,
    invitee_email_hint text,
    requested_role text,
    invitation_status text,
    expires_at timestamptz,
    account_exists boolean,
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
        invitation.invitee_email_normalized,
        private.mask_household_invitation_email(
            invitation.invitee_email_normalized
        ),
        invitation.requested_role,
        private.effective_household_invitation_status(
            invitation.status,
            invitation.expires_at
        ),
        invitation.expires_at,
        exists (
            select 1
            from auth.users invited_user
            where private.normalize_household_invitation_email(
                    invited_user.email::text
                  ) = invitation.invitee_email_normalized
        ),
        case
            when (select auth.uid()) is null then null
            else exists (
                select 1
                from auth.users session_user_row
                where session_user_row.id = (select auth.uid())
                  and private.normalize_household_invitation_email(
                        session_user_row.email::text
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
    'Bearer-token invitation preview with recipient prefill, existing-account mode selection, and an optional authenticated-account match.';

revoke all
on function public.preview_household_invitation(text)
from public;

grant execute
on function public.preview_household_invitation(text)
to anon, authenticated;

commit;
