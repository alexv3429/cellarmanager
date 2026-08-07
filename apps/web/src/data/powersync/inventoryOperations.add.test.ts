import { describe, expect, it, vi } from "vitest"

import {
  createInventoryOperationQueue,
} from "./inventoryOperations"

describe("new-wine ADD queue", () => {
  it("stores offline wine identity with the pending operation", async () => {
    const execute = vi.fn(
      async (
        _sql: string,
        _parameters: Array<string | number | null>,
      ) => undefined,
    )

    const queue = createInventoryOperationQueue({
      execute,
      createOperationId: () => "operation-new-wine",
      now: () => new Date("2026-08-07T14:30:00Z"),
    })

    await queue.queueAdd({
      householdId: "household-1",
      deviceId: "device-1",
      userId: "user-1",
      wineId: "wine-new",
      destinationLocationId: "location-a",
      quantity: 2,
      wineProducer: "  New   Domaine ",
      wineCuvee: " Offline  Cuvée ",
      wineVintage: 2022,
    })

    expect(execute.mock.calls[0]?.[1]).toEqual([
      "operation-new-wine",
      "household-1",
      "device-1",
      "user-1",
      "ADD",
      "wine-new",
      null,
      "location-a",
      2,
      null,
      "New Domaine",
      "Offline Cuvée",
      2022,
      "2026-08-07T14:30:00.000Z",
    ])
  })

  it("requires all new-wine identity fields together", async () => {
    const execute = vi.fn(
      async (
        _sql: string,
        _parameters: Array<string | number | null>,
      ) => undefined,
    )

    const queue = createInventoryOperationQueue({
      execute,
      createOperationId: () => "operation-new-wine",
      now: () => new Date("2026-08-07T14:30:00Z"),
    })

    await expect(
      queue.queueAdd({
        householdId: "household-1",
        deviceId: "device-1",
        userId: "user-1",
        wineId: "wine-new",
        destinationLocationId: "location-a",
        quantity: 1,
        wineProducer: "New Domaine",
        wineCuvee: "Offline Cuvée",
      }),
    ).rejects.toThrow(
      "New-wine ADD details must include producer, cuvée, and vintage/NV together",
    )

    expect(execute).not.toHaveBeenCalled()
  })
})
