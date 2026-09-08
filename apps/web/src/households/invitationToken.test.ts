import { describe, expect, it } from "vitest"

import {
  buildHouseholdInvitationUrl,
  captureHouseholdInvitationToken,
  clearHouseholdInvitationToken,
  getHouseholdInvitationTokenFromUrl,
  getInvitationUrlWithoutSecret,
  HOUSEHOLD_INVITATION_STORAGE_KEY,
  readHouseholdInvitationToken,
} from "./invitationToken"

const TOKEN = "a".repeat(64)

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe("household invitation links", () => {
  it("shares secure public links even if opened from HTTP", () => {
    expect(buildHouseholdInvitationUrl("http://cellar.trycloudflare.com", TOKEN))
      .toBe(`https://cellar.trycloudflare.com/invite#token=${TOKEN}`)
    expect(buildHouseholdInvitationUrl("http://localhost:8796", TOKEN))
      .toBe(`http://localhost:8796/invite#token=${TOKEN}`)
  })

  it("keeps the bearer secret in the fragment", () => {
    expect(
      buildHouseholdInvitationUrl(
        "https://cellarmanager.example.com/catalog",
        TOKEN,
      ),
    ).toBe(
      `https://cellarmanager.example.com/invite#token=${TOKEN}`,
    )
  })

  it("reads only a valid invitation fragment on the invitation route", () => {
    expect(
      getHouseholdInvitationTokenFromUrl(
        `https://cellarmanager.example.com/invite#token=${TOKEN}`,
      ),
    ).toBe(TOKEN)
    expect(
      getHouseholdInvitationTokenFromUrl(
        `https://cellarmanager.example.com/catalog#token=${TOKEN}`,
      ),
    ).toBeNull()
    expect(
      getHouseholdInvitationTokenFromUrl(
        `https://cellarmanager.example.com/invite?token=${TOKEN}`,
      ),
    ).toBeNull()
    expect(
      getHouseholdInvitationTokenFromUrl(
        "https://cellarmanager.example.com/invite#token=too-short",
      ),
    ).toBeNull()
  })

  it("persists the token across signup confirmation redirects", () => {
    const storage = new MemoryStorage()

    expect(
      captureHouseholdInvitationToken(
        `https://cellarmanager.example.com/invite#token=${TOKEN}`,
        storage,
      ),
    ).toBe(TOKEN)
    expect(
      captureHouseholdInvitationToken(
        "https://cellarmanager.example.com/#access_token=callback",
        storage,
      ),
    ).toBe(TOKEN)
    expect(
      storage.getItem(
        HOUSEHOLD_INVITATION_STORAGE_KEY,
      ),
    ).toBe(TOKEN)
  })

  it("removes only a recognized invitation secret from the visible URL", () => {
    expect(
      getInvitationUrlWithoutSecret(
        `https://cellarmanager.example.com/invite?from=email#token=${TOKEN}`,
      ),
    ).toBe("/invite?from=email")
    expect(
      getInvitationUrlWithoutSecret(
        "https://cellarmanager.example.com/#access_token=callback",
      ),
    ).toBeNull()
  })

  it("clears a completed or dismissed invitation", () => {
    const storage = new MemoryStorage()
    storage.setItem(
      HOUSEHOLD_INVITATION_STORAGE_KEY,
      TOKEN,
    )

    clearHouseholdInvitationToken(storage)

    expect(readHouseholdInvitationToken(storage)).toBeNull()
  })

  it("fails closed when browser storage is blocked", () => {
    const blockedStorage = {
      getItem: () => {
        throw new Error("blocked")
      },
      removeItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }

    expect(
      captureHouseholdInvitationToken(
        `https://cellarmanager.example.com/invite#token=${TOKEN}`,
        blockedStorage,
      ),
    ).toBe(TOKEN)
    expect(readHouseholdInvitationToken(blockedStorage)).toBeNull()
    expect(() =>
      clearHouseholdInvitationToken(blockedStorage),
    ).not.toThrow()
  })
})
