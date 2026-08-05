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

const baseInput = {
  householdId: "household-1",
  deviceId: "device-current-browser",
  userId: "user-1",
  wineId: "wine-1",
  sourceLocationId: "location-a",
  quantity: 1,
}

describe("inventory operation queue", () => {
  it("queues a move with the current device ID", async () => {
    const { execute, queue } = createQueue()

    await expect(
      queue.queueMove({
        ...baseInput,
        destinationLocationId: "location-b",
      }),
    ).resolves.toBe("operation-1")

    expect(execute).toHaveBeenCalledOnce()

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
      "2026-08-05T20:00:00.000Z",
    ])
  })

  it("queues consumption without a destination", async () => {
    const { execute, queue } = createQueue()

    await queue.queueConsume(baseInput)

    expect(execute.mock.calls[0]?.[1]).toEqual([
      "operation-1",
      "household-1",
      "device-current-browser",
      "user-1",
      "CONSUME",
      "wine-1",
      "location-a",
      null,
      1,
      "2026-08-05T20:00:00.000Z",
    ])
  })

  it("rejects invalid quantities before writing", async () => {
    const { execute, queue } = createQueue()

    await expect(
      queue.queueConsume({
        ...baseInput,
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
        ...baseInput,
        destinationLocationId: "location-a",
      }),
    ).rejects.toThrow(
      "Source and destination locations must differ",
    )

    expect(execute).not.toHaveBeenCalled()
  })
})
