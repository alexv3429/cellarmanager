import { describe, expect, it } from "vitest"

import {
  type AuthoritativeHolding,
  type InventoryLocation,
  type InventoryOperation,
  projectHoldings,
} from "./inventoryProjection"

const locations: InventoryLocation[] = [
  {
    id: "location-a",
    household_id: "household-1",
    code: "A",
  },
  {
    id: "location-b",
    household_id: "household-1",
    code: "B",
  },
]

function holding(
  locationId: string,
  locationCode: string,
  quantity: number,
): AuthoritativeHolding {
  return {
    id: `holding-${locationId}`,
    household_id: "household-1",
    wine_id: "wine-1",
    location_id: locationId,
    producer: "Domaine Test",
    cuvee: "Cuvée Test",
    vintage: 2020,
    location_code: locationCode,
    quantity,
    revision: 1,
  }
}

function operation(
  overrides: Partial<InventoryOperation>,
): InventoryOperation {
  return {
    id: "operation-1",
    operation_type: "MOVE",
    wine_id: "wine-1",
    source_location_id: "location-a",
    destination_location_id: "location-b",
    quantity: 1,
    status: "PENDING",
    ...overrides,
  }
}

describe("optimistic inventory projection", () => {
  it("projects a pending move at both locations", () => {
    const result = projectHoldings({
      holdings: [
        holding("location-a", "A", 3),
        holding("location-b", "B", 1),
      ],
      locations,
      operations: [operation({})],
    })

    expect(result).toMatchObject([
      {
        location_code: "A",
        authoritative_quantity: 3,
        pending_delta: -1,
        quantity: 2,
      },
      {
        location_code: "B",
        authoritative_quantity: 1,
        pending_delta: 1,
        quantity: 2,
      },
    ])
  })

  it("projects a pending add at a destination", () => {
    const result = projectHoldings({
      holdings: [holding("location-a", "A", 3)],
      locations,
      operations: [
        operation({
          operation_type: "ADD",
          source_location_id: null,
          destination_location_id: "location-b",
          quantity: 2,
        }),
      ],
    })

    expect(result).toContainEqual(
      expect.objectContaining({
        id: "optimistic:wine-1:location-b",
        location_code: "B",
        authoritative_quantity: 0,
        pending_delta: 2,
        quantity: 2,
        revision: 0,
      }),
    )
  })

  it("creates an optimistic destination position", () => {
    const result = projectHoldings({
      holdings: [holding("location-a", "A", 3)],
      locations,
      operations: [operation({})],
    })

    expect(result).toContainEqual(
      expect.objectContaining({
        id: "optimistic:wine-1:location-b",
        location_code: "B",
        authoritative_quantity: 0,
        pending_delta: 1,
        quantity: 1,
        revision: 0,
      }),
    )
  })

  it("projects a pending removal", () => {
    const result = projectHoldings({
      holdings: [holding("location-a", "A", 3)],
      locations,
      operations: [
        operation({
          operation_type: "REMOVE",
          destination_location_id: null,
        }),
      ],
    })

    expect(result[0]).toMatchObject({
      authoritative_quantity: 3,
      pending_delta: -1,
      quantity: 2,
    })
  })

  it("never displays a negative projected quantity", () => {
    const result = projectHoldings({
      holdings: [holding("location-a", "A", 1)],
      locations,
      operations: [
        operation({
          operation_type: "REMOVE",
          destination_location_id: null,
          quantity: 2,
        }),
      ],
    })

    expect(result[0]).toMatchObject({
      pending_delta: -2,
      pending_operation_count: 1,
      quantity: 0,
    })
  })

  it("does not apply accepted or rejected operations", () => {
    const result = projectHoldings({
      holdings: [
        holding("location-a", "A", 3),
        holding("location-b", "B", 1),
      ],
      locations,
      operations: [
        operation({ status: "ACCEPTED" }),
        operation({
          id: "operation-2",
          operation_type: "REMOVE",
          destination_location_id: null,
          quantity: 99,
          status: "REJECTED",
        }),
      ],
    })

    expect(result).toMatchObject([
      {
        location_code: "A",
        pending_delta: 0,
        quantity: 3,
      },
      {
        location_code: "B",
        pending_delta: 0,
        quantity: 1,
      },
    ])
  })
})
