// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HouseholdDevicesView } from "./HouseholdDevicesView"
import { getHouseholdDevices, manageHouseholdDevice, type DeviceDirectory } from "../data/householdDevices"
vi.mock("../data/householdDevices", () => ({ getHouseholdDevices: vi.fn(), manageHouseholdDevice: vi.fn() }))
const read = vi.mocked(getHouseholdDevices)
const mutate = vi.mocked(manageHouseholdDevice)
const onRevoked = vi.fn()
const props = { householdId: "a", householdName: "Family cellar", userId: "self", role: "owner" as const, isOnline: true, currentDeviceId: "self-device", onRevoked }
let database: DeviceDirectory
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.resetAllMocks()
  database = { householdId: "a", userId: "self", role: "owner", devices: [
    { id: "self-device", userId: "self", name: "My phone", accountLabel: "Current Owner", createdAt: "2026-09-09T12:00:00Z", lastSeenAt: null, revokedAt: null },
    { id: "other-device", userId: "other", name: "Other tablet", accountLabel: "Alice", createdAt: "2026-09-09T12:00:00Z", lastSeenAt: "2026-09-09T13:00:00Z", revokedAt: null },
  ] }
  read.mockImplementation(async () => structuredClone(database))
  mutate.mockImplementation(async (_hh, id, action, name) => {
    database.devices = database.devices.map((device) => device.id !== id ? device : action === "revoke" ? { ...device, revokedAt: "2026-09-09T14:00:00Z" } : { ...device, name: name! })
  })
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
async function render(overrides: Partial<Parameters<typeof HouseholdDevicesView>[0]> = {}) {
  await act(async () => root.render(<HouseholdDevicesView {...props} {...overrides} />))
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === label)
  expect(found, label).toBeDefined(); return found!
}
async function click(label: string) { await act(async () => button(label).click()) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
describe("device management UI", () => {
  it("labels current browser, identity, contact semantics and safe scope", async () => {
    await render()
    expect(container.textContent).toContain("2 active registrations")
    expect(container.textContent).toContain("This browser")
    expect(container.textContent).toContain("These are not login sessions")
    expect(container.textContent).toContain("Last registration contact")
    expect(button("Revoke: Other tablet")).toBeDefined()
    expect(mutate).not.toHaveBeenCalled()
  })
  it("explains self-revocation and cancellation restores focus without a write", async () => {
    await render(); await click("Revoke: My phone")
    expect(container.textContent).toContain("This is your current browser")
    expect(container.textContent).toContain("including bottle changes still queued offline")
    expect(container.textContent).toContain("It does not sign anyone out")
    expect(document.activeElement?.getAttribute("role")).toBe("region")
    await click("Cancel")
    expect(document.activeElement).toBe(button("Revoke: My phone"))
    expect(mutate).not.toHaveBeenCalled()
  })
  it("revokes only the confirmed registration once and moves it into history", async () => {
    await render(); await click("Revoke: Other tablet")
    const confirm = button("Confirm: revoke registration")
    await act(async () => { confirm.click(); confirm.click() })
    expect(mutate).toHaveBeenCalledExactlyOnceWith("a", "other-device", "revoke", null)
    expect(container.textContent).toContain("1 active registration")
    expect(container.textContent).toContain("Show revoked registrations (1)")
    expect(container.querySelector('[aria-label="Revoke: Other tablet"]')).toBeNull()
    expect(onRevoked).toHaveBeenCalledWith("other-device")
    expect(document.activeElement).toBe(button("Refresh devices"))
  })
  it("renames the selected registration and displays server state", async () => {
    await render(); await click("Rename: My phone")
    const input = container.querySelector("input")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Travel phone")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("Save device name")
    expect(mutate).toHaveBeenCalledExactlyOnceWith("a", "self-device", "rename", "Travel phone")
    expect(button("Rename: Travel phone")).toBeDefined()
  })
  it("Members can manage their own registration but not others even with stale UI data", async () => {
    database.role = "member"
    await render({ role: "member" })
    expect(button("Rename: My phone")).toBeDefined()
    expect(container.querySelector('[aria-label="Revoke: Other tablet"]')).toBeNull()
  })
  it("discards identities and confirmation on offline transition and performs no offline RPC", async () => {
    await render({ isOnline: false }); expect(read).not.toHaveBeenCalled()
    await render(); await click("Revoke: My phone"); await render({ isOnline: false })
    expect(container.textContent).not.toContain("My phone")
    expect(container.querySelector('[role="region"]')).toBeNull()
    expect(container.textContent).toContain("Device changes are never queued offline")
    expect(mutate).not.toHaveBeenCalled()
  })
  it.each(["renamed", "revoked", "actor demoted"])("aborts if %s during review", async (change) => {
    await render(); await click("Revoke: Other tablet")
    if (change === "renamed") database.devices[1].name = "New name"
    if (change === "revoked") database.devices[1].revokedAt = "2026-09-09T14:00:00Z"
    if (change === "actor demoted") database.role = "member"
    await click("Confirm: revoke registration")
    expect(mutate).not.toHaveBeenCalled(); expect(container.textContent).toContain("Nothing was submitted")
  })
  it("reconciles an uncertain mutation by reading; never retries the write", async () => {
    mutate.mockImplementationOnce(async () => { database.devices[0].revokedAt = "2026-09-09T14:00:00Z"; throw new Error("Response lost") })
    await render(); await click("Revoke: My phone"); await click("Confirm: revoke registration")
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(onRevoked).toHaveBeenCalledWith("self-device")
    expect(container.textContent).toContain("could not be confirmed")
    expect(container.querySelector('[aria-label="Revoke: My phone"]')).toBeNull()
  })
  it("clears the directory when the reload fails, retaining a successful receipt", async () => {
    await render(); await click("Revoke: My phone")
    read.mockResolvedValueOnce(structuredClone(database)).mockRejectedValueOnce(new Error("Offline"))
    await click("Confirm: revoke registration")
    expect(container.textContent).toContain("registration revoked")
    expect(container.textContent).toContain("list could not be refreshed")
    expect(container.querySelector('[aria-label="Revoke: Other tablet"]')).toBeNull()
    await click("Refresh devices")
    expect(container.textContent).toContain("1 active registration")
  })
  it("ignores old household reads and never submits after switching during preflight", async () => {
    await render(); await click("Revoke: My phone")
    const old = structuredClone(database)
    const pending = deferred<DeviceDirectory>(); read.mockReturnValueOnce(pending.promise)
    await click("Confirm: revoke registration")
    database.devices = []; await render({ householdId: "b" })
    await act(async () => pending.resolve(old))
    expect(mutate).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain("My phone")
  })
  it("clears confirmation on a role change", async () => {
    await render(); await click("Revoke: Other tablet")
    database.role = "member"; await render({ role: "member" })
    expect(container.querySelector('[role="region"]')).toBeNull()
    expect(mutate).not.toHaveBeenCalled()
  })
})
