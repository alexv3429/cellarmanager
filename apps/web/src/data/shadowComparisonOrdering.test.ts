import { describe, expect, it } from "vitest"

import { orderShadowComparisonRows } from "./shadowComparisonOrdering"

describe("whole-cellar comparison ordering", () => {
  it("shows changed proposals before unmatched wines even in a large cellar", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      wineId: `no-match-${index}`, comparisonStatus: "no_match",
    }))
    rows.push({ wineId: "pilot", comparisonStatus: "changed" })
    const ordered = orderShadowComparisonRows(rows, new Map([["pilot", "Burgaud Côte du Py"]]))

    expect(ordered[0]).toEqual({ wineId: "pilot", comparisonStatus: "changed" })
    expect(ordered).toHaveLength(41)
    expect(rows[40].wineId).toBe("pilot")
  })

  it("puts new proposed dates and preserved manual dates ahead of no matches", () => {
    const rows = [
      { wineId: "unmatched", comparisonStatus: "no_match" },
      { wineId: "manual", comparisonStatus: "manual_preserved" },
      { wineId: "new", comparisonStatus: "new_reference_no_baseline" },
      { wineId: "same", comparisonStatus: "unchanged" },
    ]

    expect(orderShadowComparisonRows(rows, new Map()).map((row) => row.wineId))
      .toEqual(["new", "manual", "unmatched", "same"])
  })
})
