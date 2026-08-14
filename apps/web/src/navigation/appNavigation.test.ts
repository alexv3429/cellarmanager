import { describe, expect, it } from "vitest"

import {
  getAppRouteFromPathname,
  getAppRouteTitle,
  getAppViewFromPathname,
  getAppViewPath,
  getWineDetailPath,
  getWineDetailReturnView,
} from "./appNavigation"

describe("app navigation", () => {
  it("maps application paths to views", () => {
    expect(getAppViewFromPathname("/")).toBe("inventory")
    expect(getAppViewFromPathname("/activity")).toBe("activity")
    expect(getAppViewFromPathname("/catalog")).toBe("catalog")
    expect(getAppViewFromPathname("/import")).toBe("import")
    expect(getAppViewFromPathname("/setup")).toBe("setup")
  })

  it("accepts trailing slashes", () => {
    expect(getAppViewFromPathname("/activity/")).toBe("activity")
    expect(getAppViewFromPathname("/catalog/")).toBe("catalog")
    expect(getAppViewFromPathname("/import/")).toBe("import")
    expect(getAppViewFromPathname("/setup/")).toBe("setup")
  })

  it("falls back to inventory for unknown paths", () => {
    expect(getAppViewFromPathname("/unknown")).toBe(
      "inventory",
    )
  })

  it("resolves canonical wine detail paths", () => {
    expect(
      getAppRouteFromPathname("/wines/wine-123"),
    ).toEqual({
      view: "wine",
      wineId: "wine-123",
    })

    expect(
      getAppRouteFromPathname("/wines/wine%20special/"),
    ).toEqual({
      view: "wine",
      wineId: "wine special",
    })

    expect(getAppViewFromPathname("/wines/wine-123")).toBe(
      "catalog",
    )
  })

  it("rejects malformed or nested wine detail paths", () => {
    expect(getAppRouteFromPathname("/wines/%E0%A4%A")).toEqual({
      view: "inventory",
      wineId: null,
    })

    expect(
      getAppRouteFromPathname("/wines/wine-123/history"),
    ).toEqual({
      view: "inventory",
      wineId: null,
    })
  })

  it("maps views to canonical paths", () => {
    expect(getAppViewPath("inventory")).toBe("/")
    expect(getAppViewPath("activity")).toBe("/activity")
    expect(getAppViewPath("catalog")).toBe("/catalog")
    expect(getAppViewPath("import")).toBe("/import")
    expect(getAppViewPath("setup")).toBe("/setup")
  })

  it("encodes wine IDs in canonical paths", () => {
    expect(getWineDetailPath("wine special/2020")).toBe(
      "/wines/wine%20special%2F2020",
    )
  })

  it("provides route-specific document titles", () => {
    expect(
      getAppRouteTitle({ view: "inventory", wineId: null }),
    ).toBe("Inventory · CellarManager")
    expect(
      getAppRouteTitle({ view: "activity", wineId: null }),
    ).toBe("Activity · CellarManager")
    expect(
      getAppRouteTitle({ view: "wine", wineId: "wine-1" }),
    ).toBe("Wine details · CellarManager")
  })

  it("restores safe wine detail return destinations", () => {
    expect(
      getWineDetailReturnView({
        wineDetailReturnView: "inventory",
      }),
    ).toBe("inventory")

    expect(
      getWineDetailReturnView({
        wineDetailReturnView: "activity",
      }),
    ).toBe("activity")

    expect(
      getWineDetailReturnView({
        wineDetailReturnView: "external",
      }),
    ).toBeNull()

    expect(getWineDetailReturnView(null)).toBeNull()
  })
})
