import assert from "node:assert/strict"
import test from "node:test"

import { normalizeLegacyMovements } from "./restore_movements_lib.mjs"
import { renderLegacyMovementsSql } from "./restore_movements_sql.mjs"

const HOUSEHOLD = "00000000-0000-4000-8000-000000000100"
const WINE = "00000000-0000-4000-8000-000000000110"
const CELLAR = "00000000-0000-4000-8000-000000000120"
const HOLDING = "00000000-0000-4000-8000-000000000130"
const OWNER = "00000000-0000-4000-8000-000000000001"
const SOURCE = "a".repeat(64)

function movement(id, overrides = {}) {
  return {
    id,
    action: "import",
    wine_id: WINE,
    holding_id: HOLDING,
    from_cellar_id: null,
    from_location: null,
    to_cellar_id: CELLAR,
    to_location: "A",
    quantity_delta: 2,
    occurred_at: "2026-07-16T16:25:07.062024+00:00",
    recorded_at: "2026-07-16T16:25:08.062024+00:00",
    note: "initial stock",
    ...overrides,
  }
}

function plan(movements) {
  return normalizeLegacyMovements({
    movements,
    sourceWineIds: [WINE],
    householdId: HOUSEHOLD,
    sourceSha256: SOURCE,
  })
}

test("opening stock, confirmed drinks, and metadata edits have distinct semantics", () => {
  const result = plan([
    movement("00000000-0000-4000-8000-000000009001"),
    movement("00000000-0000-4000-8000-000000009002", {
      action: "remove", quantity_delta: -1, note: "drunk",
      from_cellar_id: CELLAR, from_location: "A",
      to_cellar_id: null, to_location: null,
    }),
    movement("00000000-0000-4000-8000-000000009003", {
      action: "enrich", quantity_delta: 0,
    }),
    movement("00000000-0000-4000-8000-000000009004", {
      action: "update", quantity_delta: 0,
    }),
  ])
  assert.deepEqual(result.report, {
    source_movement_count: 4,
    opening_balance_count: 1,
    opening_balance_bottles: 2,
    confirmed_drink_count: 1,
    confirmed_drink_bottles: 1,
    excluded_nonstock_count: 2,
    excluded_actions: { enrich: 1, update: 1 },
    blockers: [],
  })
  assert.deepEqual(result.rows.map((row) => [row.event_type, row.quantity, row.remove_reason]), [
    ["OPENING_BALANCE", 2, null], ["REMOVE", 1, "DRANK"],
  ])
  assert.equal(result.rows[0].source_to_location, "A")
  assert.equal(result.rows[0].source_from_location, null)
  assert.match(result.rows[0].id, /^[0-9a-f-]{36}$/u)
  assert.equal(plan([...[
    movement("00000000-0000-4000-8000-000000009002", {
      action: "remove", quantity_delta: -1, note: "drunk",
      from_cellar_id: CELLAR, from_location: "A", to_cellar_id: null, to_location: null,
    }),
    movement("00000000-0000-4000-8000-000000009001"),
    movement("00000000-0000-4000-8000-000000009004", { action: "update", quantity_delta: 0 }),
    movement("00000000-0000-4000-8000-000000009003", { action: "enrich", quantity_delta: 0 }),
  ]]).plan_sha256, result.plan_sha256)
})

test("ambiguous stock actions and damaged provenance block SQL generation", () => {
  const result = plan([
    movement("00000000-0000-4000-8000-000000009001", { wine_id: "00000000-0000-4000-8000-000000009999" }),
    movement("00000000-0000-4000-8000-000000009002", { action: "transfer" }),
    movement("00000000-0000-4000-8000-000000009003", { action: "enrich", quantity_delta: 1 }),
    movement("00000000-0000-4000-8000-000000009004", {
      action: "remove", quantity_delta: -1, note: "unknown",
      from_cellar_id: CELLAR, from_location: "A", to_cellar_id: null, to_location: null,
    }),
  ])
  assert.equal(result.report.blockers.length, 4)
  assert.throws(() => renderLegacyMovementsSql({ mode: "preview", plan: result, importedBy: OWNER }), /blockers/u)
})

test("preview rolls back, rehearsal rolls back, and apply requires the reviewed fingerprint", () => {
  const proposal = plan([movement("00000000-0000-4000-8000-000000009001")])
  const preview = renderLegacyMovementsSql({ mode: "preview", plan: proposal, importedBy: OWNER })
  assert.match(preview, /create temporary table _v01_history_state/u)
  assert.match(preview, /rollback;\s*$/u)
  assert.doesNotMatch(preview, /insert into public\.legacy_inventory_events/u)
  assert.throws(() => renderLegacyMovementsSql({ mode: "apply", plan: proposal, importedBy: OWNER }), /fingerprint/u)

  const fingerprint = "b".repeat(32)
  const rehearsal = renderLegacyMovementsSql({ mode: "rehearsal", plan: proposal,
    importedBy: OWNER, expectedPreviewFingerprint: fingerprint })
  assert.match(rehearsal, /insert into public\.legacy_inventory_events/u)
  assert.match(rehearsal, /rollback;\s*$/u)
  assert.match(rehearsal, /Current inventory changed during historic movement import/u)

  const apply = renderLegacyMovementsSql({ mode: "apply", plan: proposal,
    importedBy: OWNER, expectedPreviewFingerprint: fingerprint })
  assert.match(apply, /commit;\s*$/u)
  assert.match(apply, /Historic movement preview changed/u)
})
