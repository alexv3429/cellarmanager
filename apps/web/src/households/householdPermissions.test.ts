import { describe, expect, it } from "vitest"

import {
  getHouseholdPermissions,
  getHouseholdRoleLabel,
} from "./householdPermissions"

describe("household permission model", () => {
  it("keeps member device access without shared cellar management", () => {
    expect(getHouseholdPermissions("member")).toEqual({
      canImportInventory: false,
      canManageCatalog: false,
      canManageCellarSetup: false,
      canManageHouseholdDevices: false,
      canManageHouseholdGuidance: false,
      canManageInventory: false,
      canManageMembers: false,
      canManageOwnDevices: true,
      canManageSharedKnowledge: false,
    })
  })

  it("gives owners every household management capability", () => {
    expect(
      Object.values(
        getHouseholdPermissions("owner"),
      ).every(Boolean),
    ).toBe(true)
  })

  it("uses human-readable role labels", () => {
    expect(getHouseholdRoleLabel("owner")).toBe("Owner")
    expect(getHouseholdRoleLabel("member")).toBe("Member")
  })
})
