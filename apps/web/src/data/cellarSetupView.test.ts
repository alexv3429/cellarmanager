import { describe, expect, it } from "vitest"

import {
  buildCellarSetupSummaries,
  filterCellarSetupSummaries,
  formatBottleCount,
  formatLocationCount,
  getLocationOccupancy,
  isSetupRecordActive,
  moveLocationId,
  type CellarSetupCellar,
  type CellarSetupHolding,
  type CellarSetupLocation,
} from "./cellarSetupView"

const cellars: CellarSetupCellar[] = [
  {
    household_id: "household-a",
    id: "cellar-b",
    is_active: 0,
    name: "Second room",
  },
  {
    household_id: "household-a",
    id: "cellar-a",
    is_active: 1,
    name: "Main cellar",
  },
]

const locations: CellarSetupLocation[] = [
  {
    capacity: 10,
    cellar_id: "cellar-a",
    code: "A10",
    display_order: null,
    household_id: "household-a",
    id: "location-a10",
    is_active: 1,
    storage_purpose: "aging",
  },
  {
    capacity: null,
    cellar_id: "cellar-a",
    code: "Étage 2",
    display_order: null,
    household_id: "household-a",
    id: "location-floor-2",
    is_active: 0,
    storage_purpose: "mixed",
  },
  {
    capacity: 8,
    cellar_id: "cellar-a",
    code: "A2",
    display_order: null,
    household_id: "household-a",
    id: "location-a2",
    is_active: 1,
    storage_purpose: "service",
  },
]

const holdings: CellarSetupHolding[] = [
  { location_id: "location-a2", quantity: 2 },
  { location_id: "location-a2", quantity: 3 },
  { location_id: "location-a10", quantity: 1 },
]

describe("cellar setup summaries", () => {
  it("treats missing synchronized flags as active", () => {
    expect(isSetupRecordActive(undefined)).toBe(true)
    expect(isSetupRecordActive(null)).toBe(true)
    expect(isSetupRecordActive(1)).toBe(true)
    expect(isSetupRecordActive(0)).toBe(false)
  })

  it("groups active and archived locations with natural sorting", () => {
    const summaries = buildCellarSetupSummaries({
      cellars,
      holdings,
      locations,
    })

    expect(summaries.map((cellar) => cellar.name)).toEqual([
      "Main cellar",
      "Second room",
    ])
    expect(
      summaries[0]?.locations.map((location) => location.code),
    ).toEqual(["A2", "A10"])
    expect(
      summaries[0]?.archivedLocations.map(
        (location) => location.code,
      ),
    ).toEqual(["Étage 2"])
    expect(summaries[0]?.bottleCount).toBe(6)
    expect(summaries[0]?.configuredCapacity).toBe(18)
  })

  it("uses explicit order after every active location is ordered", () => {
    const orderedLocations = locations.map((location) => ({
      ...location,
      display_order:
        location.id === "location-a10" ? 10 : 20,
    }))

    const summaries = buildCellarSetupSummaries({
      cellars,
      holdings,
      locations: orderedLocations,
    })

    expect(
      summaries[0]?.locations.map((location) => location.code),
    ).toEqual(["A10", "A2"])
  })

  it("finds active cellars and locations accent-insensitively", () => {
    const summaries = buildCellarSetupSummaries({
      cellars,
      holdings,
      locations,
    })

    expect(
      filterCellarSetupSummaries(summaries, "main"),
    ).toHaveLength(1)

    expect(
      filterCellarSetupSummaries(summaries, "a10")[0]
        ?.locations,
    ).toHaveLength(1)
  })

  it("moves a location without changing boundary orders", () => {
    expect(
      moveLocationId(["a", "b", "c"], "b", -1),
    ).toEqual(["b", "a", "c"])
    expect(
      moveLocationId(["a", "b", "c"], "a", -1),
    ).toEqual(["a", "b", "c"])
  })

  it("derives rough occupancy from bottles and capacity", () => {
    expect(getLocationOccupancy(0, null).label).toBe("Empty")
    expect(getLocationOccupancy(4, null).label).toBe(
      "Capacity not set",
    )
    expect(getLocationOccupancy(7, 10).label).toBe(
      "Available",
    )
    expect(getLocationOccupancy(8, 10).label).toBe(
      "Almost full",
    )
    expect(getLocationOccupancy(10, 10).label).toBe("Full")
    expect(getLocationOccupancy(11, 10).label).toBe(
      "Over capacity",
    )
  })

  it("formats singular and plural summary labels", () => {
    expect(formatBottleCount(1)).toBe("1 bottle")
    expect(formatBottleCount(2)).toBe("2 bottles")
    expect(formatLocationCount(1)).toBe("1 location")
    expect(formatLocationCount(2)).toBe("2 locations")
  })
})
