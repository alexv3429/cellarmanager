import { describe, expect, it, vi } from "vitest"
import { getOwnHouseholdAccess, leaveHousehold, transferHouseholdOwnership } from "./householdLifecycle"
import type { HouseholdMember } from "./householdMembers"

const actor: HouseholdMember = { id: "a", userId: "u", role: "owner", email: null, displayName: null, joinedAt: "2026-09-13", isCurrentUser: true }
const successor: HouseholdMember = { ...actor, id: "b", userId: "v", role: "member", isCurrentUser: false }
const base = { household_id: "h", membership_id: "a", user_id: "u", changed_at: "2026-09-13T17:00:00Z" }
describe("household lifecycle RPC contracts", () => {
  it("transfers only the confirmed identities and roles", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: { ...base, role: "member", successor_membership_id: "b", successor_user_id: "v", successor_role: "owner" } })
    expect(await transferHouseholdOwnership("h", actor, successor, { rpc })).toEqual({ householdId: "h", membershipId: "a", userId: "u", role: "member" })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("transfer_household_ownership", { p_household_id: "h", p_membership_id: "a", p_successor_membership_id: "b", p_expected_successor_role: "member" })
  })
  it("leaves the exact own membership, not an arbitrary user", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: { ...base, role: null } })
    expect((await leaveHousehold("h", actor, { rpc })).role).toBeNull()
    expect(rpc).toHaveBeenCalledExactlyOnceWith("leave_household", { p_household_id: "h", p_membership_id: "a", p_expected_role: "owner" })
  })
  it("checks own missing membership without granting access", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: { ...base, role: null, membership_id: null } })
    expect((await getOwnHouseholdAccess("h", "u", { rpc })).membershipId).toBeNull()
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_household_membership", { p_household_id: "h" })
  })
  it.each([null, [], {}, { ...base, role: "owner" }, { ...base, role: null, user_id: "v" }, { ...base, role: null, household_id: "other" }, { ...base, role: null, membership_id: "new" }, { ...base, role: null, changed_at: "invalid" }])("does not accept an invalid departure receipt %j", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data })
    await expect(leaveHousehold("h", actor, { rpc })).rejects.toThrow()
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it("rejects a transfer receipt for another successor", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: { ...base, role: "member", successor_membership_id: "b", successor_user_id: "wrong", successor_role: "owner" } })
    await expect(transferHouseholdOwnership("h", actor, successor, { rpc })).rejects.toThrow("could not be verified")
  })
  it("propagates denial and never retries", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "Transfer ownership before leaving" } })
    await expect(leaveHousehold("h", actor, { rpc })).rejects.toThrow("Transfer ownership")
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it("rejects empty IDs without a call", async () => {
    const rpc = vi.fn()
    await expect(leaveHousehold("", actor, { rpc })).rejects.toThrow("Missing")
    expect(rpc).not.toHaveBeenCalled()
  })
})
