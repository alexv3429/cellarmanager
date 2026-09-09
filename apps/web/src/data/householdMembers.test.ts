import { describe, expect, it, vi } from "vitest"
import { getHouseholdMembers, householdMemberLabel, parseHouseholdMembers, revokeHouseholdMember, updateHouseholdMemberRole } from "./householdMembers"

const row = {
  membership_id: "membership-owner", member_user_id: "user-owner", member_email: "owner@example.test",
  member_display_name: "Owner Name", member_role: "owner", member_created_at: "2026-09-01T10:00:00Z", is_current_user: true,
}

describe("household member RPC boundary", () => {
  it("parses only safe collaborator identity, role, and join date", () => {
    expect(parseHouseholdMembers([{ ...row, raw_user_meta_data: { ignored: true } }])).toEqual([{
      id: "membership-owner", userId: "user-owner", email: "owner@example.test", displayName: "Owner Name",
      role: "owner", joinedAt: "2026-09-01T10:00:00Z", isCurrentUser: true,
    }])
  })

  it("provides a readable fallback without inventing an email", () => {
    const member = parseHouseholdMembers([{ ...row, member_email: null, member_display_name: null }])[0]
    expect(householdMemberLabel(member)).toBe("Account user-own")
    expect(householdMemberLabel({ ...member, email: "owner@example.test" })).toBe("owner@example.test")
  })

  it.each([
    null, [], [{}], [null], [{ ...row, member_role: "admin" }], [{ ...row, is_current_user: "false" }],
    [{ ...row, member_created_at: "not a date" }], [{ ...row, member_email: { html: true } }],
    [{ ...row, is_current_user: false }], [row, { ...row }],
    [row, { ...row, membership_id: "other", is_current_user: false }],
  ])("fails closed on malformed or inconsistent directory response %j", (value) => {
    expect(() => parseHouseholdMembers(value)).toThrow()
  })

  it("lists only the explicitly selected household through its narrow RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null })
    expect(await getHouseholdMembers("household-a", { rpc })).toHaveLength(1)
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_household_members", { p_household_id: "household-a" })
  })

  it.each(["owner", "member"] as const)("submits %s with membership ID, never account email or client authority", async (nextRole) => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ membership_id: "membership-target", member_user_id: "target",
      previous_role: "member", member_role: nextRole, changed_at: "2026-09-09T10:00:00Z" }], error: null })
    await updateHouseholdMemberRole("household-a", "membership-target", nextRole, { rpc })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_household_member_role", {
      p_household_id: "household-a", p_membership_id: "membership-target", p_role: nextRole,
    })
  })

  it("revokes only the explicitly selected membership and checks its receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ membership_id: "membership-target", member_user_id: "target",
      former_role: "member", revoked_at: "2026-09-09T10:00:00Z" }], error: null })
    await revokeHouseholdMember("household-a", "membership-target", { rpc })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("revoke_household_member", { p_household_id: "household-a", p_membership_id: "membership-target" })
  })

  it("propagates server rejection without retry or a success result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "A household must retain at least one owner" } })
    await expect(updateHouseholdMemberRole("household-a", "target", "member", { rpc })).rejects.toThrow("retain at least one owner")
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it.each([[], null, [{ membership_id: "wrong" }], [{ membership_id: "target", member_user_id: "user", former_role: "member", revoked_at: "invalid" }]])("does not confirm an invalid removal receipt %j", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null })
    await expect(revokeHouseholdMember("household-a", "target", { rpc })).rejects.toThrow()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("does not confirm a role receipt for a different role", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ membership_id: "target", member_user_id: "user", previous_role: "member", member_role: "member", changed_at: "2026-09-09T10:00:00Z" }], error: null })
    await expect(updateHouseholdMemberRole("household-a", "target", "owner", { rpc })).rejects.toThrow("could not be confirmed")
  })

  it("rejects empty scope without issuing a request", async () => {
    const rpc = vi.fn()
    await expect(getHouseholdMembers(" ", { rpc })).rejects.toThrow("Household ID")
    await expect(revokeHouseholdMember("household-a", " ", { rpc })).rejects.toThrow("Membership ID")
    expect(rpc).not.toHaveBeenCalled()
  })
})
