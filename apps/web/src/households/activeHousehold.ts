export const ACTIVE_HOUSEHOLD_STORAGE_KEY =
  "cellarmanager.active_household.v1"

export interface ActiveHouseholdStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function requireNonEmptyString(
  value: string,
  field: string,
): string {
  const cleaned = value.trim()

  if (cleaned.length === 0) {
    throw new Error(
      `Active household field is invalid: ${field}`,
    )
  }

  return cleaned
}

export function readStoredActiveHouseholds(
  storage: ActiveHouseholdStorage,
): Record<string, string> {
  const rawValue = storage.getItem(
    ACTIVE_HOUSEHOLD_STORAGE_KEY,
  )

  if (!rawValue) {
    return {}
  }

  const parsedValue: unknown = JSON.parse(rawValue)

  if (
    typeof parsedValue !== "object" ||
    parsedValue === null ||
    Array.isArray(parsedValue)
  ) {
    throw new Error(
      "Stored active household selection is invalid",
    )
  }

  const activeHouseholds: Record<string, string> = {}

  for (const [userId, householdId] of Object.entries(
    parsedValue,
  )) {
    if (
      userId.trim().length > 0 &&
      typeof householdId === "string" &&
      householdId.trim().length > 0
    ) {
      activeHouseholds[userId] = householdId
    }
  }

  return activeHouseholds
}

export function readActiveHouseholdId(
  storage: ActiveHouseholdStorage,
  userId: string,
): string | null {
  const activeHouseholds =
    readStoredActiveHouseholds(storage)

  return activeHouseholds[userId] ?? null
}

export function saveActiveHouseholdId(
  storage: ActiveHouseholdStorage,
  userId: string,
  householdId: string,
): void {
  const activeHouseholds =
    readStoredActiveHouseholds(storage)

  storage.setItem(
    ACTIVE_HOUSEHOLD_STORAGE_KEY,
    JSON.stringify({
      ...activeHouseholds,
      [requireNonEmptyString(userId, "userId")]:
        requireNonEmptyString(
          householdId,
          "householdId",
        ),
    }),
  )
}

export function clearActiveHouseholds(
  storage: ActiveHouseholdStorage,
): void {
  storage.removeItem(ACTIVE_HOUSEHOLD_STORAGE_KEY)
}

export function resolveActiveHouseholdId(
  storedHouseholdId: string | null,
  availableHouseholdIds: string[],
): string | null {
  if (
    storedHouseholdId &&
    availableHouseholdIds.includes(storedHouseholdId)
  ) {
    return storedHouseholdId
  }

  return availableHouseholdIds[0] ?? null
}
