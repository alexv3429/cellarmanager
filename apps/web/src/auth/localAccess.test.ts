import { describe, expect, it } from "vitest"

import {
  DATABASE_OWNER_STORAGE_KEY,
  LOCAL_ACCESS_STORAGE_KEY,
  type LocalAccessStorage,
  clearDatabaseOwner,
  clearLocalAccess,
  readLocalAccess,
  resolveOfflineUserId,
  saveLocalAccess,
  setDatabaseOwner,
} from "./localAccess"

class MemoryStorage implements LocalAccessStorage {
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

const USER_ONE =
  "00000000-0000-4000-8000-000000000001"

const USER_TWO =
  "00000000-0000-4000-8000-000000000002"

describe("local offline access", () => {
  it("restores the user when the grant matches the database owner", () => {
    const storage = new MemoryStorage()

    saveLocalAccess(
      storage,
      USER_ONE,
      new Date("2026-08-06T20:00:00Z"),
    )

    setDatabaseOwner(storage, USER_ONE)

    expect(resolveOfflineUserId(storage)).toBe(USER_ONE)

    expect(readLocalAccess(storage)).toEqual({
      userId: USER_ONE,
      authenticatedAt: "2026-08-06T20:00:00.000Z",
    })
  })

  it("does not grant access without a database owner", () => {
    const storage = new MemoryStorage()

    saveLocalAccess(storage, USER_ONE)

    expect(resolveOfflineUserId(storage)).toBeNull()
  })

  it("does not unlock another user's database", () => {
    const storage = new MemoryStorage()

    saveLocalAccess(storage, USER_ONE)
    setDatabaseOwner(storage, USER_TWO)

    expect(resolveOfflineUserId(storage)).toBeNull()
  })

  it("clears both local access and database ownership", () => {
    const storage = new MemoryStorage()

    saveLocalAccess(storage, USER_ONE)
    setDatabaseOwner(storage, USER_ONE)

    clearLocalAccess(storage)
    clearDatabaseOwner(storage)

    expect(
      storage.getItem(LOCAL_ACCESS_STORAGE_KEY),
    ).toBeNull()

    expect(
      storage.getItem(DATABASE_OWNER_STORAGE_KEY),
    ).toBeNull()
  })

  it("rejects malformed stored access data", () => {
    const storage = new MemoryStorage()

    storage.setItem(
      LOCAL_ACCESS_STORAGE_KEY,
      JSON.stringify({
        userId: USER_ONE,
        authenticatedAt: "not-a-date",
      }),
    )

    expect(() => readLocalAccess(storage)).toThrow(
      "Stored local access field is invalid: authenticatedAt",
    )
  })
})
