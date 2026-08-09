import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import {
  DATABASE_OWNER_STORAGE_KEY,
  readDatabaseOwner,
} from "../../auth/localAccess"
import {
  DEVICE_IDS_STORAGE_KEY,
} from "../../devices/deviceIdentity"

const databaseMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  disconnectAndClear: vi.fn(),
}))

vi.mock("./database", () => ({
  powerSyncDatabase: databaseMocks,
}))

vi.mock("./PowerSyncConnector", () => ({
  PowerSyncConnector: class PowerSyncConnector {},
}))

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

async function loadConnection() {
  vi.resetModules()

  return import("./connection")
}

describe("PowerSync account isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    databaseMocks.connect.mockResolvedValue(undefined)
    databaseMocks.disconnect.mockResolvedValue(undefined)
    databaseMocks.disconnectAndClear.mockResolvedValue(
      undefined,
    )

    vi.stubGlobal("window", {
      localStorage: new MemoryStorage(),
    })
  })

  it("records ownership when preparing the first user", async () => {
    const { setPowerSyncAccess } =
      await loadConnection()

    await setPowerSyncAccess({
      userId: "user-1",
      connectToBackend: true,
    })

    expect(
      readDatabaseOwner(window.localStorage),
    ).toBe("user-1")

    expect(
      databaseMocks.disconnectAndClear,
    ).not.toHaveBeenCalled()

    expect(databaseMocks.connect).toHaveBeenCalledTimes(1)
  })

  it("clears the previous local database before switching users", async () => {
    const { setPowerSyncAccess } =
      await loadConnection()

    await setPowerSyncAccess({
      userId: "user-1",
      connectToBackend: false,
    })

    await setPowerSyncAccess({
      userId: "user-2",
      connectToBackend: true,
    })

    expect(
      databaseMocks.disconnectAndClear,
    ).toHaveBeenCalledTimes(1)

    expect(
      readDatabaseOwner(window.localStorage),
    ).toBe("user-2")

    expect(databaseMocks.connect).toHaveBeenCalledTimes(1)
  })

  it("clears ownership and browser identities after successful sign out", async () => {
    const {
      clearPowerSyncForSignOut,
      setPowerSyncAccess,
    } = await loadConnection()

    await setPowerSyncAccess({
      userId: "user-1",
      connectToBackend: false,
    })

    window.localStorage.setItem(
      DEVICE_IDS_STORAGE_KEY,
      JSON.stringify({
        "household-1": "device-1",
      }),
    )

    await clearPowerSyncForSignOut()

    expect(
      window.localStorage.getItem(
        DATABASE_OWNER_STORAGE_KEY,
      ),
    ).toBeNull()

    expect(
      window.localStorage.getItem(
        DEVICE_IDS_STORAGE_KEY,
      ),
    ).toBeNull()
  })

  it("preserves old ownership when clearing fails so the next user retries", async () => {
    const {
      clearPowerSyncForSignOut,
      setPowerSyncAccess,
    } = await loadConnection()

    await setPowerSyncAccess({
      userId: "user-1",
      connectToBackend: false,
    })

    window.localStorage.setItem(
      DEVICE_IDS_STORAGE_KEY,
      JSON.stringify({
        "household-1": "device-1",
      }),
    )

    databaseMocks.disconnectAndClear
      .mockRejectedValueOnce(
        new Error("clear failed"),
      )
      .mockResolvedValueOnce(undefined)

    await expect(
      clearPowerSyncForSignOut(),
    ).rejects.toThrow("clear failed")

    expect(
      readDatabaseOwner(window.localStorage),
    ).toBe("user-1")

    expect(
      window.localStorage.getItem(
        DEVICE_IDS_STORAGE_KEY,
      ),
    ).not.toBeNull()

    await setPowerSyncAccess({
      userId: "user-2",
      connectToBackend: false,
    })

    expect(
      databaseMocks.disconnectAndClear,
    ).toHaveBeenCalledTimes(2)

    expect(
      readDatabaseOwner(window.localStorage),
    ).toBe("user-2")
  })
})
