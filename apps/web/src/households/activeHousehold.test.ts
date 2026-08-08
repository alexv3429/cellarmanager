import { describe, expect, it } from "vitest"

import {
  ACTIVE_HOUSEHOLD_STORAGE_KEY,
  type ActiveHouseholdStorage,
  clearActiveHouseholds,
  readActiveHouseholdId,
  readStoredActiveHouseholds,
  resolveActiveHouseholdId,
  saveActiveHouseholdId,
} from "./activeHousehold"

class MemoryStorage implements ActiveHouseholdStorage {
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

describe("active household selection", () => {
  it("persists a household independently for each user", () => {
    const storage = new MemoryStorage()

    saveActiveHouseholdId(
      storage,
      "user-1",
      "household-1",
    )
    saveActiveHouseholdId(
      storage,
      "user-2",
      "household-2",
    )

    expect(
      readActiveHouseholdId(storage, "user-1"),
    ).toBe("household-1")

    expect(
      readActiveHouseholdId(storage, "user-2"),
    ).toBe("household-2")
  })

  it("returns null when the user has no selection", () => {
    const storage = new MemoryStorage()

    expect(
      readActiveHouseholdId(storage, "user-1"),
    ).toBeNull()
  })

  it("rejects malformed persisted selection data", () => {
    const storage = new MemoryStorage()

    storage.setItem(
      ACTIVE_HOUSEHOLD_STORAGE_KEY,
      JSON.stringify(["not", "a", "map"]),
    )

    expect(() =>
      readStoredActiveHouseholds(storage),
    ).toThrow(
      "Stored active household selection is invalid",
    )
  })


  it("keeps a valid stored household selection", () => {
    expect(
      resolveActiveHouseholdId(
        "household-2",
        ["household-1", "household-2"],
      ),
    ).toBe("household-2")
  })

  it("falls back to the first available household", () => {
    expect(
      resolveActiveHouseholdId(
        "household-missing",
        ["household-1", "household-2"],
      ),
    ).toBe("household-1")

    expect(
      resolveActiveHouseholdId(null, []),
    ).toBeNull()
  })

  it("clears all persisted selections", () => {
    const storage = new MemoryStorage()

    saveActiveHouseholdId(
      storage,
      "user-1",
      "household-1",
    )

    clearActiveHouseholds(storage)

    expect(
      storage.getItem(
        ACTIVE_HOUSEHOLD_STORAGE_KEY,
      ),
    ).toBeNull()
  })
})
