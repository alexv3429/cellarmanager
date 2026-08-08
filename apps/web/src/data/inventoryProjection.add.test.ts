import { describe, expect, it } from "vitest"

import {
  type InventoryLocation,
  type InventoryOperation,
  projectHoldings,
} from "./inventoryProjection"
import type { WineCatalogEntry } from "./wineCatalog"

const locations: InventoryLocation[] = [
  {
    id: "location-a",
    household_id: "household-1",
    code: "A",
  },
]

describe("ADD optimistic projection", () => {
  it("projects an ADD for an existing zero-stock catalog wine", () => {
    const wines: WineCatalogEntry[] = [
      {
        id: "wine-existing",
        household_id: "household-1",
        producer: "Existing Domaine",
        cuvee: "Zero Stock",
        vintage: 2020,
        color: "red",
        appellation: "Morgon",
        area: "Beaujolais",
        format_ml: 750,
      },
    ]

    const operations: InventoryOperation[] = [
      {
        id: "operation-existing",
        household_id: "household-1",
        operation_type: "ADD",
        wine_id: "wine-existing",
        source_location_id: null,
        destination_location_id: "location-a",
        quantity: 2,
        status: "PENDING",
      },
    ]

    expect(
      projectHoldings({
        holdings: [],
        locations,
        operations,
        wines,
      }),
    ).toEqual([
      expect.objectContaining({
        producer: "Existing Domaine",
        cuvee: "Zero Stock",
        vintage: 2020,
        location_code: "A",
        authoritative_quantity: 0,
        pending_delta: 2,
        quantity: 2,
      }),
    ])
  })

  it("projects a brand-new wine while offline", () => {
    const operations: InventoryOperation[] = [
      {
        id: "operation-new",
        household_id: "household-1",
        operation_type: "ADD",
        wine_id: "wine-new",
        wine_producer: "New Domaine",
        wine_cuvee: "Offline Cuvée",
        wine_vintage: 2022,
        wine_color: "white",
        wine_appellation: "Mâcon",
        wine_area: "Bourgogne",
        wine_format_ml: 1500,
        source_location_id: null,
        destination_location_id: "location-a",
        quantity: 3,
        status: "PENDING",
      },
    ]

    expect(
      projectHoldings({
        holdings: [],
        locations,
        operations,
      }),
    ).toEqual([
      expect.objectContaining({
        id: "optimistic:wine-new:location-a",
        producer: "New Domaine",
        cuvee: "Offline Cuvée",
        vintage: 2022,
        color: "white",
        appellation: "Mâcon",
        area: "Bourgogne",
        format_ml: 1500,
        location_code: "A",
        authoritative_quantity: 0,
        pending_delta: 3,
        quantity: 3,
      }),
    ])
  })
})
