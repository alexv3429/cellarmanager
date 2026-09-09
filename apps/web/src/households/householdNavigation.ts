import {
  getAppRouteForRole,
  getAppRouteFromPathname,
  type AppRoute,
  type AppView,
} from "../navigation/appNavigation"
import type { HouseholdRole } from "./householdPermissions"

export function householdHistoryState(householdId: string, returnView?: AppView) {
  return { householdId, ...(returnView ? { wineDetailReturnView: returnView } : {}) }
}

export function isOtherHouseholdHistory(state: unknown, householdId: string): boolean {
  return typeof state === "object" && state !== null && "householdId" in state &&
    typeof state.householdId === "string" && state.householdId !== householdId
}

export function householdHomeRoute(role: HouseholdRole): AppRoute {
  return { view: role === "owner" ? "inventory" : "cellar", wineId: null }
}

export function getHouseholdRoute(pathname: string, state: unknown, householdId: string, role: HouseholdRole): AppRoute {
  // Back/Forward never implicitly changes the active household. Old scoped
  // entries return to the current household's home instead of reopening a wine
  // or form from a different collection. Fresh, unscoped deep links still work.
  if (isOtherHouseholdHistory(state, householdId)) return householdHomeRoute(role)
  return getAppRouteForRole(getAppRouteFromPathname(pathname), role)
}
