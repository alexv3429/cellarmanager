import { describe, expect, it } from "vitest"
import { getHouseholdRoute, householdHistoryState, isOtherHouseholdHistory } from "./householdNavigation"

describe("household-scoped navigation", () => {
  it.each(["/wines/old-wine", "/setup", "/data", "/pairing"])("does not reopen %s from another household", (path) => {
    expect(getHouseholdRoute(path, householdHistoryState("a", "pairing"), "b", "member"))
      .toEqual({ view: "cellar", wineId: null })
    expect(getHouseholdRoute(path, householdHistoryState("a"), "b", "owner"))
      .toEqual({ view: "inventory", wineId: null })
  })
  it("retains a fresh wine deep link and same-household history", () => {
    for (const state of [null, householdHistoryState("a", "pairing")]) {
      expect(getHouseholdRoute("/wines/wine-a", state, "a", "owner")).toEqual({ view: "wine", wineId: "wine-a" })
    }
    expect(householdHistoryState("a", "pairing")).toEqual({ householdId: "a", wineDetailReturnView: "pairing" })
  })
  it("uses the current role, not a role remembered in history", () => {
    expect(getHouseholdRoute("/catalog", { householdId: "a", role: "owner" }, "a", "member"))
      .toEqual({ view: "cellar", wineId: null })
  })
  it.each([null, {}, [], "a", { householdId: 5 }])("tolerates legacy or malformed history %j", (state) => {
    expect(isOtherHouseholdHistory(state, "a")).toBe(false)
  })
})
