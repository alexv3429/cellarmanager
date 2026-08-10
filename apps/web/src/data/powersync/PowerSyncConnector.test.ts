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
})
