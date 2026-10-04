import { describe, expect, it } from "vitest"

import {
  buildInventoryInsights,
  type InsightsLegacyRow,
  type InsightsOperationRow,
} from "./inventoryInsights"

const now = new Date("2026-10-02T15:00:00Z")
const opening: InsightsLegacyRow = {
  household_id: "home", archive_source_sha256: "archive-1",
  event_type: "OPENING_BALANCE", quantity: 10, remove_reason: null,
  occurred_at: "2025-01-01T10:00:00Z",
}
const operation: InsightsOperationRow = {
  household_id: "home", operation_type: "ADD", quantity: 4, remove_reason: null,
  status: "ACCEPTED", created_at_client: "2026-09-30T12:00:00Z",
  received_at_server: "2026-09-30T12:00:10Z",
}

describe("inventory statistics", () => {
  it("counts accepted additions and removals, but not moves, pending requests or opening stock", () => {
    const result = buildInventoryInsights([
      operation,
      { ...operation, operation_type: "REMOVE", quantity: 2, remove_reason: "DRANK" },
      { ...operation, operation_type: "MOVE", quantity: 7 },
      { ...operation, operation_type: "ADD", quantity: 30, status: "PENDING" },
      { ...operation, operation_type: "REMOVE", quantity: 30, status: "REJECTED" },
      { ...operation, household_id: "other", quantity: 50 },
    ], [opening, { ...opening, household_id: "other", quantity: 100 }],
    "home", 12, "30d", now)

    expect(result).toMatchObject({
      currentStock: 12, added: 4, removed: 2, consumed: 2, net: 2,
      stockHistoryAvailable: true,
    })
    expect(result.buckets.at(-1)?.closingStock).toBe(12)
  })

  it("includes a historical drink in its actual period, without treating the opening balance as an addition", () => {
    const result = buildInventoryInsights([operation], [
      opening,
      { ...opening, event_type: "REMOVE", quantity: 1, remove_reason: "DRANK",
        occurred_at: "2026-09-27T12:00:00Z" },
    ], "home", 13, "30d", now)
    expect(result).toMatchObject({ added: 4, removed: 1, consumed: 1, net: 3, stockHistoryAvailable: true })
  })

  it("withholds the stock curve when the imported baseline does not reconcile with holdings", () => {
    const result = buildInventoryInsights([operation], [opening], "home", 99, "12m", now)
    expect(result.added).toBe(4)
    expect(result.currentStock).toBe(99)
    expect(result.stockHistoryAvailable).toBe(false)
    expect(result.buckets.every((bucket) => bucket.closingStock === null)).toBe(true)
  })

  it("starts a reconciled stock curve at the imported snapshot, leaving earlier months blank", () => {
    const result = buildInventoryInsights([operation], [{
      ...opening, occurred_at: "2026-07-16T10:00:00Z",
    }], "home", 14, "12m", now)
    expect(result.stockHistoryAvailable).toBe(true)
    expect(result.buckets[0].closingStock).toBeNull()
    expect(result.buckets.find((bucket) => bucket.start.startsWith("2026-07"))?.closingStock).toBe(10)
    expect(result.buckets.at(-1)?.closingStock).toBe(14)
  })

  it("withholds the curve for absent or ambiguous opening balances and incomplete receipts", () => {
    expect(buildInventoryInsights([operation], [], "home", 4, "12m", now).stockHistoryAvailable).toBe(false)
    expect(buildInventoryInsights([operation], [
      opening, { ...opening, archive_source_sha256: "archive-2", quantity: 1 },
    ], "home", 15, "12m", now).stockHistoryAvailable).toBe(false)
    expect(buildInventoryInsights([{ ...operation, received_at_server: null }], [opening], "home", 10, "12m", now)
      .stockHistoryAvailable).toBe(false)
  })

  it("uses the selected household and excludes future or unconfirmed movements", () => {
    const result = buildInventoryInsights([
      operation,
      { ...operation, household_id: "other", quantity: 100 },
      { ...operation, created_at_client: "2027-01-01T12:00:00Z", quantity: 100 },
    ], [opening], "home", 14, "12m", now)
    expect(result.added).toBe(4)
    expect(result.stockHistoryAvailable).toBe(false)
  })

  it("groups present stock and confirmed flows by color and region without losing unknown facts", () => {
    const result = buildInventoryInsights([
      { ...operation, quantity: 2, color: "red", area: "Bourgogne" },
      { ...operation, operation_type: "REMOVE", quantity: 1, color: "white", area: "Bourgogne" },
      { ...operation, operation_type: "MOVE", quantity: 5, color: "red", area: "Rhône" },
      { ...operation, status: "PENDING", quantity: 20, color: "red", area: "Rhône" },
      { ...operation, household_id: "other", quantity: 30, color: "red", area: "Rhône" },
    ], [opening, {
      ...opening, event_type: "REMOVE", quantity: 1, remove_reason: "DRANK",
      occurred_at: "2026-09-27T12:00:00Z", color: "red", area: "Rhône",
    }], "home", 11, "30d", now, [
      { household_id: "home", quantity: 5, color: "red", area: "Bourgogne" },
      { household_id: "home", quantity: 3, color: "white", area: "Bourgogne" },
      { household_id: "home", quantity: 2, color: "red", area: "Rhône" },
      { household_id: "home", quantity: 1, color: null, area: null },
      { household_id: "other", quantity: 50, color: "red", area: "Rhône" },
    ])

    expect(result).toMatchObject({ added: 2, removed: 2, currentStock: 11 })
    expect(result.byColor).toEqual([
      { key: "red", label: "red", current: 7, added: 2, removed: 1 },
      { key: "white", label: "white", current: 3, added: 0, removed: 1 },
      { key: "__unknown__", label: null, current: 1, added: 0, removed: 0 },
    ])
    expect(result.byRegion).toEqual([
      { key: "bourgogne", label: "Bourgogne", current: 8, added: 2, removed: 1 },
      { key: "rhône", label: "Rhône", current: 2, added: 0, removed: 1 },
      { key: "__unknown__", label: null, current: 1, added: 0, removed: 0 },
    ])
  })
})
