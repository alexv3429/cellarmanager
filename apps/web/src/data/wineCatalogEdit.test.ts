import { describe, expect, it } from "vitest"

import { prepareWineCatalogEdit } from "./wineCatalogEdit"

describe("wine catalog editing", () => {
  it("normalizes identity and metadata fields", () => {
    expect(
      prepareWineCatalogEdit(
        "  Domaine   Test ",
        " Cuvée   A ",
        " 2021 ",
        " RED ",
        "  Côte   de   Nuits ",
        " Burgundy   North ",
      ),
    ).toEqual({
      producer: "Domaine Test",
      cuvee: "Cuvée A",
      vintage: 2021,
      color: "red",
      appellation: "Côte de Nuits",
      area: "Burgundy North",
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
      ),
    ).toEqual({
      producer: "Domaine Test",
      cuvee: "Cuvée A",
      vintage: null,
      color: "white",
      appellation: null,
      area: null,
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
      ),
    ).toThrow(
      "Vintage must be a four-digit year or blank for NV",
    )
  })
})
