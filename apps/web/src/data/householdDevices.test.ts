import { describe, expect, it, vi } from "vitest"
import { getHouseholdDevices, manageHouseholdDevice, parseDeviceDirectory } from "./householdDevices"
const device = { id: "device", user_id: "self", name: "Phone", account_label: "Alice", created_at: "2026-09-09T12:00:00Z", last_seen_at: null, revoked_at: null }
const response = { household_id: "household", user_id: "self", role: "owner", devices: [device] }
describe("household device boundary", () => {
  it("reads only the requested household with a verified actor", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: response, error: null })
    const data = await getHouseholdDevices("household", "self", { rpc })
    expect(rpc).toHaveBeenCalledWith("get_household_devices", { p_household_id: "household" })
    expect(data.devices[0]).toMatchObject({ name: "Phone", revokedAt: null, lastSeenAt: null })
  })
  it.each([{ household_id: "other" }, { user_id: "other" }, { role: "admin" }, { devices: null },
    { devices: [device, device] }, { devices: [{ ...device, revoked_at: "nonsense" }] },
    { role: "member", devices: [{ ...device, user_id: "another" }] },
  ])("rejects invalid or cross-account data: %j", (change) => {
    expect(() => parseDeviceDirectory({ ...response, ...change }, "household", "self")).toThrow()
  })
  it("checks mutation receipts and never retries a write", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "device", name: "Travel", revoked_at: null }, error: null })
    await manageHouseholdDevice("household", "device", "rename", " Travel ", { rpc })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("manage_household_device", { p_household_id: "household", p_device_id: "device", p_action: "rename", p_name: "Travel" })
    rpc.mockResolvedValue({ data: { id: "wrong" }, error: null })
    await expect(manageHouseholdDevice("household", "device", "revoke", null, { rpc })).rejects.toThrow("could not be confirmed")
    rpc.mockResolvedValue({ error: { message: "Denied" } })
    await expect(manageHouseholdDevice("household", "device", "revoke", null, { rpc })).rejects.toThrow("Denied")
    expect(rpc).toHaveBeenCalledTimes(3)
  })
  it("requires a dated revocation receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "device", revoked_at: null }, error: null })
    await expect(manageHouseholdDevice("household", "device", "revoke", null, { rpc })).rejects.toThrow()
    rpc.mockResolvedValue({ data: { id: "device", revoked_at: "2026-09-09T13:00:00Z" }, error: null })
    await expect(manageHouseholdDevice("household", "device", "revoke", null, { rpc })).resolves.toBeUndefined()
  })
  it.each(["", " ", "a".repeat(121)])("rejects invalid rename before submission", async (name) => {
    const rpc = vi.fn()
    await expect(manageHouseholdDevice("household", "device", "rename", name, { rpc })).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })
})
