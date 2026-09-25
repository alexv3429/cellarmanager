# Account & profile settings (0.5.12)

## User experience

Open **Settings → Account** in the application header, or **Account** on the initial cellar-setup screen.
The `/account` route is independent of household membership and local database
readiness. Owners and Members have the same controls, for their own account only.
Refresh, browser Back/Forward and **Back to cellar** are supported. Returning to
the cellar restores the selected household, with its current permissions.

- **Sign-in email** is read-only. Email changes and account deletion are not part
  of this step.
- **Display name** is optional, trimmed and limited to 80 characters without
  control characters. It is visible to collaborators in every household; clearing
  it restores the email fallback. Reopen Members to refresh the directory.
- **Language** can be English, French, or **Use device language**. The choice is
  saved to the signed-in user's Auth presentation metadata and follows the user
  across devices. With device language selected, French locale tags use French;
  English tags use English; unsupported locales fall back to English. A
  per-account browser copy allows the saved choice to continue working offline.
  French coverage is being introduced in stages; until the primary cellar
  workflows are translated, those screens continue to display in English.
- **Send password reset email** uses the freshly verified account email. Follow
  the newest link, enter and confirm a new password, then continue to the cellar.
  Requesting the email alone does not change the password. Check Spam before
  retrying; Auth rate limits and password policy remain authoritative.
- Account edits require connectivity; they are never queued as inventory work.
  An uncertain response is not automatically retried. Reload to check the name
  or inspect the inbox before repeating a request.

## Security and data boundaries

The existing Supabase Auth `getUser` verifies identity before each action, and
the expected account UUID must match. An unmounted, disconnected or replaced
screen cancels pending work before submission and ignores late results. Auth
authorizes own-account changes server-side. The application submits only
`data.full_name` for the display name or `data.preferred_language` for language,
preserving unrelated metadata. The existing
`get_household_members` RPC reads that field, with legacy `name` fallback; storing
an explicit empty `full_name` suppresses the legacy fallback.

Names and all editable user metadata are **not permission sources**. Memberships,
roles, stock, invitations, wine preferences and other users' accounts are not
changed. No service-role key, arbitrary target account control or new database
migration is introduced. Existing account UUIDs remain authoritative.

Password recovery uses the existing Auth/SMTP flow and `ResetPasswordForm`, not
a second password editor or an Owner credential-management API. No passwords or
recovery tokens are added to local inventory, logs or application metadata.
The requested callback is the current application's secure origin. Supabase's
configured redirect allowlist remains the authority: an unapproved preview
origin can fall back to the production site, whose existing reset form supports
the same flow. Do not broaden the allowlist for arbitrary domains to test this.

References: [Supabase user updates](https://supabase.com/docs/reference/javascript/auth-updateuser)
and [password recovery](https://supabase.com/docs/guides/auth/passwords).

## Validation

Automated web tests cover verified identity, wrong/expired accounts, safe metadata
updates, blank and legacy names, validation, password-email recipients/redirects,
rate limits, no automatic retries, loading/offline states, duplicate submission,
late responses, account switches and history navigation for both roles. The
existing reset form also has password-validation, failure and completion tests.

Run `npm run web:ci`, `npm run ci` and `git diff --check`.

Before accepting this step:

1. As Owner, open Account, change the display name, save, and refresh. Open
   Members: the name should appear while email and role stay unchanged.
2. Clear the name, save, and check that Members falls back to email. Restore the
   desired name if needed.
3. As Member, open Account and confirm the same own-account controls. Change the
   language, refresh, and open the account on another device: the saved choice
   should follow the account. Choose **Use device language** and confirm French
   and unsupported locales resolve to French and English respectively. No
   control edits another collaborator's account, and shared-cellar permissions stay the same.
4. Use a **disposable account**, not the real cellar owner's credentials, to
   request a reset email, follow its link, choose and confirm a new password,
   then sign out and sign in with the new password. The old password must fail.
5. Check phone layout, keyboard focus, refresh and Back/Forward. Disconnect:
   account changes must be unavailable, while returning to synchronized cellar
   data remains possible.

Hosted email delivery and physical-device validation remain explicit user checks;
mocked web tests alone do not establish that SMTP delivers to a real inbox.
