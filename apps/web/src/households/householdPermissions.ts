export type HouseholdRole = "owner" | "member"

export interface HouseholdPermissions {
  canImportInventory: boolean
  canManageCatalog: boolean
  canManageCellarSetup: boolean
  canManageHouseholdDevices: boolean
  canManageHouseholdGuidance: boolean
  canManageInventory: boolean
  canManageMembers: boolean
  canManageOwnDevices: boolean
  canManageSharedKnowledge: boolean
}

export function getHouseholdPermissions(
  role: HouseholdRole,
): HouseholdPermissions {
  const isOwner = role === "owner"

  return {
    canImportInventory: isOwner,
    canManageCatalog: isOwner,
    canManageCellarSetup: isOwner,
    canManageHouseholdDevices: isOwner,
    canManageHouseholdGuidance: isOwner,
    canManageInventory: true,
    canManageMembers: isOwner,
    canManageOwnDevices: true,
    canManageSharedKnowledge: isOwner,
  }
}

export function getHouseholdRoleLabel(
  role: HouseholdRole,
): string {
  return role === "owner" ? "Owner" : "Member"
}
