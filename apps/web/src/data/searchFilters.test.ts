import { describe, expect, it } from "vitest"

import {
  matchesSearch,
  normalizeSearchText,
} from "./searchFilters"

describe("search filters", () => {
  it("normalizes case, accents, and repeated whitespace", () => {
    expect(
      normalizeSearchText("  Cuvée   Élite  "),
    ).toBe("cuvee elite")
  })

  it("matches multiple search terms in any field order", () => {
    expect(
      matchesSearch(
        [
          "Domaine Test",
          "Cuvée Hosted Sync",
          2020,
          "Main Cellar / A",
        ],
        "2020 hosted",
      ),
    ).toBe(true)
  })

  it("matches accent-free queries against accented data", () => {
    expect(
      matchesSearch(
        ["Domaine Test", "Cuvée Hosted Sync"],
        "cuvee",
      ),
    ).toBe(true)
  })

  it("treats an empty query as no filter", () => {
    expect(matchesSearch(["Anything"], "   ")).toBe(true)
  })

  it("rejects rows that do not contain every search term", () => {
    expect(
      matchesSearch(
        ["Domaine Test", "Cuvée Hosted Sync", 2020],
        "hosted 2024",
      ),
    ).toBe(false)
  })
})
