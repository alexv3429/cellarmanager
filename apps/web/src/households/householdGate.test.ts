import { describe, expect, it } from "vitest"

import { resolveHouseholdGate } from "./householdGate"

const BASE_INPUT = {
  activeHouseholdId: null,
  hasAuthenticatedSession: true,
  householdCount: 0,
  householdError: null,
  householdsLoading: false,
  initialSyncComplete: true,
  isOnline: true,
  syncError: null,
}

describe("household application gate", () => {
  it("waits while the membership query is loading", () => {
    expect(
      resolveHouseholdGate({
        ...BASE_INPUT,
        householdsLoading: true,
      }),
    ).toBe("loading")
  })

  it("waits for initial online synchronization", () => {
    expect(
      resolveHouseholdGate({
        ...BASE_INPUT,
        initialSyncComplete: false,
      }),
    ).toBe("loading")
  })

  it("shows an error when synchronization fails before a household is available", () => {
    expect(
      resolveHouseholdGate({
        ...BASE_INPUT,
        initialSyncComplete: false,
        syncError: "Unable to synchronize",
      }),
    ).toBe("error")
  })

  it("waits for active selection when memberships have arrived", () => {
    expect(
      resolveHouseholdGate({
        ...BASE_INPUT,
        householdCount: 2,
      }),
    ).toBe("loading")
  })

  it("enters the application when an active household is available", () => {
    expect(
      resolveHouseholdGate({
        ...BASE_INPUT,
        activeHouseholdId: "household-1",
        householdCount: 1,
      }),
    ).toBe("ready")
  })

  it("shows onboarding only after an authenticated online user has synchronized no households", () => {
    expect(
      resolveHouseholdGate(BASE_INPUT),
    ).toBe("onboarding")
  })

  it("does not offer onboarding when offline household data is unavailable", () => {
    expect(
      resolveHouseholdGate({
        ...BASE_INPUT,
        hasAuthenticatedSession: false,
        isOnline: false,
      }),
    ).toBe("offline-unavailable")
  })

  it("allows offline access when a local active household exists", () => {
    expect(
      resolveHouseholdGate({
        ...BASE_INPUT,
        activeHouseholdId: "household-1",
        hasAuthenticatedSession: false,
        householdCount: 1,
        isOnline: false,
      }),
    ).toBe("ready")
  })
})
