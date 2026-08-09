import { describe, expect, it } from "vitest"

import { prepareWineIdentityEdit } from "./wineCatalogEdit"

describe("wine catalog editing", () => {
  it("normalizes editable identity fields", () => {
    expect(
      prepareWineIdentityEdit(
        "  Domaine   Test ",
        " Cuvée   A ",
        " 2021 ",
        " RED ",
      ),
    ).toEqual({
      producer: "Domaine Test",
      cuvee: "Cuvée A",
      vintage: 2021,
      color: "red",
    })
  })

  it("supports blank vintage as NV", () => {
    expect(
      prepareWineIdentityEdit(
        "Domaine Test",
        "Cuvée A",
        " ",
        "white",
      ).vintage,
    ).toBeNull()
  })

  it("rejects blank required identity fields", () => {
    expect(() =>
      prepareWineIdentityEdit(
        " ",
        "Cuvée",
        "2020",
        "red",
      ),
    ).toThrow("Wine producer is required")

    expect(() =>
      prepareWineIdentityEdit(
        "Domaine",
        " ",
        "2020",
        "red",
      ),
    ).toThrow("Wine cuvée is required")

    expect(() =>
      prepareWineIdentityEdit(
        "Domaine",
        "Cuvée",
        "2020",
        " ",
      ),
    ).toThrow("Wine color is required")
  })

  it("reuses catalog vintage validation", () => {
    expect(() =>
      prepareWineIdentityEdit(
        "Domaine",
        "Cuvée",
        "20",
        "red",
      ),
    ).toThrow(
      "Vintage must be a four-digit year or blank for NV",
    )
  })
})
