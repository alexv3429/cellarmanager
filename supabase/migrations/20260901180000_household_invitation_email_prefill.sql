begin;

-- A valid invitation bearer already grants a short-lived preview of the
-- household. Returning its normalized recipient lets the browser prefill the
-- authentication form without placing personal data in the URL or storing a
-- second local copy. Acceptance still requires the authenticated exact email.
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
    'Bearer-token invitation preview, including the exact normalized recipient for authentication prefill and an optional authenticated-account match.';

revoke all
on function public.preview_household_invitation(text)
from public;

grant execute
on function public.preview_household_invitation(text)
to anon, authenticated;

commit;
