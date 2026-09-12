# Household devices — 0.5.7

**Devices** in the account header opens `/devices`, with refresh and browser
Back/Forward support. Each browser profile has a separate registration for each
household. This is a stock-operation identity, **not a login session** or hardware
identifier. Clearing storage or signing out and signing in can produce another
registration. Private browsing has its own identity.

## What can be managed

- Owners list, rename, and revoke registrations in their active household.
- Members use this directory for their own registrations only.
- Names are plain text, 1–120 characters. Renaming changes no account identity.
- The current ID is labelled **This browser**, using its stored household identity.
- Active registrations and collapsed revoked history are separate.
- Dates show creation and **last registration contact**, not live activity or
  last sign-in. An old contact timestamp alone does not prove a browser is unused.
- Management is online-only. Disconnecting or switching account/household/role
  clears the online directory and any confirmation. It is not persisted locally.

The synchronized device table remains the pre-existing household data model;
the private directory's safe account labels are fetched by a narrow RPC. This
change does not widen device-table RLS or PowerSync publication.

## Revocation and limits

Revocation is irreversible for that registration ID. It blocks new server-side
inventory operations, including previously queued offline writes, without erasing
the registration or accepted inventory history. It never changes memberships,
stock quantities, passwords, or other household registrations.

This is **not** “sign out everywhere”, a remote wipe, or a permanent ban on a
person/device. Existing sessions and downloaded data can remain readable; a
current member can register a different browser. Use **Members** to remove a
person's household access. Broader session/lost-device security remains part of
the account/security and disaster-testing work.

The UI warns before revoking the current browser. Once revocation is received
from an RPC or sync, the browser no longer offers stock actions for that household.
It does not automatically create a replacement ID. Other households retain their
own active IDs. The local operation queue also checks synchronized device status;
the database remains authoritative when offline data is stale.

Unsent writes stay queued with their original household/user/device/operation IDs.
They are not acknowledged, discarded, or reattributed after rejection. The sync
error explains the revocation. A denied operation can block the shared upload
queue, including later operations for another household; resolution is the
explicit rejected-operation UX in **0.5.9**, not a silent bypass here. Review unsent
work before clearing storage or signing out. Do not test revocation on a browser
with real pending work.

## Server and deployment

Apply `20260909120000_household_device_management.sql` before using the new UI:

- `get_household_devices` verifies current membership and returns the actor,
  role, household and scoped registration directory.
- `manage_household_device` checks fresh membership and ownership under the
  same household lock as inventory operations and membership changes. Revocation
  is idempotent; rename/revoke create private attributed audit records.
- `register_device` now acquires that household lock before its existing
  registration checks. Revoked IDs cannot be reactivated.

The migration adds RPCs, a private audit table and the locking wrapper. It does
not revoke existing registrations or change accounts, memberships or cellar stock.
No new PowerSync schema/sync-rule change is needed: `revoked_at` already syncs.
Browser roles cannot call the unlocked helper or read/write the audit table.

The client verifies RPC scope and receipts, rechecks actor/target before an action,
and reloads server state after it. A lost mutation response is not treated as a
definite failure; writes are never retried automatically. A failed reload disables
further actions until the directory is refreshed.

## Safe acceptance

1. Owner: open Devices; check **This browser**, account labels, registration dates,
   and separation of revoked history. Switch household; only its registrations
   should appear. Refresh and Back/Forward should keep the correct screen.
2. Rename a disposable/test registration; refresh and verify the new name.
3. Open a revocation confirmation and cancel; no registration should change.
4. In a disposable browser with no queued work, revoke its current registration.
   It should appear revoked, stock actions should become unavailable once the
   revocation is received, and refreshing must not restore the same ID. Reading
   should remain available. Existing stock/history must be unchanged.
5. Member: only their registrations appear. They can rename/revoke those, never
   another user's. Offline management shows a reconnect message with no writes.
6. Phone: names and dates wrap; buttons remain usable without horizontal scrolling.

Automated coverage uses synthetic local database fixtures and mocked UI data,
not the real cellar or real memberships. Database tests roll back all mutations.
