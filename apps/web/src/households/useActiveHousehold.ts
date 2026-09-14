import { useQuery } from "@powersync/react"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  readActiveHouseholdId,
  resolveActiveHouseholdId,
  saveActiveHouseholdId,
} from "./activeHousehold"
import type { HouseholdRole } from "./householdPermissions"
import type { OwnHouseholdAccess } from "../data/householdLifecycle"

export interface HouseholdOption {
  id: string
  membershipId?: string
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
    data: synchronizedHouseholds,
    error: householdsError,
    isLoading,
  } = useQuery<HouseholdOption>(
    `
      select h.id, h.name, hm.role, hm.id as membershipId
      from households h
      join household_members hm
        on hm.household_id = h.id
      where hm.user_id = ?
      order by h.name, h.id
    `,
    [userId],
  )

  // Server-confirmed reductions apply before replication, never grant access.
  // Scope by both account and membership generation, so rejoining is distinct.
  const [restrictions, setRestrictions] = useState<OwnHouseholdAccess[]>([])
  const households = useMemo(() => synchronizedHouseholds.flatMap((household) => {
    const restriction = restrictions.find((entry) => entry.userId === userId && entry.householdId === household.id && entry.membershipId === household.membershipId)
    if (restriction?.role === null) return []
    return [{ ...household, role: restriction?.role === "member" ? "member" as const : household.role }]
  }), [synchronizedHouseholds, restrictions, userId])
  useEffect(() => {
    if (isLoading || householdsError) return
    setRestrictions((current) => {
      const pending = current.filter((entry) => entry.userId === userId && synchronizedHouseholds.some((household) =>
        household.id === entry.householdId && household.membershipId === entry.membershipId && household.role !== entry.role))
      return pending.length === current.length ? current : pending
    })
  }, [synchronizedHouseholds, isLoading, householdsError, userId, restrictions])
  const applyOwnAccess = useCallback((access: OwnHouseholdAccess) => {
    if (access.userId !== userId) return
    setRestrictions((current) => [...current.filter((entry) => entry.householdId !== access.householdId || entry.userId !== userId),
      ...(access.role === "owner" ? [] : [access])])
    setSelectionNotice(access.role === null ? "You left the household. Your account and the shared cellar are unchanged."
      : access.role === "member" ? "You now have read-only Member access. Your private notes and preferences are preserved." : null)
  }, [userId])

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
    applyOwnAccess,
  }
}
