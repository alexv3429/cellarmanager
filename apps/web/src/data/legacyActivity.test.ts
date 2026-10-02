import { describe, expect, it } from "vitest"
import { buildLegacyActivity, filterLegacyActivity, type LegacyActivityRow } from "./legacyActivity"

const opening: LegacyActivityRow = {
  household_id: "home", wine_id: "wine-1", source_record_id: "source-1",
  archive_source_sha256: "archive-a", event_type: "OPENING_BALANCE", quantity: 3,
  remove_reason: null, occurred_at: "2026-07-16T12:00:00Z", recorded_at: "2026-07-16T12:01:00Z",
  source_from_cellar_id: null, source_from_location: null,
  source_to_cellar_id: "old-cellar", source_to_location: "A1",
  catalog_wine_id: "wine-1", producer: "Domaine Test", cuvee: "Cuvée", vintage: 2020,
  color: "red", format_ml: 750,
}

describe("legacy inventory activity", () => {
  it("groups opening positions without inventing purchases or double-counting wines", () => {
    const items = buildLegacyActivity([
      opening,
      { ...opening, source_record_id: "source-2", quantity: 2 },
      { ...opening, source_record_id: "source-3", wine_id: "wine-2", quantity: 1 },
      { ...opening, household_id: "other", source_record_id: "private", quantity: 99 },
    ], "home")
    expect(items).toEqual([expect.objectContaining({
      kind: "opening", entryCount: 3, quantity: 6, wineCount: 2,
    })])
    expect(filterLegacyActivity(items, { operationType: "ADD", status: "ALL", search: "" })).toEqual([])
    expect(filterLegacyActivity(items, { operationType: "ALL", status: "ARCHIVED", search: "stock initial" })).toHaveLength(1)
  })

  it("keeps confirmed old drinks separate and filters by wine and reason", () => {
    const items = buildLegacyActivity([
      opening,
      { ...opening, event_type: "REMOVE", source_record_id: "drink", quantity: 1,
        remove_reason: "DRANK", occurred_at: "2026-07-30T12:00:00Z",
        source_from_cellar_id: "old-cellar", source_from_location: "B2",
        source_to_cellar_id: null, source_to_location: null },
    ], "home")
    expect(items.map((item) => item.kind)).toEqual(["drink", "opening"])
    expect(filterLegacyActivity(items, { operationType: "REMOVE", status: "ARCHIVED", search: "Domaine Test" }))
      .toEqual([expect.objectContaining({ kind: "drink", sourceLocation: "B2" })])
    expect(filterLegacyActivity(items, { operationType: "REMOVE", status: "ACCEPTED", search: "" })).toEqual([])
  })
})
