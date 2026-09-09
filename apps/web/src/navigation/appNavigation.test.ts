import { describe, expect, it } from "vitest"

import {
  getAppRouteFromPathname,
  getAppRouteForRole,
  getAppRouteTitle,
  getAppViewFromPathname,
  getAppViewPath,
  getWineDetailPath,
  getWineDetailReturnView,
} from "./appNavigation"

describe("app navigation", () => {
  it.each(["/", "/catalog", "/catalog/", "/cellar", "/cellar/"])("resolves %s to the Member cellar on refresh or history navigation", (path) => {
    expect(getAppRouteForRole(getAppRouteFromPathname(path), "member")).toEqual({ view: "cellar", wineId: null })
  })

  it("resolves Owner and Member switches without retaining a management route", () => {
    const ownerRoute = getAppRouteFromPathname("/catalog")
    const memberRoute = getAppRouteForRole(ownerRoute, "member")
    expect(getAppRouteForRole(memberRoute, "owner")).toEqual({ view: "inventory", wineId: null })
    expect(getAppRouteForRole(ownerRoute, "owner")).toEqual(ownerRoute)
    expect(getAppViewPath("cellar")).toBe("/cellar")
    expect(getAppRouteTitle(memberRoute)).toBe("Cellar · CellarManager")
    expect(getWineDetailReturnView({ wineDetailReturnView: "cellar" })).toBe("cellar")
  })

  it.each(["/wines/test-wine", "/pairing", "/data", "/activity", "/members", "/devices"])("keeps Member read-only deep links for %s", (path) => {
    const route = getAppRouteFromPathname(path)
    expect(getAppRouteForRole(route, "member")).toEqual(route)
  })
  it("maps application paths to views", () => {
    expect(getAppViewFromPathname("/members")).toBe("members")
    expect(getAppViewFromPathname("/devices")).toBe("devices")
    expect(getAppViewFromPathname("/")).toBe("inventory")
    expect(getAppViewFromPathname("/pairing")).toBe("pairing")
    expect(getAppViewFromPathname("/activity")).toBe("activity")
    expect(getAppViewFromPathname("/catalog")).toBe("catalog")
    expect(getAppViewFromPathname("/data")).toBe("import")
    expect(getAppViewFromPathname("/import")).toBe("import")
    expect(getAppViewFromPathname("/invite")).toBe("invite")
    expect(getAppViewFromPathname("/setup")).toBe("setup")
  })

  it("accepts trailing slashes", () => {
    expect(getAppViewFromPathname("/members/")).toBe("members")
    expect(getAppViewFromPathname("/devices/")).toBe("devices")
    expect(getAppViewFromPathname("/activity/")).toBe("activity")
    expect(getAppViewFromPathname("/pairing/")).toBe("pairing")
    expect(getAppViewFromPathname("/catalog/")).toBe("catalog")
    expect(getAppViewFromPathname("/data/")).toBe("import")
    expect(getAppViewFromPathname("/import/")).toBe("import")
    expect(getAppViewFromPathname("/invite/")).toBe("invite")
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
    expect(getAppViewPath("members")).toBe("/members")
    expect(getAppViewPath("devices")).toBe("/devices")
    expect(getAppViewPath("inventory")).toBe("/")
    expect(getAppViewPath("pairing")).toBe("/pairing")
    expect(getAppViewPath("activity")).toBe("/activity")
    expect(getAppViewPath("catalog")).toBe("/catalog")
    expect(getAppViewPath("import")).toBe("/data")
    expect(getAppViewPath("invite")).toBe("/invite")
    expect(getAppViewPath("setup")).toBe("/setup")
  })

  it("encodes wine IDs in canonical paths", () => {
    expect(getWineDetailPath("wine special/2020")).toBe(
      "/wines/wine%20special%2F2020",
    )
  })

  it("provides route-specific document titles", () => {
    expect(getAppRouteTitle({ view: "members", wineId: null })).toBe("Household members · CellarManager")
    expect(getAppRouteTitle({ view: "devices", wineId: null })).toBe("Devices · CellarManager")
    expect(
      getAppRouteTitle({ view: "inventory", wineId: null }),
    ).toBe("Inventory · CellarManager")
    expect(
      getAppRouteTitle({ view: "activity", wineId: null }),
    ).toBe("Activity · CellarManager")
    expect(
      getAppRouteTitle({ view: "pairing", wineId: null }),
    ).toBe("Food pairing · CellarManager")
    expect(
      getAppRouteTitle({ view: "import", wineId: null }),
    ).toBe("Cellar data · CellarManager")
    expect(
      getAppRouteTitle({ view: "invite", wineId: null }),
    ).toBe("Household invitations · CellarManager")
    expect(
      getAppRouteTitle({ view: "wine", wineId: "wine-1" }),
    ).toBe("Wine details · CellarManager")
  })

  it("restores safe wine detail return destinations", () => {
    expect(getWineDetailReturnView({ wineDetailReturnView: "members" })).toBe("members")
    expect(getWineDetailReturnView({ wineDetailReturnView: "devices" })).toBe("devices")
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
        wineDetailReturnView: "pairing",
      }),
    ).toBe("pairing")

    expect(
      getWineDetailReturnView({
        wineDetailReturnView: "external",
      }),
    ).toBeNull()

    expect(getWineDetailReturnView(null)).toBeNull()
  })
})
