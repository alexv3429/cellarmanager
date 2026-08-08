export type HouseholdGateState =
  | "loading"
  | "ready"
  | "onboarding"
  | "offline-unavailable"
  | "error"

interface HouseholdGateInput {
  activeHouseholdId: string | null
  hasAuthenticatedSession: boolean
  householdCount: number
  householdError: string | null
  householdsLoading: boolean
  initialSyncComplete: boolean
  isOnline: boolean
  syncError: string | null
}

export function resolveHouseholdGate({
  activeHouseholdId,
  hasAuthenticatedSession,
  householdCount,
  householdError,
  householdsLoading,
  initialSyncComplete,
  isOnline,
  syncError,
}: HouseholdGateInput): HouseholdGateState {
  if (householdsLoading) {
    return "loading"
  }

  if (activeHouseholdId) {
    return "ready"
  }

  if (householdError || syncError) {
    return "error"
  }

  if (
    hasAuthenticatedSession &&
    isOnline &&
    !initialSyncComplete
  ) {
    return "loading"
  }

  // Membership data has arrived but the active-household effect
  // has not resolved the persisted/fallback selection yet.
  if (householdCount > 0) {
    return "loading"
  }

  if (!hasAuthenticatedSession || !isOnline) {
    return "offline-unavailable"
  }

  return "onboarding"
}
