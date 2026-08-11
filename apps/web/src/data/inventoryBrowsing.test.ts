import { describe, expect, it } from "vitest"

import {
  matchesInventoryBrowseFilters,
  type InventoryBrowseHolding,
  type InventoryBrowseLocation,
} from "./inventoryBrowsing"

const holding: InventoryBrowseHolding = {
  appellation: "Saint-Émilion Grand Cru",
  area: "Bordeaux",
  color: "red",
  cuvee: "Cuvée Héritage",
  format_ml: 750,
  location_code: "A12",
  location_id: "location-1",
  producer: "Domaine Test",
  vintage: 2020,
}

const location: InventoryBrowseLocation = {
  cellar_id: "cellar-1",
  cellar_name: "Main Cellar",
  code: "A12",
  id: "location-1",
}

describe("inventory browsing", () => {
  it("matches a cellar without requiring one exact location", () => {
    expect(
      matchesInventoryBrowseFilters(holding, location, {
        cellarId: "cellar-1",
        locationId: null,
        search: "",
      }),
    ).toBe(true)

    expect(
      matchesInventoryBrowseFilters(holding, location, {
        cellarId: "cellar-2",
        locationId: null,
        search: "",
      }),
    ).toBe(false)
  })

  it("matches one exact location inside a cellar", () => {
    expect(
      matchesInventoryBrowseFilters(holding, location, {
        cellarId: "cellar-1",
        locationId: "location-1",
        search: "heritage a12",
      }),
    ).toBe(true)

    expect(
      matchesInventoryBrowseFilters(holding, location, {
        cellarId: "cellar-1",
        locationId: "location-2",
        search: "",
      }),
    ).toBe(false)
  })

  it("searches wine, format, and cellar fields accent-insensitively", () => {
    expect(
      matchesInventoryBrowseFilters(holding, location, {
        cellarId: null,
        locationId: null,
        search: "saint emilion 75 cl main",
      }),
    ).toBe(true)
  })

  it("does not match a cellar filter when location data is missing", () => {
    expect(
      matchesInventoryBrowseFilters(holding, undefined, {
        cellarId: "cellar-1",
        locationId: null,
        search: "",
      }),
    ).toBe(false)
  })
})
