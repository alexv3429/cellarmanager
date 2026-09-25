import { describe, expect, it } from "vitest"
import { detectDeviceLanguage, normalizeLanguagePreference, readLocalLanguagePreference, resolveLanguage, writeLocalLanguagePreference } from "./language"

describe("language preference rules", () => {
  it.each([
    [["fr-FR"], "fr"], [["fr-CA"], "fr"], [["en-GB"], "en"], [["de-DE", "fr-FR"], "en"], [[], "en"],
  ] as const)("detects a supported language from %j", (locales, expected) => {
    expect(detectDeviceLanguage(locales)).toBe(expected)
  })

  it.each([["fr", "fr"], ["en", "en"], ["system", "system"], ["de", "system"], [null, "system"]] as const)(
    "normalizes preference %s",
    (value, expected) => expect(normalizeLanguagePreference(value)).toBe(expected),
  )

  it("uses device language only for the system setting and explicit choices override it", () => {
    expect(resolveLanguage("system", ["fr-FR"])).toBe("fr")
    expect(resolveLanguage("fr", ["en-US"])).toBe("fr")
    expect(resolveLanguage("en", ["fr-FR"])).toBe("en")
  })

  it("stores a per-user offline fallback without leaking it across accounts", () => {
    const storage = new Map<string, string>()
    const mock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    }
    expect(writeLocalLanguagePreference(mock, "alice", "fr")).toBe(true)
    expect(readLocalLanguagePreference(mock, "alice")).toBe("fr")
    expect(readLocalLanguagePreference(mock, "bob")).toBeNull()
  })
})
