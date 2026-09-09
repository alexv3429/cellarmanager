import { useQuery } from "@powersync/react"
import {
  useCallback,
  useEffect,
  useState,
} from "react"

import {
  readActiveHouseholdId,
  resolveActiveHouseholdId,
  saveActiveHouseholdId,
} from "./activeHousehold"
import type { HouseholdRole } from "./householdPermissions"

export interface HouseholdOption {
  id: string
  name: string
  role: HouseholdRole
}

function readInitialActiveHouseholdId(
  userId: string,
): string | null {
  try {
    return readActiveHouseholdId(
      window.localStorage,
      userId,
    )
  } catch {
    return null
  }
}

export function useActiveHousehold(userId: string) {
  const {
    data: households,
    error: householdsError,
    isLoading,
  } = useQuery<HouseholdOption>(
    `
      select h.id, h.name, hm.role
      from households h
      join household_members hm
        on hm.household_id = h.id
      where hm.user_id = ?
      order by h.name, h.id
    `,
    [userId],
  )

  const [selection, setSelection] = useState(() => ({
    userId,
    householdId: readInitialActiveHouseholdId(userId),
  }))

  const [selectionError, setSelectionError] =
    useState<string | null>(null)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)

  // A stored ID is a preference, never proof of membership. Resolve during
  // render so removed memberships cannot remain mounted for one more effect.
  const preferredId = selection.userId === userId ? selection.householdId : null
  const activeHouseholdId = householdsError ? null : resolveActiveHouseholdId(
    preferredId,
    households.map((household) => household.id),
  )
  const activeHouseholdName = households.find((household) => household.id === activeHouseholdId)?.name

  useEffect(() => {
    if (!activeHouseholdId || isLoading) return
    if (preferredId !== activeHouseholdId) {
      if (preferredId) {
        setSelectionNotice(`Your previous household is no longer available. You are now viewing ${activeHouseholdName}.`)
      }
      setSelection({ userId, householdId: activeHouseholdId })
    }
    try {
      saveActiveHouseholdId(window.localStorage, userId, activeHouseholdId)
      setSelectionError(null)
    } catch {
      setSelectionError("You can switch households, but this browser could not remember your selection for next time.")
    }
  }, [activeHouseholdId, activeHouseholdName, isLoading, preferredId, userId])

  const selectHousehold = useCallback(
    (householdId: string) => {
      if (
        householdsError ||
        !households.some(
          (household) => household.id === householdId,
        )
      ) {
        setSelectionError(
          "Selected household is not available",
        )
        return false
      }
      setSelection({ userId, householdId })
      setSelectionNotice(null)
      return true
    },
    [households, householdsError, userId],
  )

  return {
    activeHouseholdId,
    households,
    error: householdsError
        ? String(householdsError)
        : null,
    selectionWarning: selectionError,
    selectionNotice,
    isLoading,
    selectHousehold,
  }
}
