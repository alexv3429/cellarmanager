import { describe, expect, it } from "vitest"

import {
  formatLocalizedDate,
  formatLocalizedDateTime,
  formatLocalizedNumber,
  localeForLanguage,
} from "./formatting"

describe("locale-aware presentation formatting", () => {
  it("uses the account language rather than the browser default", () => {
    expect(localeForLanguage("fr")).toBe("fr-FR")
    expect(localeForLanguage("en")).toBe("en-US")
    expect(formatLocalizedDate(new Date(2026, 8, 26, 12), "fr")).toContain("26")
    expect(formatLocalizedDate(new Date(2026, 8, 26, 12), "fr")).toContain("2026")
    expect(formatLocalizedDate(new Date(2026, 8, 26, 12), "fr"))
      .not.toBe(formatLocalizedDate(new Date(2026, 8, 26, 12), "en"))
  })

  it("formats counts and decimal values with locale-appropriate separators", () => {
    expect(formatLocalizedNumber(1243, "fr")).toBe("1\u202f243")
    expect(formatLocalizedNumber(1243, "en")).toBe("1,243")
    expect(formatLocalizedNumber(12.5, "fr", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    })).toBe("12,5")
  })

  it("keeps invalid source dates visible instead of rendering NaN", () => {
    expect(formatLocalizedDate("not-a-date", "fr")).toBe("not-a-date")
    expect(formatLocalizedDateTime("not-a-date", "en")).toBe("not-a-date")
    expect(formatLocalizedDateTime(new Date(Number.NaN), "fr")).toBe("")
  })
})
