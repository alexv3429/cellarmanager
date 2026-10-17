import { describe, expect, it } from "vitest"

import type { MaturityOverviewItem, MaturityState } from "./wineMaturity"
import { buildDrinkingWindowDashboard, type DrinkingWindowStockRow } from "./drinkingWindowDashboard"

function stock(id: string, quantity: number, household_id = "home"): DrinkingWindowStockRow {
  return { id, household_id, producer: "Domaine Test", cuvee: id, vintage: 2020, quantity }
}

function guidance(wineId: string, state: MaturityState | null, year: number | null = null): MaturityOverviewItem {
  return {
    wineId, state, firstTrialYear: year, drinkByYear: year, bestStartYear: year,
    bestEndYear: year, urgencyScore: 1, assessmentReason: null, calculatedAt: null,
    confidence: null, confidenceLabel: null, demandStatus: null, feedbackVerdict: null,
    headline: null, isOverride: false, isPersonalized: false, moveMessage: null,
    moveNeeded: false, personalYearShift: 0, profileLayers: [], profileWarnings: [],
    projectionId: null, specificity: null, stateLabel: null, storagePurpose: null,
    urgency: null,
  }
}

describe("drinking-window dashboard", () => {
  it("counts current bottles by their effective guidance state, including missing guidance", () => {
    const result = buildDrinkingWindowDashboard([
      stock("priority", 3), stock("assess-now", 2), stock("ready", 4),
      stock("assess", 1), stock("hold", 5), stock("missing", 6),
      stock("empty", 0), stock("other-household", 100, "other"),
    ], [
      guidance("priority", "priority", 2027), guidance("assess-now", "assess-now", 2026),
      guidance("ready", "ready", 2030), guidance("assess", "assess", 2026),
      guidance("hold", "hold", 2028),
    ], "home")

    expect(result.totalBottles).toBe(21)
    expect(result.groups.soon.bottles).toBe(5)
    expect(result.groups.soon.wines.map((item) => item.wine.id)).toEqual(["assess-now", "priority"])
    expect(result.groups.ready.bottles).toBe(4)
    expect(result.groups.assess.bottles).toBe(1)
    expect(result.groups.hold.bottles).toBe(5)
    expect(result.groups.unassessed.bottles).toBe(6)
    expect(result.groups.unassessed.wines[0].guidance).toBeNull()
  })

  it("does not mistake an unassessed overview row for a recommendation", () => {
    const result = buildDrinkingWindowDashboard([stock("unassessed", 2)], [
      guidance("unassessed", null),
    ], "home")
    expect(result.groups.unassessed.bottles).toBe(2)
    expect(result.groups.soon.bottles).toBe(0)
  })
})
