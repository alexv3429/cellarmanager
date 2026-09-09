# Household members — 0.5.6

Open **Members** in the account header to see who currently has access to the
selected household. The `/members` URL works on refresh and with browser
Back/Forward, under the household isolation rules introduced in 0.5.5.

## What each person can do

- Everyone can read the current directory: display name when available,
  account email, role, join date, and **You** on their own membership.
- Owners can open **Invite member** and the existing invitation history.
  Invitations initially grant read-only Member access. After acceptance,
  an Owner can promote the new member if they should manage the collection.
- Owners can **Make Owner**, **Make Member**, or **Remove access** for another
  current membership. Selection alone changes nothing: an inline confirmation
  identifies the target and explains the consequences. **Cancel** or Escape
  returns focus to the initiating button without sending a mutation.
- Members have no invitation, role-change, or removal controls.
- No self-demotion or self-removal is offered. Leaving and ownership transfer
  remain the explicit 0.5.10 workflow, not a workaround through generic controls.

The existing server contract permits several Owners. Promoting someone lets
them manage stock, shared settings, and other people's access—including the
Owner who promoted them. Demoting another Owner retains their reading access
and personal notes, but subsequent stock uploads require Owner authority;
previously queued writes may therefore become blocked.

Removing access revokes the household membership and its registered devices.
It deletes that account's household-private notes and preferences, so the
confirmation explicitly warns about this data loss. It does **not** delete the
account or change cellar stock. Shared observations and attributed inventory
history remain intact. Rejoining requires a new invitation and fresh device
registration. Server access stops immediately, but data already synchronized
to an offline device cannot be remotely erased before that device reconnects.
These are the existing 0.5.2/0.5.4 database rules, not new deletion semantics.

## Online, authority, and failure handling

The directory comes from the authenticated `get_household_members` RPC. It is
kept only in the mounted online view, not localStorage, PowerSync, or the offline
operation queue. Going offline clears the displayed identities and confirmation;
reconnecting reloads from the server. The rest of the cellar remains local-first.

Owner controls require both the synchronized Owner role and a matching Owner
entry in the freshly loaded server directory. Before submitting a confirmed
change, the UI reads the list again and abandons the action if the actor lost
ownership, the target disappeared, or the target's role/identity changed.
This preflight is a UX safeguard, not an atomic compare-and-swap or security
boundary: the mutation RPC independently rechecks current authorization under
the household lock. Database constraints still prevent an ownerless household
and generic changes to the acting Owner's own membership.

Mutations use only the selected household, membership ID, and (for role changes)
the requested role. They cannot supply editable account identity, audit actors,
or other household attributes. Receipts are validated before success is shown.
After a change or uncertain failure, the view reloads actual server state.
Writes are never automatically retried. If the reload fails, the list is hidden
and further changes are unavailable until **Refresh members** succeeds. A
successful change is distinguished from a failed refresh; a dropped response
does not falsely claim that the change never happened.

The workspace is keyed by household, user, synchronized role, and connectivity.
Request generations ignore responses from an unmounted or superseded view.
An already-submitted RPC can still finish for its original household; it cannot
populate or submit a mutation against the new household.

## Verification and manual acceptance

No new migration, permission grant, or production database change is needed.
Tests cover typed RPC payloads/receipts, role visibility, cancellation and focus,
promotion/demotion/removal, stale identity/role checks, dropped responses,
failed reloads, offline transitions, and household isolation. Existing local
membership RPC tests exercise server authorization and revocation semantics
with rollback-only synthetic data.

On desktop and phone:

1. Open **Members** as Owner. Check names, roles, **You**, and readable layout.
   Your own row must have no role-change or removal action.
2. On a test member, open **Make Owner** and cancel. Nothing should change.
   If appropriate, confirm promotion, verify the role updates, then restore
   **Member**. Use only an account intended for this test; Owner access is real.
3. Open **Remove access** and read the warning, then cancel. Confirm removal
   only for a disposable test membership whose private notes/preferences may
   be deleted. Reinvite it if you need to verify rejoining.
4. Sign in as Member: the same directory is readable, with only a refresh
   action. There must be no invitation or access-editing controls.
5. Check **Invite member → Back to members**, refresh, and browser navigation.
6. Go offline: member management should clearly ask to reconnect, with no
   queued changes. Reconnect and verify the current list reloads.

Real cellar inventory and existing private notes are never test fixtures.
User validation and merge remain separate from implementation.
