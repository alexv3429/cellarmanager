import { describe, expect, it, vi } from "vitest"

import {
  DEVICE_IDS_STORAGE_KEY,
  type DeviceIdentityStorage,
  clearDeviceIdentities,
  getBrowserName,
  getOrCreateDeviceId,
  readStoredDeviceIds,
} from "./deviceIdentity"

class MemoryStorage implements DeviceIdentityStorage {
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

describe("browser device identity", () => {
  it("creates and then reuses a stable UUID", () => {
    const storage = new MemoryStorage()
    const createUuid = vi.fn(() => "device-1")

    expect(
      getOrCreateDeviceId(
        storage,
        "household-1",
        createUuid,
      ),
    ).toBe("device-1")

    expect(
      getOrCreateDeviceId(
        storage,
        "household-1",
        createUuid,
      ),
    ).toBe("device-1")

    expect(createUuid).toHaveBeenCalledTimes(1)
  })

  it("uses a different UUID for another household", () => {
    const storage = new MemoryStorage()
    const createUuid = vi
      .fn()
      .mockReturnValueOnce("device-1")
      .mockReturnValueOnce("device-2")

    expect(
      getOrCreateDeviceId(
        storage,
        "household-1",
        createUuid,
      ),
    ).toBe("device-1")

    expect(
      getOrCreateDeviceId(
        storage,
        "household-2",
        createUuid,
      ),
    ).toBe("device-2")

    expect(readStoredDeviceIds(storage)).toEqual({
      "household-1": "device-1",
      "household-2": "device-2",
    })
  })

  it("rejects invalid persisted identity data", () => {
    const storage = new MemoryStorage()

    storage.setItem(
      DEVICE_IDS_STORAGE_KEY,
      JSON.stringify(["not", "a", "map"]),
    )

    expect(() => readStoredDeviceIds(storage)).toThrow(
      "Stored device identity is invalid",
    )
  })

  it("clears stored browser device identities", () => {
    const storage = new MemoryStorage()

    getOrCreateDeviceId(
      storage,
      "household-1",
      () => "device-1",
    )

    clearDeviceIdentities(storage)

    expect(readStoredDeviceIds(storage)).toEqual({})
  })

  it("derives a readable browser name", () => {
    expect(
      getBrowserName(
        "Mozilla/5.0 Chrome/150.0 Safari/537.36",
        "MacIntel",
      ),
    ).toBe("Chrome on MacIntel")

    expect(
      getBrowserName(
        "Mozilla/5.0 Version/18.0 Mobile Safari/604.1",
        "iPhone",
      ),
    ).toBe("Safari on iPhone")
  })
})
