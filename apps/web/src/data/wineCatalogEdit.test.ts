import { describe, expect, it } from "vitest"

import { prepareWineCatalogEdit } from "./wineCatalogEdit"

describe("wine catalog editing", () => {
  it("normalizes all editable catalog fields", () => {
    expect(
      prepareWineCatalogEdit(
        "  Domaine   Test ",
        " Cuvée   A ",
        " 2021 ",
        " RED ",
        "  Côte   de   Nuits ",
        " Burgundy   North ",
        " 1500 ",
      ),
    ).toEqual({
      producer: "Domaine Test",
      cuvee: "Cuvée A",
      vintage: 2021,
      color: "red",
      appellation: "Côte de Nuits",
      area: "Burgundy North",
      formatMl: 1500,
    })
  })

  it("supports NV and blank optional metadata", () => {
    expect(
      prepareWineCatalogEdit(
        "Domaine Test",
        "Cuvée A",
        " ",
        "white",
        " ",
        "",
        "750",
      ),
    ).toEqual({
      producer: "Domaine Test",
      cuvee: "Cuvée A",
      vintage: null,
      color: "white",
      appellation: null,
      area: null,
      formatMl: 750,
    })
  })

  it("rejects blank required identity fields", () => {
    expect(() =>
      prepareWineCatalogEdit(
        " ",
        "Cuvée",
        "2020",
        "red",
        "",
        "",
        "750",
      ),
    ).toThrow("Wine producer is required")

    expect(() =>
      prepareWineCatalogEdit(
        "Domaine",
        " ",
        "2020",
        "red",
        "",
        "",
        "750",
      ),
    ).toThrow("Wine cuvée is required")

    expect(() =>
      prepareWineCatalogEdit(
        "Domaine",
        "Cuvée",
        "2020",
        " ",
        "",
        "",
        "750",
      ),
    ).toThrow("Wine color is required")
  })

  it("reuses catalog vintage validation", () => {
    expect(() =>
      prepareWineCatalogEdit(
        "Domaine",
        "Cuvée",
        "20",
        "red",
        "",
        "",
        "750",
      ),
    ).toThrow(
      "Vintage must be a four-digit year or blank for NV",
    )
  })

  it("requires a positive whole-number bottle format", () => {
    expect(() =>
      prepareWineCatalogEdit(
        "Domaine",
        "Cuvée",
        "2020",
        "red",
        "",
        "",
        "0",
      ),
    ).toThrow(
      "Bottle format must be a positive whole number of millilitres",
    )

    expect(() =>
      prepareWineCatalogEdit(
        "Domaine",
        "Cuvée",
        "2020",
        "red",
        "",
        "",
        "750.5",
      ),
    ).toThrow(
      "Bottle format must be a positive whole number of millilitres",
    )
  })
})
