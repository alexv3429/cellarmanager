import {
  UpdateType,
  type AbstractPowerSyncDatabase,
} from "@powersync/web"
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { PowerSyncConnector } from "./PowerSyncConnector"

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock("../env", () => ({
  environment: {
    powerSyncUrl: "https://powersync.test",
  },
}))

vi.mock("../supabase", () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
  },
}))

function putOperation(
  id: string,
  data: Record<string, unknown>,
) {
  return {
    id,
    table: "inventory_operations",
    op: UpdateType.PUT,
    opData: data,
  }
}

function createDatabase(
  crud: ReturnType<typeof putOperation>[],
) {
  const complete = vi.fn(async () => undefined)

  const transaction = {
    crud,
    complete,
  }

  const database = {
    getNextCrudTransaction: vi.fn(
      async () => transaction,
    ),
  } as unknown as AbstractPowerSyncDatabase

  return {
    database,
    complete,
  }
}

const commonData = {
  household_id: "household-1",
  device_id: "device-1",
  wine_id: "wine-1",
  quantity: 1,
  created_at_client: "2026-08-10T12:00:00.000Z",
}

describe("PowerSync inventory upload", () => {
  it("preserves an upload rejected for device revocation and its original device ID", async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Device registration is no longer active" } })
    const { database, complete } = createDatabase([putOperation("revoked-op", {
      ...commonData, operation_type: "MOVE", source_location_id: "location-a", destination_location_id: "location-b", remove_reason: null,
    })])
    await expect(new PowerSyncConnector().uploadData(database)).rejects.toThrow("This device registration was revoked")
    expect(complete).not.toHaveBeenCalled()
    expect(supabaseMocks.rpc).toHaveBeenCalledWith("apply_inventory_operation", expect.objectContaining({ p_device_id: commonData.device_id }))
  })
  beforeEach(() => {
    supabaseMocks.rpc.mockReset()
  })

  it("uploads ADD MOVE and REMOVE before completing the transaction", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: null,
    })

    const { database, complete } = createDatabase([
      putOperation("operation-add", {
        ...commonData,
        operation_type: "ADD",
        wine_id: "wine-new",
        source_location_id: null,
        destination_location_id: "location-a",
        quantity: 2,
        wine_producer: "Offline Domaine",
        wine_cuvee: "Reconnect",
        wine_vintage: 2026,
        wine_color: "red",
        wine_appellation: "Morgon",
        wine_area: "Beaujolais",
        wine_format_ml: 750,
        remove_reason: null,
      }),
      putOperation("operation-move", {
        ...commonData,
        operation_type: "MOVE",
        source_location_id: "location-a",
        destination_location_id: "location-b",
        remove_reason: null,
      }),
      putOperation("operation-remove", {
        ...commonData,
        operation_type: "REMOVE",
        source_location_id: "location-b",
        destination_location_id: null,
        remove_reason: "DRANK",
      }),
    ])

    const connector = new PowerSyncConnector()

    await connector.uploadData(database)

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(
      1,
      "apply_add_inventory_operation",
      {
        p_operation_id: "operation-add",
        p_household_id: "household-1",
        p_device_id: "device-1",
        p_requested_wine_id: "wine-new",
        p_wine_producer: "Offline Domaine",
        p_wine_cuvee: "Reconnect",
        p_wine_vintage: 2026,
        p_wine_color: "red",
        p_wine_appellation: "Morgon",
        p_wine_area: "Beaujolais",
        p_wine_format_ml: 750,
        p_destination_location_id: "location-a",
        p_quantity: 2,
        p_created_at_client:
          "2026-08-10T12:00:00.000Z",
      },
    )

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(
      2,
      "apply_inventory_operation",
      {
        p_operation_id: "operation-move",
        p_household_id: "household-1",
        p_device_id: "device-1",
        p_operation_type: "MOVE",
        p_wine_id: "wine-1",
        p_source_location_id: "location-a",
        p_destination_location_id: "location-b",
        p_quantity: 1,
        p_created_at_client:
          "2026-08-10T12:00:00.000Z",
        p_remove_reason: null,
      },
    )

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(
      3,
      "apply_inventory_operation",
      {
        p_operation_id: "operation-remove",
        p_household_id: "household-1",
        p_device_id: "device-1",
        p_operation_type: "REMOVE",
        p_wine_id: "wine-1",
        p_source_location_id: "location-b",
        p_destination_location_id: null,
        p_quantity: 1,
        p_created_at_client:
          "2026-08-10T12:00:00.000Z",
        p_remove_reason: "DRANK",
      },
    )

    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("leaves a failed transaction incomplete so PowerSync can retry it", async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: "temporarily unavailable",
        },
      })
      .mockResolvedValueOnce({
        data: null,
        error: null,
      })

    const { database, complete } = createDatabase([
      putOperation("operation-retry", {
        ...commonData,
        operation_type: "MOVE",
        source_location_id: "location-a",
        destination_location_id: "location-b",
        remove_reason: null,
      }),
    ])

    const connector = new PowerSyncConnector()

    await expect(
      connector.uploadData(database),
    ).rejects.toThrow(
      "Inventory operation upload failed: temporarily unavailable",
    )

    expect(complete).not.toHaveBeenCalled()

    await expect(
      connector.uploadData(database),
    ).resolves.toBeUndefined()

    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it.each(["ADD", "MOVE", "REMOVE"])("preserves a %s denied after an Owner demotion without silently acknowledging it", async (operationType) => {
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Household owner permission is required" } })
    const { database, complete } = createDatabase([putOperation("old-queued-op", {
      ...commonData, operation_type: operationType,
      source_location_id: operationType === "ADD" ? null : "location-a",
      destination_location_id: operationType === "REMOVE" ? null : "location-b",
      remove_reason: operationType === "REMOVE" ? "DRANK" : null,
      ...(operationType === "ADD" ? { wine_producer: "Queued wine", wine_cuvee: "Before demotion", wine_vintage: 2024, wine_color: "red", wine_format_ml: 750 } : {}),
    })])
    await expect(new PowerSyncConnector().uploadData(database)).rejects.toThrow("Your queued changes have been kept locally and were not applied")
    expect(complete).not.toHaveBeenCalled()
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1)
  })

  it("continues past a terminal stock rejection and acknowledges the whole uploaded batch", async () => {
    const receipt = (id: string, status: string, code: string | null) => ({
      data: [{ operation_id: id, operation_status: status, operation_error_code: code }],
      error: null,
    })
    supabaseMocks.rpc
      .mockResolvedValueOnce(receipt("last-bottle", "REJECTED", "INSUFFICIENT_STOCK"))
      .mockResolvedValueOnce(receipt("unrelated-move", "ACCEPTED", null))
    const { database, complete } = createDatabase([
      putOperation("last-bottle", {
        ...commonData, operation_type: "REMOVE", source_location_id: "location-a",
        destination_location_id: null, remove_reason: "DRANK",
      }),
      putOperation("unrelated-move", {
        ...commonData, wine_id: "wine-2", operation_type: "MOVE",
        source_location_id: "location-b", destination_location_id: "location-c", remove_reason: null,
      }),
    ])

    await new PowerSyncConnector().uploadData(database)

    expect(supabaseMocks.rpc.mock.calls.map(([, args]) => args.p_operation_id))
      .toEqual(["last-bottle", "unrelated-move"])
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("replays an interrupted partial batch with identical UUIDs and payloads before uploading the remaining operation", async () => {
    const accepted = { data: [{ operation_status: "ACCEPTED" }], error: null }
    // The second request may have committed, but its response was lost. The
    // real database acceptance suite separately proves replay is idempotent.
    supabaseMocks.rpc
      .mockResolvedValueOnce(accepted)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(accepted)
    const crud = ["first", "lost-response", "remaining"].map((id) => putOperation(id, {
      ...commonData, operation_type: "MOVE", source_location_id: "location-a",
      destination_location_id: "location-b", remove_reason: null,
    }))
    const original = structuredClone(crud)
    const { database, complete } = createDatabase(crud)
    const connector = new PowerSyncConnector()

    await expect(connector.uploadData(database)).rejects.toThrow("Failed to fetch")
    expect(complete).not.toHaveBeenCalled()
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(2)

    await connector.uploadData(database)

    const calls = supabaseMocks.rpc.mock.calls
    expect(calls.map(([, args]) => args.p_operation_id))
      .toEqual(["first", "lost-response", "first", "lost-response", "remaining"])
    expect(calls[2]).toEqual(calls[0])
    expect(calls[3]).toEqual(calls[1])
    expect(crud).toEqual(original)
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
