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
    color: "red",
    appellation: "Morgon",
    area: "Beaujolais",
    format_ml: 750,
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

  it.each(["MOVE", "REMOVE"] as const)("converges two offline views after %s wins a last-bottle conflict", (winner) => {
    const before = [holding("location-a", "A", 1)]
    const move = operation({ id: "phone-move" })
    const remove = operation({ id: "desktop-remove", operation_type: "REMOVE", destination_location_id: null })
    const phone = projectHoldings({ holdings: before, locations, operations: [move] })
    const desktop = projectHoldings({ holdings: before, locations, operations: [remove] })
    expect(phone.find((position) => position.location_id === "location-b")?.quantity).toBe(1)
    expect(desktop.reduce((total, position) => total + position.quantity, 0)).toBe(0)

    // A synchronized snapshot contains authoritative holdings and the terminal
    // journal, not a reconstruction from each device's optimistic quantities.
    const committed = winner === "MOVE"
      ? [holding("location-a", "A", 0), holding("location-b", "B", 1)]
      : [holding("location-a", "A", 0)]
    const terminal = [move, remove].map((op) => ({
      ...op, status: op.operation_type === winner ? "ACCEPTED" : "REJECTED",
    }))
    const phoneAfter = projectHoldings({ holdings: committed, locations, operations: terminal })
    const desktopAfter = projectHoldings({ holdings: committed, locations, operations: [...terminal].reverse() })
    expect(phoneAfter).toEqual(desktopAfter)
    expect(phoneAfter.reduce((total, position) => total + position.quantity, 0)).toBe(winner === "MOVE" ? 1 : 0)
    expect(phoneAfter.every((position) => position.pending_delta === 0 && position.pending_operation_count === 0)).toBe(true)
    expect(projectHoldings({ holdings: committed, locations, operations: terminal })).toEqual(phoneAfter)
  })

  it("removes a new-wine optimistic placeholder when the server reuses an existing identity", () => {
    const add = operation({
      id: "offline-add", household_id: "household-1", operation_type: "ADD", wine_id: "temporary-wine",
      wine_producer: "Domaine Test", wine_cuvee: "Cuvée Test", wine_vintage: 2020,
      wine_color: "red", wine_format_ml: 750, source_location_id: null,
      destination_location_id: "location-a", quantity: 2,
    })
    const offline = projectHoldings({ holdings: [], locations, operations: [add] })
    expect(offline).toMatchObject([{ wine_id: "temporary-wine", quantity: 2, pending_operation_count: 1 }])

    const synchronized = projectHoldings({
      holdings: [holding("location-a", "A", 5)], locations,
      operations: [{ ...add, wine_id: "wine-1", status: "ACCEPTED" }],
    })
    expect(synchronized).toMatchObject([{ wine_id: "wine-1", quantity: 5, pending_operation_count: 0 }])
    expect(synchronized).toHaveLength(1)
  })
})
