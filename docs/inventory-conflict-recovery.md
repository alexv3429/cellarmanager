# Conflict and queued-request recovery — 0.5.9

Activity distinguishes two cases that need different responses. No control in
this step automatically replaces, retries under a new ID, or reverses a stock
request. Owners retain the normal stock controls; Members remain read-only.

## A request was rejected

An `INSUFFICIENT_STOCK` or `LOCATION_ARCHIVED` receipt is terminal. Its card says
**Not applied**, explains the problem, and confirms that this request changed no
stock. **Show rejected changes** filters the latest 100 journal entries. Technical
codes and the original request ID remain under an explicit disclosure.

**Review current stock** opens the current canonical wine detail, including after
a duplicate merge. Review locations and quantities first. An Owner can then use
the existing Add / Move / Remove controls to make a separate, deliberate change.
The old rejection remains in Activity. There is no one-click retry: another
device's accepted change must not be silently overridden. An unsynchronized or
missing wine stays readable without a broken detail link.

## A request is still queued on this browser

Temporary network failures retry automatically with the original ID and payload.
Device revocation or loss of Owner permission can instead leave a request blocked;
later requests, including those for other households, can wait behind it.

Activity's **Queued on this browser** section lists up to 100 of the signed-in
account's unreviewed requests, oldest first, across households. It identifies the
wine, action, quantity, locations, household, original registration and request ID.
The header's sync-error notice links to Activity. If no household remains, the
recovery section is also available above onboarding or the household-load error.
An empty new account does not receive an extra onboarding section.

Choose **Review request**, then either **Keep queued** or **Confirm: stop this
request**. Stopping requires connectivity and explicit confirmation for each
request. It is permanent for that ID, but never undoes an already accepted change.

The server checks the request under the same household and operation-ID locks as
stock acceptance:

- Already accepted: return the original receipt, keep the stock change, and tell
  the user to wait for synchronization before making any separate correction.
- Already rejected: return the original rejection and retain its journal entry.
- Not processed: preserve the original request privately and prevent this UUID
  from subsequently creating stock or an offline new-wine catalog entry.

An uncertain response is not displayed as a successful stop. The browser retains
the queue, offers a history refresh, and permits reviewing **the same request**
again. This reconciles its ID; it does not invent a replacement. Account,
household and connectivity changes close confirmations and discard stale results.

**Show my stopped requests** loads the author's latest 100 private stopped
requests for the selected household (across their households on the standalone
recovery screen). Other household members, including Owners, cannot read this
private history. It is fetched online, not replicated into every member's cache.
Already accepted/rejected requests remain in the ordinary inventory journal.

## Server and client contracts

Apply `20260912170000_inventory_upload_recovery.sql` before testing the live
recovery controls. It adds two authenticated RPCs and a private stop-record table,
and wraps the existing stock RPCs with the cancellation check. It does not rewrite
existing wine, stock, account, device, membership or journal rows. Older clients
still use the same stock RPC signatures and receive terminal `USER_CANCELLED`
receipts for stopped IDs. The legacy ADD overload is guarded too.

`stop_inventory_upload` validates the author, original registration, household,
operation ID, positive quantity and bounded request. It allows a revoked,
demoted or removed author to resolve only their own old queue. That exception
grants no stock-write or other-user access. Calls are idempotent; original payloads
cannot be rewritten (display labels may change while reconciling; the first
captured labels are kept). The limit is 1,000 new stops per account per day.

`get_stopped_inventory_uploads` returns only the authenticated author's bounded
private history. The underlying table and unlocked helpers are not callable by
browser roles. Stop records intentionally outlive the original stock/catalog
references: deleting a reference must not revive an old operation ID. Account
erasure/retention policy must address this private history in the later account
data-lifecycle work; this step does not introduce an automatic deletion job.

After verifying a scoped terminal receipt, the client stores it in the
**local-only** `inventory_upload_receipts` PowerSync table. This write creates no
new upload. The connector can acknowledge that exact ID, author, registration,
household and payload without retrying a forbidden stock call. A mismatched,
malformed or nonterminal cached receipt never bypasses upload. The normal SDK
transaction completion/checkpoint process removes acknowledged queue entries;
the app does not edit PowerSync internals or manually rewrite the stock journal.

Until synchronization/checkpoint reconciliation finishes, local optimistic stock
or pending indicators may still be visible. A verified stop's message explicitly
distinguishes it from a stock change. Do not make compensating changes against a
still-pending projection. Local receipt cache clears with the ordinary sign-out
and account-change database cleanup; the server's stop record remains durable.
No hosted PowerSync sync-rule changes are required.

## Safe validation

Use a disposable household and fake wine for mutation checks, never the real
cellar. Normal users do not need to provoke rejections to use Activity.

1. On two Owner browsers, synchronize one fake bottle. Queue conflicting moves
   or removals while offline, reconnect one then the other. Activity should show
   one synced request and one **Not applied** rejection with a clear explanation.
2. Filter rejections, expand technical details, then **Review current stock**.
   It must open the correct wine. Going back should not apply any new change.
3. In a disposable browser, queue a fake request offline. From another Owner
   browser revoke that registration. Reconnect: review the blocked request in
   Activity. **Keep queued** changes nothing; confirm stopping should show either
   a stop or the actual already-processed result, never promise to undo stock.
4. Wait for synchronization. Refresh; the stopped request must not return as a
   new stock effect. Private stopped history should retain the original intent.
   A later valid queued request for an active registration must be able to upload.
5. A Member may resolve their own previously queued request but cannot create
   shared stock changes, resolve another author's request or read private history.
6. Offline: stopping is disabled. On a phone, request text and buttons wrap without
   horizontal scrolling; confirmation and Keep queued are clearly separated.

Automated database checks use rollback fixtures. The isolated concurrency suite
adds stop-vs-MOVE and stop-vs-new-wine-ADD races in both orders to the previous 12
scenarios. Web regressions exercise receipt scope, exact-payload acknowledgment,
uncertain responses, identity switches, confirmations and rejected-stock links.
These checks do not replace physical phone/PC testing or the hosted PowerSync
replication acceptance planned for the v0.5 release.

## Implementation validation — 2026-09-13

- `npm run ci` passed, including 520 web tests, lint and the production build.
- Local pgTAP passed: 39 files, 1,074 assertions.
- All 16 isolated concurrent acceptance scenarios passed, including canonical
  new-wine receipt recovery and both stop/upload orders.
- Real Activity/recovery components were exercised with synthetic RPC/query data
  in the browser: confirmation, cancellation, stop result, current-stock callback,
  Owner/Member navigation and offline messaging. At a 390-pixel viewport the
  document width remained 390 pixels; the confirmation content did not overflow.
- `git diff --check` passed. Existing unrelated stash was preserved.
- Only local Supabase received the migration. No shared/production database,
  cellar stock, user account or device registration was modified. Live hosted
  PowerSync recovery and physical phone validation remain to be performed after
  the migration is explicitly approved for the shared backend.
