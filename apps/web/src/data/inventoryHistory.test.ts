import { describe, expect, it } from "vitest"

import {
  acceptedInventoryHistoryEvents,
  isConfirmedConsumption,
  type InventoryHistoryOperationRow,
} from "./inventoryHistory"

function operation(
  overrides: Partial<InventoryHistoryOperationRow> = {},
): InventoryHistoryOperationRow {
  return {
    id: "operation-1",
    household_id: "household-a",
    user_id: "owner-a",
    operation_type: "ADD",
    wine_id: "wine-a",
    source_location_id: null,
    destination_location_id: "location-a",
    quantity: 2,
    remove_reason: null,
    status: "ACCEPTED",
    created_at_client: "2026-09-30T20:00:00Z",
    received_at_server: "2026-10-01T08:00:00Z",
    ...overrides,
  }
}

describe("accepted inventory history", () => {
  it("preserves accepted provenance and both offline action and server receipt times", () => {
    const events = acceptedInventoryHistoryEvents([operation()], "household-a")

    expect(events).toEqual([{
      event_key: "operation:operation-1",
      event_source: "ACCEPTED_OPERATION",
      source_record_id: "operation-1",
      household_id: "household-a",
      wine_id: "wine-a",
      event_type: "ADD",
      quantity: 2,
      source_location_id: null,
      destination_location_id: "location-a",
      remove_reason: null,
      actor_user_id: "owner-a",
      occurred_at: "2026-09-30T20:00:00Z",
      occurred_at_precision: "INSTANT",
      recorded_at: "2026-10-01T08:00:00Z",
      was_applied_to_stock: true,
    }])
  })

  it("excludes queued, rejected, unconfirmed, and other-household rows", () => {
    const events = acceptedInventoryHistoryEvents([
      operation({ id: "pending", status: "PENDING", received_at_server: null }),
      operation({ id: "rejected", status: "REJECTED" }),
      operation({ id: "unconfirmed", received_at_server: null }),
      operation({ id: "other", household_id: "household-b" }),
      operation({ id: "accepted" }),
    ], "household-a")

    expect(events.map((event) => event.source_record_id)).toEqual(["accepted"])
  })

  it("treats a move as one event and only a DRANK removal as consumption", () => {
    const events = acceptedInventoryHistoryEvents([
      operation({
        id: "move",
        operation_type: "MOVE",
        source_location_id: "location-a",
        destination_location_id: "location-b",
      }),
      operation({
        id: "gift",
        operation_type: "REMOVE",
        source_location_id: "location-b",
        destination_location_id: null,
        remove_reason: "GIFTED",
      }),
      operation({
        id: "drank",
        operation_type: "REMOVE",
        source_location_id: "location-b",
        destination_location_id: null,
        remove_reason: "DRANK",
      }),
    ], "household-a")

    expect(events).toHaveLength(3)
    expect(events.map(isConfirmedConsumption)).toEqual([false, false, true])
  })
})
