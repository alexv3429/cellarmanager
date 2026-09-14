// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HouseholdLifecycle } from "./HouseholdLifecycle"
import { getHouseholdMembers, type HouseholdMember } from "../data/householdMembers"
import { getOwnHouseholdAccess, leaveHousehold, transferHouseholdOwnership } from "../data/householdLifecycle"

vi.mock("../data/householdMembers", async (original) => ({ ...await original<typeof import("../data/householdMembers")>(), getHouseholdMembers: vi.fn() }))
vi.mock("../data/householdLifecycle", () => ({ getOwnHouseholdAccess: vi.fn(), leaveHousehold: vi.fn(), transferHouseholdOwnership: vi.fn() }))
const self: HouseholdMember = { id: "a", userId: "u", email: "owner@example.test", displayName: "Owner", role: "owner", joinedAt: "2026-09-13", isCurrentUser: true }
const other: HouseholdMember = { ...self, id: "b", userId: "v", email: "member@example.test", displayName: "Alice", role: "member", isCurrentUser: false }
const receipt = { householdId: "h", userId: "u", membershipId: "a", role: "member" as const }
const onAccessChanged = vi.fn()
let root: Root, container: HTMLDivElement
const props = { householdId: "h", householdName: "Test cellar", self, members: [self, other], disabled: false, onAccessChanged }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.resetAllMocks()
  vi.mocked(getHouseholdMembers).mockResolvedValue([self, other])
  vi.mocked(transferHouseholdOwnership).mockResolvedValue(receipt)
  vi.mocked(leaveHousehold).mockResolvedValue({ ...receipt, role: null })
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
async function render(overrides: Partial<typeof props> = {}) { await act(async () => root.render(<HouseholdLifecycle {...props} {...overrides} />)) }
function button(text: string) { const found = [...container.querySelectorAll("button")].find((el) => el.textContent === text); expect(found, text).toBeDefined(); return found! }
async function click(text: string) { await act(async () => button(text).click()) }
async function choose() {
  await act(async () => { const select = container.querySelector("select")!; select.value = "b"; select.dispatchEvent(new Event("change", { bubbles: true })) })
  await click("Review ownership transfer")
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
describe("own household lifecycle", () => {
  it("blocks the last Owner from leaving and explains how to transfer", async () => {
    await render()
    expect(button("Review leaving household").disabled).toBe(true)
    expect(container.textContent).toContain("only Owner")
    expect(button("Review ownership transfer").disabled).toBe(true)
    await render({ members: [self] })
    expect(container.textContent).toContain("Invite someone first")
    expect(container.querySelector("select")).toBeNull()
  })
  it.each(["Cancel", "Escape"])("%s changes nothing and restores focus", async (method) => {
    await render(); await choose()
    expect(document.activeElement?.getAttribute("role")).toBe("region")
    expect(container.textContent).toContain("read-only Member")
    expect(container.textContent).toContain("member@example.test")
    if (method === "Cancel") await click("Cancel")
    else await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(document.activeElement).toBe(button("Review ownership transfer"))
    expect(transferHouseholdOwnership).not.toHaveBeenCalled()
  })
  it("transfers once with a fresh directory and reports reduced access immediately", async () => {
    await render(); await choose()
    const confirm = button("Confirm: transfer ownership")
    await act(async () => { confirm.click(); confirm.click() })
    expect(transferHouseholdOwnership).toHaveBeenCalledExactlyOnceWith("h", self, other)
    expect(onAccessChanged).toHaveBeenCalledExactlyOnceWith(receipt)
  })
  it("lets a Member leave, with an explicit private-data warning", async () => {
    const member = { ...self, role: "member" as const }
    vi.mocked(getHouseholdMembers).mockResolvedValue([member, { ...other, role: "owner" }])
    await render({ self: member, members: [member, { ...other, role: "owner" }] })
    expect(container.querySelector("select")).toBeNull()
    await click("Review leaving household")
    expect(container.textContent).toContain("private notes and preferences for this household will be deleted")
    expect(container.textContent).toContain("never transferred to another user")
    expect(leaveHousehold).not.toHaveBeenCalled()
    await click("Confirm: leave household")
    expect(leaveHousehold).toHaveBeenCalledExactlyOnceWith("h", member)
    expect(onAccessChanged).toHaveBeenCalledExactlyOnceWith({ ...receipt, role: null })
  })
  it("lets an Owner leave when another Owner remains", async () => {
    vi.mocked(getHouseholdMembers).mockResolvedValue([self, { ...other, role: "owner" }])
    await render({ members: [self, { ...other, role: "owner" }] })
    await click("Review leaving household"); await click("Confirm: leave household")
    expect(leaveHousehold).toHaveBeenCalledOnce()
  })
  it.each(["actor", "successor", "removed", "rejoined"])("aborts transfer with stale %s", async (change) => {
    await render(); await choose()
    vi.mocked(getHouseholdMembers).mockResolvedValue([
      { ...self, ...(change === "actor" ? { role: "member" as const } : {}), ...(change === "rejoined" ? { id: "new" } : {}) },
      ...(change === "removed" ? [] : [{ ...other, ...(change === "successor" ? { role: "owner" as const } : {}) }]),
    ])
    await click("Confirm: transfer ownership")
    expect(transferHouseholdOwnership).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Nothing was submitted")
  })
  it("reconciles a lost transfer response without resubmitting", async () => {
    vi.mocked(transferHouseholdOwnership).mockRejectedValue(new Error("Response lost"))
    vi.mocked(getOwnHouseholdAccess).mockResolvedValue(receipt)
    await render(); await choose(); await click("Confirm: transfer ownership")
    expect(transferHouseholdOwnership).toHaveBeenCalledOnce()
    expect(onAccessChanged).toHaveBeenCalledExactlyOnceWith(receipt)
  })
  it("offers only a read-only check when the result remains uncertain", async () => {
    vi.mocked(transferHouseholdOwnership).mockRejectedValue(new Error("Response lost"))
    vi.mocked(getOwnHouseholdAccess).mockRejectedValue(new Error("Offline"))
    await render(); await choose(); await click("Confirm: transfer ownership")
    expect(container.textContent).toContain("may have completed")
    expect(container.querySelector("select")).toBeNull()
    await click("Check my current access")
    expect(getOwnHouseholdAccess).toHaveBeenCalledTimes(2)
    expect(transferHouseholdOwnership).toHaveBeenCalledOnce()
  })
  it("does not submit a preflight from an unmounted household/account/offline view", async () => {
    const pending = deferred<HouseholdMember[]>()
    vi.mocked(getHouseholdMembers).mockReturnValue(pending.promise)
    await render(); await choose(); await click("Confirm: transfer ownership")
    await act(async () => root.render(<p>Different workspace</p>))
    await act(async () => pending.resolve([self, other]))
    expect(transferHouseholdOwnership).not.toHaveBeenCalled()
    expect(onAccessChanged).not.toHaveBeenCalled()
  })
  it("ignores a late mutation response after the workspace is gone", async () => {
    const pending = deferred<typeof receipt>()
    vi.mocked(transferHouseholdOwnership).mockReturnValue(pending.promise)
    await render(); await choose(); await click("Confirm: transfer ownership")
    await act(async () => root.render(<p>Different workspace</p>))
    await act(async () => pending.resolve(receipt))
    expect(onAccessChanged).not.toHaveBeenCalled()
  })
})
