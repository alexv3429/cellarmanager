// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useRegisteredDevices, type RegisteredDevicesState } from "./useRegisteredDevices"
import { DEVICE_IDS_STORAGE_KEY } from "./deviceIdentity"
const state = vi.hoisted(() => ({ devices: [] as { id: string; household_id: string; user_id: string; name: string; revoked_at: string | null }[], memberships: [{ household_id: "a" }, { household_id: "b" }], rpc: vi.fn() }))
vi.mock("@powersync/react", () => ({ useQuery: (sql: string) => ({ data: sql.includes("from devices") ? state.devices : state.memberships, error: null, isLoading: false }) }))
vi.mock("../data/supabase", () => ({ supabase: { rpc: state.rpc } }))
let root: Root
let container: HTMLDivElement
let result: RegisteredDevicesState
function Probe() { result = useRegisteredDevices("self", true); return null }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  state.rpc.mockReset().mockResolvedValue({ error: null })
  state.devices = ["a", "b"].map((id) => ({ id: `device-${id}`, household_id: id, user_id: "self", name: "Browser", revoked_at: null }))
  localStorage.setItem(DEVICE_IDS_STORAGE_KEY, JSON.stringify({ a: "device-a", b: "device-b" }))
  container = document.createElement("div"); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); localStorage.clear(); vi.unstubAllGlobals() })
async function render() { await act(async () => root.render(<Probe />)) }
it("recognizes revoked registrations without rotating IDs or blocking another household", async () => {
  await render()
  state.devices = state.devices.map((d) => d.household_id === "a" ? { ...d, revoked_at: "2026-09-09T13:00:00Z" } : d)
  await render()
  expect(result.deviceIdByHousehold).toEqual({ b: "device-b" })
  expect(result.revokedHouseholdIds).toEqual(["a"])
  await act(async () => result.retryRegistration())
  expect(state.rpc).not.toHaveBeenCalled()
  expect(JSON.parse(localStorage.getItem(DEVICE_IDS_STORAGE_KEY)!)).toEqual({ a: "device-a", b: "device-b" })
})
it("immediately disables a revoked current registration before sync catches up", async () => {
  await render()
  await act(async () => result.markRevoked("device-a"))
  expect(result.deviceIdByHousehold).toEqual({ b: "device-b" })
  expect(result.revokedHouseholdIds).toEqual(["a"])
  await act(async () => window.dispatchEvent(new Event("online")))
  expect(state.rpc).not.toHaveBeenCalled()
})
it("handles a server revocation rejection without automatic retry or new identity", async () => {
  state.devices = state.devices.filter((d) => d.household_id !== "a")
  state.rpc.mockResolvedValue({ error: { code: "55000", message: "Device registration was revoked" } })
  await render()
  expect(result.revokedHouseholdIds).toEqual(["a"])
  expect(result.error).toBeNull()
  await act(async () => result.retryRegistration())
  expect(state.rpc).toHaveBeenCalledTimes(1)
  expect(state.rpc).toHaveBeenCalledWith("register_device", expect.objectContaining({ p_device_id: "device-a", p_household_id: "a" }))
})
