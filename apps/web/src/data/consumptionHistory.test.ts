import { describe, expect, it } from "vitest"

import {
  buildConsumptionHistory,
  type ConsumptionLegacyRow,
  type ConsumptionOperationRow,
} from "./consumptionHistory"

const now = new Date("2026-10-02T15:00:00Z")
const modern: ConsumptionOperationRow = {
  id: "drink-1", household_id: "home", wine_id: "wine-1", catalog_wine_id: "wine-1",
  producer: "Domaine", cuvee: "Cuvée", vintage: 2024,
  operation_type: "REMOVE", quantity: 2, remove_reason: "DRANK", status: "ACCEPTED",
  created_at_client: "2026-09-30T12:00:00Z", received_at_server: "2026-09-30T12:00:10Z",
  source_cellar_name: "Service", source_code: "A1",
}
const imported: ConsumptionLegacyRow = {
  source_record_id: "old-drink", household_id: "home", archive_source_sha256: "archive-1",
  wine_id: "wine-2", catalog_wine_id: "wine-2", producer: "Barraud", cuvee: "En France",
  vintage: 2019, event_type: "REMOVE", quantity: 1, remove_reason: "DRANK",
  occurred_at: "2026-07-01T10:00:00Z", source_from_location: "Old shelf",
}

describe("consumption history", () => {
  it("lists only confirmed bottles recorded as drunk, newest first", () => {
    const operations = [
      modern,
      { ...modern, id: "gift", remove_reason: "GIFTED" },
      { ...modern, id: "pending", status: "PENDING" },
      { ...modern, id: "no-receipt", received_at_server: null },
      { ...modern, id: "other-house", household_id: "other" },
      { ...modern, id: "future", created_at_client: "2026-10-03T10:00:00Z" },
      { ...modern, id: "zero", quantity: 0 },
      { ...modern, id: "move", operation_type: "MOVE" },
    ]
    const legacy = [imported, { ...imported, source_record_id: "opening", event_type: "OPENING_BALANCE" }]
    const result = buildConsumptionHistory(operations, legacy, "home", "12m", now)
    expect(result.entries.map((entry) => entry.id)).toEqual(["operation:drink-1", "legacy:archive-1:old-drink"])
    expect(result.entries[0].location).toBe("Service / A1")
    expect(result.entries[1].source).toBe("imported")
    expect(result.bottles).toBe(3)
    expect(result.wines).toBe(2)
  })

  it("keeps period filtering aligned with statistics and allows all recorded history", () => {
    expect(buildConsumptionHistory([modern], [imported], "home", "30d", now).entries).toHaveLength(1)
    const older = { ...imported, occurred_at: "2024-01-01T10:00:00Z" }
    expect(buildConsumptionHistory([], [older], "home", "12m", now).entries).toHaveLength(0)
    expect(buildConsumptionHistory([], [older], "home", "all", now).entries).toHaveLength(1)
  })

  it("does not mix multiple legacy archives or households", () => {
    const result = buildConsumptionHistory([modern], [
      imported,
      { ...imported, source_record_id: "other-archive", archive_source_sha256: "archive-2" },
      { ...imported, household_id: "other", archive_source_sha256: "archive-3" },
    ], "home", "all", now)
    expect(result.archiveAmbiguous).toBe(true)
    expect(result.entries.map((entry) => entry.id)).toEqual(["operation:drink-1"])
  })

  it("counts merged wines once while preserving separate consumption records", () => {
    const result = buildConsumptionHistory([
      modern,
      { ...modern, id: "drink-2", wine_id: "merged-wine", catalog_wine_id: "wine-1" },
    ], [], "home", "all", now)
    expect(result.bottles).toBe(4)
    expect(result.wines).toBe(1)
  })
})
