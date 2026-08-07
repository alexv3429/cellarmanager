import { describe, expect, it, vi } from "vitest"

import {
  createInventoryOperationQueue,
} from "./inventoryOperations"

function createQueue() {
  const execute = vi.fn(
    async (
      _sql: string,
      _parameters: Array<string | number | null>,
    ) => undefined,
  )

  const queue = createInventoryOperationQueue({
    execute,
    createOperationId: () => "operation-1",
    now: () => new Date("2026-08-05T20:00:00Z"),
  })

  return { execute, queue }
}

const commonInput = {
  householdId: "household-1",
  deviceId: "device-current-browser",
  userId: "user-1",
  wineId: "wine-1",
  quantity: 1,
}

describe("inventory operation queue", () => {
  it("queues an add without a source", async () => {
    const { execute, queue } = createQueue()

    await expect(
      queue.queueAdd({
        ...commonInput,
        destinationLocationId: "location-a",
      }),
    ).resolves.toBe("operation-1")

    expect(execute.mock.calls[0]?.[1]).toEqual([
      "operation-1",
      "household-1",
      "device-current-browser",
      "user-1",
      "ADD",
      "wine-1",
      null,
      "location-a",
      1,
      null,
      "2026-08-05T20:00:00.000Z",
    ])
  })

  it("queues a move with source and destination", async () => {
    const { execute, queue } = createQueue()

    await expect(
      queue.queueMove({
        ...commonInput,
        sourceLocationId: "location-a",
        destinationLocationId: "location-b",
      }),
    ).resolves.toBe("operation-1")

    expect(execute.mock.calls[0]?.[1]).toEqual([
      "operation-1",
      "household-1",
      "device-current-browser",
      "user-1",
      "MOVE",
      "wine-1",
      "location-a",
      "location-b",
      1,
      null,
      "2026-08-05T20:00:00.000Z",
    ])
  })

  it("queues a remove with an explicit reason", async () => {
    const { execute, queue } = createQueue()

    await expect(
      queue.queueRemove({
        ...commonInput,
        sourceLocationId: "location-a",
        removeReason: "GIFTED",
      }),
    ).resolves.toBe("operation-1")

    expect(execute.mock.calls[0]?.[1]).toEqual([
      "operation-1",
      "household-1",
      "device-current-browser",
      "user-1",
      "REMOVE",
      "wine-1",
      "location-a",
      null,
      1,
      "GIFTED",
      "2026-08-05T20:00:00.000Z",
    ])
  })

  it("rejects invalid quantities before writing", async () => {
    const { execute, queue } = createQueue()

    await expect(
      queue.queueRemove({
        ...commonInput,
        sourceLocationId: "location-a",
        removeReason: "DRANK",
        quantity: 0,
      }),
    ).rejects.toThrow(
      "Operation quantity must be a positive integer",
    )

    expect(execute).not.toHaveBeenCalled()
  })

  it("rejects moves to the same location", async () => {
    const { execute, queue } = createQueue()

    await expect(
      queue.queueMove({
        ...commonInput,
        sourceLocationId: "location-a",
        destinationLocationId: "location-a",
      }),
    ).rejects.toThrow(
      "Source and destination locations must differ",
    )

    expect(execute).not.toHaveBeenCalled()
  })
})
