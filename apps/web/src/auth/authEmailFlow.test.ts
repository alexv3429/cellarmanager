import { describe, expect, it } from "vitest"

import {
  getAuthEmailRedirectTo,
  getAuthEmailRequestMessage,
  getPasswordResetValidationError,
  isPasswordRecoveryUrl,
  PASSWORD_RECOVERY_STORAGE_KEY,
  readPasswordRecoveryPending,
  setPasswordRecoveryPending,
} from "./authEmailFlow"

class MemoryStorage {
  private readonly values = new Map<string, string>()

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

describe("authentication email redirects", () => {
  it("uses only the deployed application origin", () => {
    expect(
      getAuthEmailRedirectTo(
        "https://cellarmanager.example.com/import?step=2",
      ),
    ).toBe("https://cellarmanager.example.com")
  })

  it("supports a local HTTP origin", () => {
    expect(
      getAuthEmailRedirectTo("http://127.0.0.1:5173"),
    ).toBe("http://127.0.0.1:5173")
  })

  it("rejects origins that cannot be used for web redirects", () => {
    expect(() =>
      getAuthEmailRedirectTo(
        "file:///tmp/cellarmanager",
      ),
    ).toThrow("must use HTTP or HTTPS")
  })
})

describe("authentication email guidance", () => {
  it("does not reveal whether a reset account exists", () => {
    expect(
      getAuthEmailRequestMessage("password-reset"),
    ).toContain("If an account exists")
  })

  it("mentions Spam for confirmation resends", () => {
    expect(
      getAuthEmailRequestMessage("signup-confirmation"),
    ).toContain("Spam")
  })
})

describe("password recovery callback detection", () => {
  it("detects an implicit recovery callback", () => {
    expect(
      isPasswordRecoveryUrl(
        "https://cellarmanager.example.com/#access_token=token&type=recovery",
      ),
    ).toBe(true)
  })

  it("detects a query-based recovery callback", () => {
    expect(
      isPasswordRecoveryUrl(
        "https://cellarmanager.example.com/?type=recovery",
      ),
    ).toBe(true)
  })

  it("does not classify confirmation callbacks as recovery", () => {
    expect(
      isPasswordRecoveryUrl(
        "https://cellarmanager.example.com/#type=signup",
      ),
    ).toBe(false)
  })
})

describe("password recovery continuity", () => {
  it("keeps recovery pending across a refresh", () => {
    const storage = new MemoryStorage()

    setPasswordRecoveryPending(storage, true)

    expect(readPasswordRecoveryPending(storage)).toBe(true)
    expect(
      storage.getItem(PASSWORD_RECOVERY_STORAGE_KEY),
    ).toBe("true")
  })

  it("clears recovery after completion", () => {
    const storage = new MemoryStorage()

    setPasswordRecoveryPending(storage, true)
    setPasswordRecoveryPending(storage, false)

    expect(readPasswordRecoveryPending(storage)).toBe(false)
  })

  it("continues in memory when storage is blocked", () => {
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
      readPasswordRecoveryPending(blockedStorage),
    ).toBe(false)
    expect(() =>
      setPasswordRecoveryPending(blockedStorage, true),
    ).not.toThrow()
  })
})

describe("new password validation", () => {
  it("requires the hosted minimum password length", () => {
    expect(
      getPasswordResetValidationError("short", "short"),
    ).toBe("Password must be at least 6 characters.")
  })

  it("requires matching passwords", () => {
    expect(
      getPasswordResetValidationError(
        "new-password",
        "different-password",
      ),
    ).toBe("Passwords do not match.")
  })

  it("accepts a valid matching password", () => {
    expect(
      getPasswordResetValidationError(
        "new-password",
        "new-password",
      ),
    ).toBeNull()
  })
})
