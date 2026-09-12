import type { HouseholdRole } from "../households/householdPermissions"

export interface HouseholdDevice {
  id: string
  userId: string
  name: string
  accountLabel: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}
export interface DeviceDirectory {
  householdId: string
  userId: string
  role: HouseholdRole
  devices: HouseholdDevice[]
}
interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: { message: string } | null }>
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid device response")
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid device text")
  return value.trim()
}
function date(value: unknown): string {
  const result = text(value)
  if (Number.isNaN(Date.parse(result))) throw new Error("Invalid device date")
  return result
}
function optionalDate(value: unknown): string | null { return value === null ? null : date(value) }

export function parseDeviceDirectory(value: unknown, householdId: string, userId: string): DeviceDirectory {
  const data = record(value)
  if (data.household_id !== householdId || data.user_id !== userId ||
    (data.role !== "owner" && data.role !== "member") || !Array.isArray(data.devices)) {
    throw new Error("The account or household changed. Refresh before managing devices.")
  }
  const devices = data.devices.map((item) => {
    const d = record(item)
    return { id: text(d.id), userId: text(d.user_id), name: text(d.name), accountLabel: text(d.account_label),
      createdAt: date(d.created_at), lastSeenAt: optionalDate(d.last_seen_at), revokedAt: optionalDate(d.revoked_at) }
  })
  if (new Set(devices.map((d) => d.id)).size !== devices.length ||
    (data.role === "member" && devices.some((d) => d.userId !== userId))) throw new Error("Invalid device visibility")
  return { householdId, userId, role: data.role, devices }
}
async function call(name: string, parameters: Record<string, unknown>, options: Options) {
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, parameters)
  if (result.error) throw new Error(result.error.message)
  return result.data
}
export async function getHouseholdDevices(householdId: string, userId: string, options: Options = {}) {
  return parseDeviceDirectory(await call("get_household_devices", { p_household_id: text(householdId) }, options), householdId, userId)
}
export async function manageHouseholdDevice(householdId: string, deviceId: string, action: "rename" | "revoke", name: string | null = null, options: Options = {}): Promise<void> {
  const nextName = action === "rename" ? text(name) : null
  if (nextName && nextName.length > 120) throw new Error("Device name must contain 1 to 120 characters")
  const result = record(await call("manage_household_device", {
    p_household_id: text(householdId), p_device_id: text(deviceId), p_action: action, p_name: nextName,
  }, options))
  if (result.id !== deviceId || (action === "rename" && (result.name !== nextName || result.revoked_at !== null))) {
    throw new Error("Device change could not be confirmed")
  }
  if (action === "revoke") date(result.revoked_at)
}
