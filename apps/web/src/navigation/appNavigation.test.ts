import { describe, expect, it } from "vitest"

import {
  getAppViewFromPathname,
  getAppViewPath,
} from "./appNavigation"

describe("app navigation", () => {
  it("maps application paths to views", () => {
    expect(getAppViewFromPathname("/")).toBe("inventory")
    expect(getAppViewFromPathname("/catalog")).toBe("catalog")
    expect(getAppViewFromPathname("/setup")).toBe("setup")
  })

  it("accepts trailing slashes", () => {
    expect(getAppViewFromPathname("/catalog/")).toBe("catalog")
    expect(getAppViewFromPathname("/setup/")).toBe("setup")
  })

  it("falls back to inventory for unknown paths", () => {
    expect(getAppViewFromPathname("/unknown")).toBe(
      "inventory",
    )
  })

  it("maps views to canonical paths", () => {
    expect(getAppViewPath("inventory")).toBe("/")
    expect(getAppViewPath("catalog")).toBe("/catalog")
    expect(getAppViewPath("setup")).toBe("/setup")
  })
})
