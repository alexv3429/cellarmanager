import { describe, expect, it } from "vitest"

import {
  cleanWineText,
  findExactWine,
  findMatchingWines,
  formatWineVolume,
  getAppellationSuggestions,
  getAreaSuggestions,
  getCuveeSuggestions,
  getProducerSuggestions,
  getWineIdentityKey,
  getVintageSuggestions,
  parseWineFormatMl,
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
    color: "red",
    appellation: "Morgon",
    area: "Beaujolais",
    format_ml: 750,
  },
  {
    id: "wine-2",
    household_id: "household-1",
    producer: "Domaine Test",
    cuvee: "Cuvée A",
    vintage: 2021,
    color: "red",
    appellation: "Morgon",
    area: "Beaujolais",
    format_ml: 750,
  },
  {
    id: "wine-3",
    household_id: "household-1",
    producer: "Domaine Test",
    cuvee: "Cuvée B",
    vintage: null,
    color: "white",
    appellation: null,
    area: null,
    format_ml: 750,
  },
  {
    id: "wine-4",
    household_id: "household-2",
    producer: "Private Domaine",
    cuvee: "Private",
    vintage: 2022,
    color: "red",
    appellation: null,
    area: null,
    format_ml: 750,
  },
  {
    id: "wine-5",
    household_id: "household-1",
    producer: "Domaine Test",
    cuvee: "Cuvée A",
    vintage: 2020,
    color: "white",
    appellation: "Morgon",
    area: "Beaujolais",
    format_ml: 750,
  },
  {
    id: "wine-6",
    household_id: "household-1",
    producer: "Domaine Test",
    cuvee: "Cuvée A",
    vintage: 2020,
    color: "red",
    appellation: "Morgon",
    area: "Beaujolais",
    format_ml: 1500,
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

  it("parses and formats physical bottle volume", () => {
    expect(parseWineFormatMl("750")).toBe(750)
    expect(formatWineVolume(750)).toBe("75 cl")
    expect(formatWineVolume(187)).toBe("187 ml")
    expect(() => parseWineFormatMl("0")).toThrow(
      "Bottle format must be a positive whole number of millilitres",
    )
  })

  it("matches existing wines using color and format", () => {
    expect(
      findExactWine(
        wines,
        "household-1",
        " domaine   test ",
        "cuvée a",
        2020,
        "RED",
        750,
      )?.id,
    ).toBe("wine-1")

    expect(
      findExactWine(
        wines,
        "household-1",
        "Domaine Test",
        "Cuvée A",
        2020,
        "white",
        750,
      )?.id,
    ).toBe("wine-5")

    expect(
      findExactWine(
        wines,
        "household-1",
        "Domaine Test",
        "Cuvée A",
        2020,
        "red",
        1500,
      )?.id,
    ).toBe("wine-6")
  })

  it("builds the conservative identity without metadata", () => {
    expect(
      getWineIdentityKey(
        " Domaine   Test ",
        " CUVÉE A ",
        2020,
        " RED ",
        750,
      ),
    ).toBe(
      getWineIdentityKey(
        "domaine test",
        "cuvée a",
        2020,
        "red",
        750,
      ),
    )
    expect(
      getWineIdentityKey("", "Cuvée", null, "red", 750),
    ).toBeNull()
  })

  it("does not silently choose between ambiguous catalog rows", () => {
    const base = wines[0] as WineCatalogEntry
    const ambiguous: WineCatalogEntry[] = [
      base,
      {
        ...base,
        id: "wine-ambiguous",
        appellation: "Beaujolais",
      },
    ]

    expect(
      findMatchingWines(
        ambiguous,
        "household-1",
        "Domaine Test",
        "Cuvée A",
        2020,
        "red",
        750,
      ),
    ).toHaveLength(2)

    expect(
      findExactWine(
        ambiguous,
        "household-1",
        "Domaine Test",
        "Cuvée A",
        2020,
        "red",
        750,
      ),
    ).toBeUndefined()
  })

  it("ignores a retired duplicate during later catalog matching", () => {
    const base = wines[0] as WineCatalogEntry
    const retiredDuplicate: WineCatalogEntry = {
      ...base,
      id: "wine-retired",
      merged_into_wine_id: base.id,
    }

    expect(
      findExactWine(
        [base, retiredDuplicate],
        "household-1",
        "Domaine Test",
        "Cuvée A",
        2020,
        "red",
        750,
      )?.id,
    ).toBe(base.id)
  })

  it("keeps producer suggestions inside the selected household", () => {
    expect(
      getProducerSuggestions(wines, "household-1"),
    ).toEqual(["Domaine Test"])
  })

  it("provides contextual appellation and area suggestions", () => {
    expect(
      getAppellationSuggestions(
        wines,
        "household-1",
        "Domaine Test",
        "Cuvée A",
      ),
    ).toEqual(["Morgon"])

    expect(
      getAreaSuggestions(
        wines,
        "household-1",
        "Domaine Test",
        "Cuvée A",
      ),
    ).toEqual(["Beaujolais"])
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
