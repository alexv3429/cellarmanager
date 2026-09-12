# ADR 002: inventory operation model

- Status: Accepted
- Date: 2026-08-03
- Implemented: v0.2.0; acceptance extended in v0.5 step 0.5.8

## Context

Several devices may act on the same physical stock, including while one device
is offline. Letting clients overwrite quantities would lose concurrent changes
and make the authoritative cellar unknowable.

## Decision

- ADD, MOVE, and REMOVE are immutable operations with UUIDs.
- Clients do not overwrite authoritative quantities.
- PostgreSQL validates each submitted operation and updates authoritative
  holdings transactionally when it accepts the operation.
- Replaying the same operation UUID is idempotent.
- Invalid or conflicting operations are rejected explicitly and remain visible
  to the originating user.
- The local client may project queued operations optimistically, but server
  acceptance determines the synchronized result.
- Current inventory is read from holdings. Historical journals explain changes;
  they are not replayed to reconstruct migrated or imported current stock.

## Alternatives considered

- Last-write-wins holding updates are simple but can silently erase concurrent
  changes.
- Making a client authoritative while offline cannot resolve competing device
  claims safely.
- Rebuilding every current holding from the entire historical journal would
  misrepresent the v0.1 migration and complicate recovery without improving
  current-state authority.

## Consequences

- A queued operation can later be rejected after another device changes stock.
- UI and activity views must distinguish queued, synchronized, and rejected
  operations.
- Imports and migrations may establish holdings through guarded domain rules
  without fabricating historical operations.
- Conflict behavior requires multi-device and offline/reconnect acceptance.

## Validation

The Supabase pgTAP suite covers operation validation, idempotency, holdings, and
security. Web tests cover optimistic projection, upload/replay, and state
presentation. Step 0.5.8 adds independent PostgreSQL sessions competing behind a
verified lock barrier, with both connection orders, terminal journal replay, and
authorized read convergence. It also tests partial-batch upload retry and local
projection convergence from synchronized snapshots. These are boundary tests,
not a claim of live PowerSync/browser transport acceptance. See
[`../multi-device-inventory-acceptance.md`](../multi-device-inventory-acceptance.md)
and [`../activity-and-sync.md`](../activity-and-sync.md).
