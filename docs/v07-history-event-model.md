# Historical reporting event model (0.7.1)

The cellar's **current stock** remains the quantity in `public.holdings`. A
history report describes past actions; it must never reconstruct or correct
current stock by summing these events. The existing `inventory_operations`
journal remains the source for accepted modern ADD, MOVE, and REMOVE actions.

`public.inventory_reporting_events` is a read-only, household-scoped view over
that journal. The local-first `acceptedInventoryHistoryEvents` adapter gives
the synchronized journal the same fields while offline; a future timeline must
use that local projection rather than require a live view query. Both include
only `ACCEPTED` operations: queued local requests and
server-rejected attempts belong in operational activity, not consumption or
purchase totals. The view has no write path and uses the caller's permissions
and the underlying household row-level security. It adds no table, trigger, or
change to an inventory RPC.

## Stable reporting fields

| Field | Meaning |
|---|---|
| `event_key` | Stable, source-namespaced key (`operation:<UUID>`); retrying an operation cannot create a second event. |
| `event_source`, `source_record_id` | Provenance; currently `ACCEPTED_OPERATION` and the original operation UUID. |
| `household_id`, `wine_id` | Private household scope and stable wine identity. A later wine merge does not rewrite the old event. |
| `event_type`, `quantity` | ADD, MOVE, or REMOVE and positive bottle count. MOVE is one event, not consumption plus acquisition. |
| `source_location_id`, `destination_location_id`, `remove_reason` | Original movement context. Only REMOVE has a removal reason; only `DRANK` is confirmed drinking. |
| `actor_user_id` | The user who submitted an accepted modern operation; historical imports may have no verified actor. |
| `occurred_at`, `occurred_at_precision` | Client-claimed action time and its precision (`INSTANT` here). It may differ from server time after offline use or device clock skew. |
| `recorded_at` | Server receipt time, retained for audit and deterministic tie-breaking. |
| `was_applied_to_stock` | True for accepted modern operations. It records past acceptance, **not** an instruction to apply stock again. |

## Next-step boundary

Step 0.7.2 will inspect the preserved v0.1 movement schema, normalize only
useful records, and add separate, provenance-labelled legacy history. It must
use exact preserved wine UUIDs, a stable source key, and a preview-first,
idempotent import. A legacy event describes an old action whose effect is
already reflected in the migrated holdings; it must not invoke ADD/MOVE/REMOVE
or claim a modern user, device, or timestamp precision that the archive lacks.
The reporting contract can then include those legacy events without changing
the authoritative inventory journal. Unmatched, ambiguous, or undated source
rows must be reported rather than guessed into the timeline.

## Acceptance

- An accepted ADD, MOVE, or REMOVE appears once with its original wine,
  locations, quantity, reason, and both timestamps.
- A rejected operation and an unconfirmed local request do not appear in the
  reporting view; they remain visible through the existing operational UI.
- A household member can read only their household's reporting events. An
  anonymous visitor cannot read the view, and an authenticated browser cannot
  write through it.
- Querying the view cannot change holdings or create inventory operations.

The database and local-adapter regression tests use synthetic households and
operations. No
production cellar or private v0.1 archive is mutated by this step.
