import type { HouseholdRole } from "../households/householdPermissions"

export interface HouseholdMember {
  id: string
  userId: string
  email: string | null
  displayName: string | null
  role: HouseholdRole
  joinedAt: string
  isCurrentUser: boolean
}

interface ClientOptions {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be non-empty text`)
  return value.trim()
}

function optionalText(value: unknown, field: string): string | null {
  return value === null || value === undefined || value === "" ? null : text(value, field)
}

function role(value: unknown): HouseholdRole {
  if (value !== "owner" && value !== "member") throw new Error("Invalid membership role")
  return value
}

function date(value: unknown): string {
  const result = text(value, "Membership date")
  if (Number.isNaN(Date.parse(result))) throw new Error("Invalid membership date")
  return result
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Invalid membership response")
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("Invalid membership row")
    return item as Record<string, unknown>
  })
}

export function parseHouseholdMembers(value: unknown): HouseholdMember[] {
  const members = rows(value).map((item) => {
    if (typeof item.is_current_user !== "boolean") throw new Error("Invalid membership identity")
    return {
      id: text(item.membership_id, "Membership ID"),
      userId: text(item.member_user_id, "Member user ID"),
      email: optionalText(item.member_email, "Member email"),
      displayName: optionalText(item.member_display_name, "Member display name"),
      role: role(item.member_role),
      joinedAt: date(item.member_created_at),
      isCurrentUser: item.is_current_user,
    }
  })
  if (members.filter((member) => member.isCurrentUser).length !== 1 ||
    new Set(members.map((member) => member.id)).size !== members.length ||
    new Set(members.map((member) => member.userId)).size !== members.length) {
    throw new Error("Unable to verify the current household membership list")
  }
  return members
}

async function call(name: string, parameters: Record<string, unknown>, options: ClientOptions): Promise<unknown> {
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, parameters)
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function getHouseholdMembers(householdId: string, options: ClientOptions = {}): Promise<HouseholdMember[]> {
  return parseHouseholdMembers(await call("get_household_members", {
    p_household_id: text(householdId, "Household ID"),
  }, options))
}

function mutationResult(value: unknown, membershipId: string): Record<string, unknown> {
  const result = rows(value)
  if (result.length !== 1 || result[0].membership_id !== membershipId) throw new Error("Membership change could not be confirmed")
  text(result[0].member_user_id, "Member user ID")
  return result[0]
}

export async function updateHouseholdMemberRole(householdId: string, membershipId: string, nextRole: HouseholdRole, options: ClientOptions = {}): Promise<void> {
  const result = mutationResult(await call("update_household_member_role", {
    p_household_id: text(householdId, "Household ID"),
    p_membership_id: text(membershipId, "Membership ID"),
    p_role: role(nextRole),
  }, options), membershipId)
  role(result.previous_role)
  if (role(result.member_role) !== nextRole) throw new Error("Membership role change could not be confirmed")
  date(result.changed_at)
}

export async function revokeHouseholdMember(householdId: string, membershipId: string, options: ClientOptions = {}): Promise<void> {
  const result = mutationResult(await call("revoke_household_member", {
    p_household_id: text(householdId, "Household ID"),
    p_membership_id: text(membershipId, "Membership ID"),
  }, options), membershipId)
  role(result.former_role)
  date(result.revoked_at)
}

export function householdMemberLabel(member: HouseholdMember): string {
  return member.displayName ?? member.email ?? `Account ${member.userId.slice(0, 8)}`
}
