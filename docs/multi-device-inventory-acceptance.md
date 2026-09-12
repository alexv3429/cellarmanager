# Concurrent multi-device inventory acceptance — 0.5.8

This step strengthens verification of the existing stock model. It adds no new
screen, database migration, production fixture, or permission. Owners can mutate
stock; Members remain read-only. The next step, **0.5.9**, improves conflict and
rejected-operation explanations and recovery.

## Run locally

```bash
npm run supabase -- start
# Only if the LOCAL database has pending repository migrations:
npm run supabase -- migration up --local
npm run inventory:test
npm run supabase -- test db
npm run inventory:acceptance
npm run web:ci
git diff --check
```

Never substitute a linked/production migration command. The acceptance script
refuses missing local migration versions and remote Docker endpoints. It accepts
no database URL, account credentials, or caller-selected database target. It uses
the local `supabase_db_cellarmanager` container over a Unix socket.

The script reads the source database's migration versions and **schema only**
(`auth`, `public`, `private`), preserving owners, grants, policies, and functions.
It restores that schema and required local extensions into a newly created
`cm_inventory_acceptance_<random 24-hex suffix>` database. No rows, passwords,
tokens, wine profiles, or real cellar data are copied. Fixtures use random UUIDs
and `example.test` addresses with no passwords. Stock RPCs run as `authenticated`
with synthetic user claims, not as an administrator.

Only the database successfully created by that run is dropped on completion,
failure, or an interrupt during the scenarios. Its exact name is printed.
An OS crash or forced process kill can prevent cleanup: inspect any leftover
temporary database and remove only that exact generated database, never
`postgres`, a workspace, or a wildcard target. The script never resets the local
stack or changes its existing holdings, operations, accounts, or migrations.

## What the automated checks prove

These are genuinely simultaneous database transactions, not sequential pgTAP
calls or a mock `Promise.all`. A separate session holds the household advisory
lock; each contender starts in a distinct PostgreSQL backend. The harness checks
`pg_locks` to prove all contenders are waiting before releasing the lock. Queue
order is established explicitly, both relevant orders are exercised, and server
and process timeouts bound failures.

The 12 scenarios cover:

- Two devices of one Owner remove the last bottle, in both reconnect orders:
  one accepted effect, one `INSUFFICIENT_STOCK` receipt, no negative stock.
- Two Owners compete to move or remove the same bottle, in both orders:
  no duplicate bottle at the destination.
- Simultaneous additions to a previously absent holding: neither increment lost.
- Opposing moves: no deadlock and the total stock preserved.
- Duplicate delivery and a retry after a lost response: one journal row and one
  effect, with unchanged holdings, revisions, and receipts on replay.
- Reusing an operation UUID with a different quantity or device: refused without
  changing the first operation's result.
- Two independently requested new-wine IDs with the same unambiguous identity:
  one canonical wine, both additions counted, and idempotent replay. Subsequent
  actions on a locally new wine still wait for initial synchronization.
- Device revocation racing an upload, in both orders: a write accepted before
  revocation remains recorded; revocation winning first denies it. Fresh writes
  are denied afterwards; replaying a previously accepted receipt changes no stock.
- A read-only Member racing an Owner: the Member cannot mutate stock.

Authenticated reads compare committed holdings and journals for both Owners and
the Member. Separate web tests verify that a terminal stock rejection does not
block the next valid upload, an interrupted batch keeps identical operation IDs
and payloads on retry, and both local projections converge once they receive
the authoritative holdings and terminal journal (including canonical new-wine
identity replacement).

The existing **Supabase database tests** CI job runs both pgTAP and this suite;
it remains a dependency of **CI Gate**. `npm run ci` includes the helper safety
tests and web regressions; the Docker-dependent acceptance command is separate.

## Boundaries and optional phone/PC validation

The suite does **not** run the hosted PowerSync replication service, browser
IndexedDB/Web Locks, physical network loss, email invitations, or session refresh.
Database concurrency and web connector/projection behavior are tested at their
boundaries. Full membership security coverage remains **0.5.11**, and end-to-end
release acceptance remains **0.5.13**.

For additional device validation, use a **disposable test household** with a fake
wine, not the real cellar. No destructive stock test is required on production
data. There is no new interface to find in 0.5.8.

1. Sign in as an Owner on PC and phone (or two independent browser profiles).
   Fully synchronize one synthetic bottle at location A, with an empty B.
2. Take both devices offline. Queue a move A → B on one and a removal from A on
   the other. Each should show its own pending action.
3. Reconnect the first device and wait until synchronized, then reconnect the
   second. Both should settle on the first accepted result; Activity should show
   one synced action and one rejected action, not two successful claims.
4. Refresh both: quantities and locations must remain identical. Retry must not
   duplicate the stock change. Repeat with fresh synthetic stock in reverse order.
5. Optionally inspect the same test household as a Member: the result is readable,
   but stock actions remain unavailable.

Do not claim this manual checklist passed unless it was actually performed.

## Implementation validation — 2026-09-12

- `npm run ci`: passed, including 463 web tests and the production build.
- Local pgTAP: 38 files, 1,035 assertions passed.
- Concurrent acceptance: all 12 scenarios passed on repeated isolated runs.
- `git diff --check`: passed.
- No production data change or migration; the manual phone/PC checklist above
  was not performed as part of this automated acceptance work.
