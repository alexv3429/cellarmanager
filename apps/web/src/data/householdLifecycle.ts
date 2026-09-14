import type { HouseholdMember } from "./householdMembers"
import type { HouseholdRole } from "../households/householdPermissions"

export interface OwnHouseholdAccess {
  householdId: string
  userId: string
  membershipId: string | null
  role: HouseholdRole | null
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: { message: string } | null }>
}

async function call(name: string, parameters: Record<string, unknown>, options: Options) {
  if (Object.values(parameters).some((value) => typeof value !== "string" || !value.trim())) throw new Error("Missing household membership details")
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, parameters)
  if (result.error) throw new Error(result.error.message)
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error("Access change could not be verified")
  return result.data as Record<string, unknown>
}

function access(data: Record<string, unknown>, householdId: string, userId: string): OwnHouseholdAccess {
  if (data.household_id !== householdId || data.user_id !== userId ||
    !(data.role === "owner" || data.role === "member" || data.role === null) ||
    !(data.membership_id === null || (typeof data.membership_id === "string" && data.membership_id.trim()))) {
    throw new Error("Household access response does not match this account")
  }
  return { householdId, userId, membershipId: data.membership_id as string | null, role: data.role }
}

export async function getOwnHouseholdAccess(householdId: string, userId: string, options: Options = {}) {
  const result = access(await call("get_my_household_membership", { p_household_id: householdId }, options), householdId, userId)
  if ((result.membershipId === null) !== (result.role === null)) throw new Error("Invalid household membership")
  return result
}

function changed(data: Record<string, unknown>, householdId: string, actor: HouseholdMember, nextRole: "member" | null) {
  const result = access(data, householdId, actor.userId)
  if (result.membershipId !== actor.id || result.role !== nextRole ||
    typeof data.changed_at !== "string" || Number.isNaN(Date.parse(data.changed_at))) throw new Error("Access change could not be verified")
  return result
}

export async function transferHouseholdOwnership(householdId: string, actor: HouseholdMember, successor: HouseholdMember, options: Options = {}) {
  const data = await call("transfer_household_ownership", {
    p_household_id: householdId, p_membership_id: actor.id,
    p_successor_membership_id: successor.id, p_expected_successor_role: successor.role,
  }, options)
  if (data.successor_membership_id !== successor.id || data.successor_user_id !== successor.userId || data.successor_role !== "owner") {
    throw new Error("Ownership transfer could not be verified")
  }
  return changed(data, householdId, actor, "member")
}

export async function leaveHousehold(householdId: string, actor: HouseholdMember, options: Options = {}) {
  return changed(await call("leave_household", {
    p_household_id: householdId, p_membership_id: actor.id, p_expected_role: actor.role,
  }, options), householdId, actor, null)
}
