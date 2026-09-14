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
  waitForReady: vi.fn(),
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
    databaseMocks.waitForReady.mockResolvedValue(undefined)

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

  it("exposes the validated local database before the remote connection finishes", async () => {
    let finishConnection: (() => void) | undefined

    databaseMocks.connect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishConnection = resolve
        }),
    )

    const { setPowerSyncAccess } =
      await loadConnection()
    const onLocalReady = vi.fn()
    const access = setPowerSyncAccess({
      userId: "user-1",
      connectToBackend: true,
      onLocalReady,
    })

    await vi.waitFor(() => {
      expect(onLocalReady).toHaveBeenCalledTimes(1)
      expect(databaseMocks.connect).toHaveBeenCalledTimes(1)
    })

    expect(
      databaseMocks.waitForReady.mock.invocationCallOrder[0],
    ).toBeLessThan(
      onLocalReady.mock.invocationCallOrder[0],
    )
    expect(
      onLocalReady.mock.invocationCallOrder[0],
    ).toBeLessThan(
      databaseMocks.connect.mock.invocationCallOrder[0],
    )

    finishConnection?.()
    await access
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

  it.each([true, false])("does not expose another account's cache if cleanup fails (online: %s)", async (online) => {
    const { setPowerSyncAccess } = await loadConnection()
    await setPowerSyncAccess({ userId: "owner", connectToBackend: false })
    const ready = vi.fn()
    databaseMocks.disconnectAndClear.mockRejectedValueOnce(new Error("cleanup blocked"))
    await expect(setPowerSyncAccess({ userId: "member", connectToBackend: online, onLocalReady: ready }))
      .rejects.toThrow("cleanup blocked")
    expect(ready).not.toHaveBeenCalled()
    expect(databaseMocks.connect).not.toHaveBeenCalled()
    expect(readDatabaseOwner(window.localStorage)).toBe("owner")
    await setPowerSyncAccess({ userId: "member", connectToBackend: online, onLocalReady: ready })
    expect(databaseMocks.disconnectAndClear).toHaveBeenCalledTimes(2)
    expect(ready).toHaveBeenCalledTimes(1)
    expect(readDatabaseOwner(window.localStorage)).toBe("member")
  })

  it("waits for old-account cleanup before declaring the next account locally ready", async () => {
    const { setPowerSyncAccess } = await loadConnection()
    await setPowerSyncAccess({ userId: "owner", connectToBackend: false })
    let finishCleanup!: () => void
    databaseMocks.disconnectAndClear.mockImplementationOnce(() => new Promise<void>((resolve) => { finishCleanup = resolve }))
    const ready = vi.fn()
    const switching = setPowerSyncAccess({ userId: "member", connectToBackend: true, onLocalReady: ready })
    await vi.waitFor(() => expect(databaseMocks.disconnectAndClear).toHaveBeenCalledTimes(1))
    expect(ready).not.toHaveBeenCalled()
    expect(readDatabaseOwner(window.localStorage)).toBe("owner")
    finishCleanup()
    await switching
    expect(ready).toHaveBeenCalledTimes(1)
    expect(ready.mock.invocationCallOrder[0]).toBeLessThan(databaseMocks.connect.mock.invocationCallOrder[0])
    expect(readDatabaseOwner(window.localStorage)).toBe("member")
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

  it("disconnects offline and reconnects the same user without clearing local data", async () => {
    const { setPowerSyncAccess } =
      await loadConnection()

    await setPowerSyncAccess({
      userId: "user-1",
      connectToBackend: true,
    })

    await setPowerSyncAccess({
      userId: "user-1",
      connectToBackend: false,
    })

    await setPowerSyncAccess({
      userId: "user-1",
      connectToBackend: true,
    })

    expect(databaseMocks.connect).toHaveBeenCalledTimes(2)
    expect(databaseMocks.disconnect).toHaveBeenCalledTimes(1)

    expect(
      databaseMocks.disconnectAndClear,
    ).not.toHaveBeenCalled()

    expect(
      readDatabaseOwner(window.localStorage),
    ).toBe("user-1")
  })

})
