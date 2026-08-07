import { describe, expect, it } from "vitest"

import {
  cleanWineText,
  findExactWine,
  getCuveeSuggestions,
  getProducerSuggestions,
  getVintageSuggestions,
  parseWineVintage,
  type WineCatalogEntry,
} from "./wineCatalog"

const wines: WineCatalogEntry[] = [
  {
    id: "wine-1",
    household_id: "household-1",
    producer: "Domaine Test",
    cuvee: "Cuvée A",
    vintage: 2020,
  },
  {
    id: "wine-2",
    household_id: "household-1",
    producer: "Domaine Test",
    cuvee: "Cuvée A",
    vintage: 2021,
  },
  {
    id: "wine-3",
    household_id: "household-1",
    producer: "Domaine Test",
    cuvee: "Cuvée B",
    vintage: null,
  },
  {
    id: "wine-4",
    household_id: "household-2",
    producer: "Private Domaine",
    cuvee: "Private",
    vintage: 2022,
  },
]

describe("wine catalog entry helpers", () => {
  it("cleans surrounding and repeated whitespace", () => {
    expect(cleanWineText("  Domaine   Test  ")).toBe(
      "Domaine Test",
    )
  })

  it("parses a vintage or blank NV value", () => {
    expect(parseWineVintage("2020")).toBe(2020)
    expect(parseWineVintage("  ")).toBeNull()
    expect(() => parseWineVintage("20")).toThrow(
      "Vintage must be a four-digit year or blank for NV",
    )
  })

  it("matches existing wines case-insensitively", () => {
    expect(
      findExactWine(
        wines,
        "household-1",
        " domaine   test ",
        "cuvée a",
        2020,
      )?.id,
    ).toBe("wine-1")
  })

  it("keeps producer suggestions inside the selected household", () => {
    expect(
      getProducerSuggestions(wines, "household-1"),
    ).toEqual(["Domaine Test"])
  })

  it("provides contextual cuvée and vintage suggestions", () => {
    expect(
      getCuveeSuggestions(
        wines,
        "household-1",
        "Domaine Test",
      ),
    ).toEqual(["Cuvée A", "Cuvée B"])

    expect(
      getVintageSuggestions(
        wines,
        "household-1",
        "Domaine Test",
        "Cuvée A",
      ),
    ).toEqual([2021, 2020])
  })
})
