import { describe, expect, it } from "vitest"

import {
  acceptedInventoryHistoryEvents,
  isConfirmedConsumption,
  legacyInventoryHistoryEvents,
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

  it("keeps opening stock distinct from purchases and legacy locations distinct from current IDs", () => {
    const events = legacyInventoryHistoryEvents([
      {
        household_id: "household-a",
        wine_id: "wine-a",
        source_record_id: "legacy-1",
        event_type: "OPENING_BALANCE",
        quantity: 5,
        remove_reason: null,
        occurred_at: "2026-07-16T12:00:00Z",
        recorded_at: "2026-07-16T12:01:00Z",
        source_from_cellar_id: null,
        source_from_location: null,
        source_to_cellar_id: "old-cellar",
        source_to_location: "A1",
      },
      {
        household_id: "household-b",
        wine_id: "private-wine",
        source_record_id: "other",
        event_type: "REMOVE",
        quantity: 1,
        remove_reason: "DRANK",
        occurred_at: "2026-07-30T12:00:00Z",
        recorded_at: "2026-07-30T12:01:00Z",
        source_from_cellar_id: "other-cellar",
        source_from_location: "B2",
        source_to_cellar_id: null,
        source_to_location: null,
      },
    ], "household-a")

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event_key: "legacy-v01:legacy-1",
      event_source: "LEGACY_V01",
      event_type: "OPENING_BALANCE",
      destination_location_id: null,
      destination_legacy_location: "A1",
      actor_user_id: null,
      was_applied_to_stock: false,
    })
    expect(isConfirmedConsumption(events[0])).toBe(false)
  })
})
