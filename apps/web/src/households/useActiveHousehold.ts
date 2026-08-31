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

  const [activeHouseholdId, setActiveHouseholdId] =
    useState<string | null>(() =>
      readInitialActiveHouseholdId(userId),
    )

  const [selectionError, setSelectionError] =
    useState<string | null>(null)

  useEffect(() => {
    if (isLoading) {
      return
    }

    try {
      const storedHouseholdId =
        readActiveHouseholdId(
          window.localStorage,
          userId,
        )

      const resolvedHouseholdId =
        resolveActiveHouseholdId(
          storedHouseholdId,
          households.map((household) => household.id),
        )

      setActiveHouseholdId(resolvedHouseholdId)
      setSelectionError(null)

      if (resolvedHouseholdId) {
        saveActiveHouseholdId(
          window.localStorage,
          userId,
          resolvedHouseholdId,
        )
      }
    } catch (error: unknown) {
      setActiveHouseholdId(
        households[0]?.id ?? null,
      )
      setSelectionError(
        error instanceof Error
          ? error.message
          : "Unable to restore household selection",
      )
    }
  }, [households, isLoading, userId])

  const selectHousehold = useCallback(
    (householdId: string) => {
      if (
        !households.some(
          (household) => household.id === householdId,
        )
      ) {
        setSelectionError(
          "Selected household is not available",
        )
        return
      }

      try {
        saveActiveHouseholdId(
          window.localStorage,
          userId,
          householdId,
        )

        setActiveHouseholdId(householdId)
        setSelectionError(null)
      } catch (error: unknown) {
        setSelectionError(
          error instanceof Error
            ? error.message
            : "Unable to save household selection",
        )
      }
    },
    [households, userId],
  )

  return {
    activeHouseholdId,
    households,
    error:
      selectionError ??
      (householdsError
        ? String(householdsError)
        : null),
    isLoading,
    selectHousehold,
  }
}
