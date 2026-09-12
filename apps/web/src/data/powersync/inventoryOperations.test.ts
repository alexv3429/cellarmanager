import { describe, expect, it, vi } from "vitest"

import {
  createInventoryOperationQueue,
} from "./inventoryOperations"

function createQueue(role: string | null = "owner", deviceActive = true) {
  const execute = vi.fn(
    async (
      _sql: string,
      _parameters: Array<string | number | null>,
    ) => undefined,
  )

  const queue = createInventoryOperationQueue({
    getRole: async () => role,
    isDeviceActive: async () => deviceActive,
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
  it("refuses all new local stock changes under a missing or revoked registration", async () => {
    const { execute, queue } = createQueue("owner", false)
    await expect(queue.queueAdd({ ...commonInput, destinationLocationId: "b" })).rejects.toThrow("registration is not active")
    await expect(queue.queueMove({ ...commonInput, sourceLocationId: "a", destinationLocationId: "b" })).rejects.toThrow("registration is not active")
    await expect(queue.queueRemove({ ...commonInput, sourceLocationId: "a", removeReason: "DRANK" })).rejects.toThrow("registration is not active")
    expect(execute).not.toHaveBeenCalled()
  })
  it.each(["member", null, "unknown"])("refuses every stock operation for role %s without a local write", async (role) => {
    const { execute, queue } = createQueue(role)
    await expect(queue.queueAdd({ ...commonInput, destinationLocationId: "location-a" })).rejects.toThrow("Only a household Owner")
    await expect(queue.queueMove({ ...commonInput, sourceLocationId: "location-a", destinationLocationId: "location-b" })).rejects.toThrow("Only a household Owner")
    await expect(queue.queueRemove({ ...commonInput, sourceLocationId: "location-a", removeReason: "DRANK" })).rejects.toThrow("Only a household Owner")
    await expect(queue.queueAdd({ ...commonInput, destinationLocationId: "location-a", wineProducer: "New", wineCuvee: "Wine", wineVintage: 2024, wineColor: "red", wineFormatMl: 750 })).rejects.toThrow("Only a household Owner")
    expect(execute).not.toHaveBeenCalled()
  })

  it("rechecks the role for each operation after a demotion", async () => {
    const getRole = vi.fn().mockResolvedValueOnce("owner").mockResolvedValue("member")
    const execute = vi.fn()
    const queue = createInventoryOperationQueue({ getRole, execute, isDeviceActive: async () => true, createOperationId: () => "op", now: () => new Date() })
    await queue.queueAdd({ ...commonInput, destinationLocationId: "location-a" })
    await expect(queue.queueRemove({ ...commonInput, sourceLocationId: "location-a", removeReason: "DRANK" })).rejects.toThrow("Only a household Owner")
    expect(getRole).toHaveBeenLastCalledWith(commonInput.householdId, commonInput.userId)
    expect(execute).toHaveBeenCalledTimes(1)
  })
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
