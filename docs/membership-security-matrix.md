# Membership security acceptance — 0.5.11

This is a release-hardening step, not a new screen or role. The
[Owner/Member contract](household-permissions.md) remains unchanged. These
checks exercise database authority independently of hidden buttons and combine
the existing feature suites with a cross-role, cross-household acceptance matrix.
They are regression evidence, not a guarantee that all vulnerabilities are absent.

## Automated matrix

`supabase/tests/database/membership_security_matrix.test.sql` uses synthetic
local accounts, actual demotion/revocation/leaving RPCs, and two households.
Each account can have a different role in the second household.

| Identity in household A | Shared reads | Shared writes and administration | Own notes/preferences/devices | Access to B |
|---|---|---|---|---|
| Owner | Allowed | Allowed | Allowed | Independently Member |
| Member | Allowed | Denied | Allowed | Independently Owner |
| Demoted Owner | Allowed | Denied | Allowed | Independently Owner |
| Revoked Owner | Denied | Denied | No current household access | Independently Member |
| Departed Member | Denied | Denied | No current household access | Independently Member |
| Pending invitee | Denied | Denied | Denied until acceptance | None |
| Unrelated Owner | Denied | Denied | Denied | Own household only |

The matrix checks all eight core synchronized tables through RLS and exercises
36 valid RPC scenarios for each identity: directory reads, invitations and
delivery history, role changes, transfer/leaving, device management, catalog and
facts, storage setup, shared guidance, private/shared authored notes, pairing
preferences, ADD/MOVE/REMOVE (including both new-wine overloads), and bulk import.
Successful calls are positive controls; invalid input is not treated as a
permission denial. Each probe rolls back in its own subtransaction; fingerprints
of every public/private application table must still match afterward.

Additional gates cover:

- anonymous execution of every public RPC except bearer invitation preview;
- all private helpers except the deliberate RLS membership predicate being
  inaccessible directly to authenticated browsers;
- fixed empty search paths for security-definer functions;
- no direct browser reads/writes of private tables or authoritative core writes;
- household ownership not granting service publication or curator assignment;
- private notes remaining author-only, including against fellow Owners;
- stale/spoofed Owner metadata and claimed email not granting authority;
- accepted-token replay not restoring revoked access, rejoining assigning a new
  membership ID, old departure requests not deleting it, and revoked device IDs
  staying revoked;
- mixed household/device IDs not authorizing cross-household actions.

The per-feature pgTAP tests remain essential: they cover expired/cancelled/replaced
invitations, source/research/curation permissions, personal preference isolation,
private-data cleanup, last-Owner safeguards, exact payload replay and stopped
uploads. Former members may still reconcile/stop **their own** old uploads and
retain account-level timing preferences; denial of household access does not
mean deletion of their account or loss of those narrow recovery rights.

## Invitation race fix

The new independent-session suite reproduced a real deadlock when an invitation
was accepted while an Owner cancelled it. Acceptance locked the invitation row
before the household; cancellation/replacement took those locks in the opposite
order.

Migration `20260914120000_membership_invitation_lock_order.sql` gives all four
browser invitation mutations the same order: household first, invitation row
second. Acceptance initially reads only immutable household identity from the
token digest; the original workflow rereads and validates the invitation, email,
deadline and status under the lock. Creation, replacement and cancellation check
current Owner authority after waiting for the lock. Original implementations
become private, non-browser-callable helpers, retaining the existing API shapes,
token behavior and audit history.

`npm run membership:acceptance` checks 11 concurrent scenarios:

- acceptance vs cancellation and replacement, in both orders;
- simultaneous duplicate acceptance: one membership and one acceptance event;
- demotion vs creating, replacing and cancelling invitations, in both orders.

The first authorized action succeeds; the losing action returns a meaningful
domain denial, not a deadlock or lock timeout. In addition,
`npm run inventory:acceptance` retains the 28 stock/device/transfer/departure and
queue-recovery concurrency scenarios from 0.5.8–0.5.10.

Both harnesses require a local Docker Unix socket, copy schema **without data**
to a generated temporary database, seed synthetic accounts, verify real parallel
sessions at a lock barrier, and remove only that validated temporary database.
They cannot take a hosted database URL. No emails are sent.

## Browser and synchronization boundary

Existing web regressions cover Member-only navigation and export, blocked setup
and import forms, late responses, role changes, household switching and History
API isolation, private queue attribution, and offline/reconnect behavior.
Additional 0.5.11 account-switch tests ensure the next account is not declared
locally ready until the previous database has been cleared. Failed cleanup keeps
the old ownership marker and exposes no next-account workspace, online or offline;
a subsequent attempt must retry cleanup.

The test doubles do **not** prove hosted PowerSync bucket isolation, full physical
device synchronization, SMTP delivery, or remote erasure. Offline cached data
cannot be recalled from a disconnected device. Database denial is immediate for
new server calls; UI/cache convergence on other devices needs reconnection and
synchronization. The two-device, hosted acceptance remains a **0.5.13** release
gate, not something claimed by this database matrix.

## Run and release

Against the existing **local** synthetic Supabase environment:

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
npm run membership:acceptance
npm run inventory:acceptance
npm run ci
git diff --check
```

The matrix runs with all pgTAP tests in the required database CI job. Both
concurrency suites run there too; repository policy checks require these steps
to remain in CI.

The migration changes function definitions/permissions only: applying it does
not accept/cancel invitations, change memberships, or touch cellar stock. No
PowerSync rule or client schema change is required. Shared application still
requires explicit rollout approval; confirm it is the only pending migration,
compare before/after data fingerprints, and verify the new wrappers/private
grants. Do not use the real cellar or real access-removal actions as test fixtures.

There is no new UI to validate. A safe optional smoke check is to open Members
as Owner and as Member, confirm familiar controls/read-only access, then read and
cancel a management confirmation. Full invite/accept/revoke/rejoin testing must
use a disposable household and consenting test accounts.

## Local validation record

The completed local run passed 41 pgTAP files / 2,009 assertions (889 in the new
matrix), 11 invitation/membership races, 28 inventory/lifecycle races, and all
555 web tests plus lint and production build through `npm run ci`. The focused
account/workspace-isolation run passed 44 tests. `git diff --check` passed.
Hosted checks and shared migration rollout are recorded separately in the PR.
