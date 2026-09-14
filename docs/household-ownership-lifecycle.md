# Ownership transfer and leaving — 0.5.10

Open **Members → Your access**. These are explicit, online-only decisions;
generic role/removal controls still cannot target the acting Owner.

## The two actions

- **Transfer ownership** selects an existing collaborator, not an email or a
  pending invitation. Confirmation promotes that person to Owner and demotes
  the acting Owner to read-only Member in one transaction. An existing Owner
  may also be selected; other Owners keep their roles. The departing manager's
  personal notes, preferences and reading access are preserved. They cannot
  restore their own Owner role: another Owner must promote them.
- **Leave household** removes only the acting account's current membership.
  A Member may leave; an Owner may leave only if another Owner remains. A sole
  Owner must transfer first. With no collaborators, invite someone and wait for
  acceptance. This step does not implement deletion of an empty household.

Leaving follows existing access-removal semantics: revoke the account's devices
for this household, delete its **household-private** notes and pairing
preferences, and require a new invitation to rejoin. Shared notes, stock,
canonical knowledge, attributed inventory history, the account, other
households, and account-level maturity taste calibration remain unchanged.
Transfer alone deletes none of these records. Existing household invitations
remain household-managed; transfer is not cancellation of pending invitations.

Both confirmations warn about queued stock requests on **all** the account's
devices. Sync wanted changes first. Still-queued requests retain their original
author, household, device and UUID; they are not silently transferred, retried,
discarded, or undone. The 0.5.9 queue review can stop a blocked request explicitly,
including after the author leaves their final household. Already-accepted
operations remain applied. See [queue recovery](inventory-conflict-recovery.md).

## Server contract and races

Apply `20260913170000_household_ownership_lifecycle.sql` before exercising these
actions. It adds three narrow authenticated RPCs and no data backfill:

- `get_my_household_membership(household_id)` reads only the caller's membership
  and role, or a null membership. It does not expose collaborators or establish
  whether an unrelated household exists. It permits read-only reconciliation
  after leaving, when the full directory is no longer accessible.
- `transfer_household_ownership(household_id, membership_id,
  successor_membership_id, expected_successor_role)` checks the actor is the
  current Owner and both exact membership identities still exist in that
  household. The successor must be someone else and retain the reviewed role.
- `leave_household(household_id, membership_id, expected_role)` checks the exact
  authenticated membership and reviewed role. An old request cannot remove a
  newly accepted membership after rejoining.

Mutations acquire the existing per-household transaction lock shared with
membership changes, device registration and inventory acceptance. Transfer
promotes before demoting, atomically. Concurrent Owner departures cannot both
succeed if they would orphan the household. An upload committed before an access
change stays in history; one reaching authorization afterward is denied. These
functions never bypass stock RPCs or grant table-write privileges.

Both sides of a transfer and each departure append attributed events to the
private membership audit. Anonymous execution and direct browser audit/table
writes remain denied. Revoked registrations cannot be revived by rejoining.
There is no PowerSync schema or hosted sync-rule change: existing membership,
role and device data already synchronize.

## Browser behavior and limits

The interface uses the freshly loaded directory, then rechecks it before
submitting. Confirmations name the collaborator/household and explain the loss
of authority or private data. Cancel and Escape make no mutation and return
focus. Duplicate clicks are guarded. Role, household, account and connectivity
changes unmount the private online workspace; late responses do not populate
another workspace.

A verified receipt immediately reduces this app session's visible permissions
or removes the household from the chooser, before replication catches up. These
temporary restrictions are keyed by account and membership ID, can only reduce
access, and expire when synchronized state catches up. They never insert a
membership into the local database or confer Owner access. The last household's
departure leads to onboarding; another available household uses the established
selection fallback. Browser Back cannot reopen the former household workspace.

The server remains authoritative across reloads and other devices. Data already
synchronized to an offline browser cannot be remotely erased until it reconnects;
leaving is not global sign-out or a remote wipe. Synchronization may still be
blocked by older queued requests, which remain available for explicit recovery.

A missing/malformed mutation response does not prove failure. The UI does not
retry it automatically: it reads the caller's current membership. If that read
also fails, only **Check my current access** is offered in this section until
the result can be reconciled. An already-submitted request may finish for its
original household after the user navigates away.

## Safe acceptance

Without changing any real membership:

1. As Owner, open **Members → Your access**. Choose a collaborator and open
   **Review ownership transfer**. Check their identity, the read-only Member
   consequence, and queued-upload warning. **Cancel**; your Owner role remains.
2. If you are the sole Owner, **Review leaving household** is disabled with an
   explanation. With another Owner, or as Member, open the leave confirmation,
   read the private-data warning, and **Cancel**. No account or data changes.
3. Check the same layout on phone, then offline: there are no queued membership
   changes or active transfer/leave controls while disconnected.

Only with a disposable household and two consenting test accounts:

1. Transfer from A to B. A should immediately become a read-only Member, B an
   Owner after refresh/sync; stock and private notes remain. B can restore A's
   Owner role using existing member management if desired.
2. Have the Member leave. It disappears from their household chooser and B's
   refreshed directory; another household opens, or onboarding appears if none
   remain. The Member's private household data is deleted, not shared stock.
3. Reinvite the departed account. It receives a new membership/device identity;
   prior private notes are not restored and old device UUIDs remain revoked.

Automated evidence: typed payload/receipt, stale identity, cancellation/focus,
offline/unmount, uncertain-response and immediate role/household restriction
tests; 46 rollback-only pgTAP lifecycle assertions; 12 new concurrent scenarios
in the isolated inventory harness (28 total). Races include both Owner-departure
orders, a successor leaving during transfer, and transfer/leave versus MOVE and
new-wine ADD in both orders. These do not claim a live hosted PowerSync or
physical-phone end-to-end test. Real cellar data is never a test fixture.

The actual member/lifecycle components were also exercised with synthetic
RPC data in a browser at 1200px desktop and 390px phone width: transfer to Member,
leave, offline controls, cancellation focus and no horizontal overflow. A
scoped layout rule prevents the shell's generic form-label flex sizing from
creating a large blank space above the collaborator selector.
