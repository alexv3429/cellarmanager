// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HouseholdMembersView } from "./HouseholdMembersView"
import { getHouseholdMembers, revokeHouseholdMember, updateHouseholdMemberRole, type HouseholdMember } from "../data/householdMembers"

vi.mock("../data/householdMembers", async (original) => ({
  ...await original<typeof import("../data/householdMembers")>(),
  getHouseholdMembers: vi.fn(), revokeHouseholdMember: vi.fn(), updateHouseholdMemberRole: vi.fn(),
}))
const getMembers = vi.mocked(getHouseholdMembers)
const updateRole = vi.mocked(updateHouseholdMemberRole)
const revoke = vi.mocked(revokeHouseholdMember)
const fixtures: HouseholdMember[] = [
  { id: "membership-self", userId: "self", email: "owner@example.test", displayName: "Current Owner", role: "owner", joinedAt: "2026-09-01T10:00:00Z", isCurrentUser: true },
  { id: "membership-alice", userId: "alice", email: "alice@example.test", displayName: "Alice", role: "member", joinedAt: "2026-09-02T10:00:00Z", isCurrentUser: false },
  { id: "membership-bob", userId: "bob", email: "bob@example.test", displayName: "Bob", role: "owner", joinedAt: "2026-09-03T10:00:00Z", isCurrentUser: false },
]
let database: HouseholdMember[]
let root: Root
let container: HTMLDivElement
const onInvite = vi.fn()
const props = { householdId: "household-a", householdName: "Family cellar", userId: "self", role: "owner" as const, isOnline: true, onInvite }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.resetAllMocks()
  database = structuredClone(fixtures)
  getMembers.mockImplementation(async () => structuredClone(database))
  updateRole.mockImplementation(async (_household, membershipId, role) => { database = database.map((member) => member.id === membershipId ? { ...member, role } : member) })
  revoke.mockImplementation(async (_household, membershipId) => { database = database.filter((member) => member.id !== membershipId) })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(overrides: Partial<Parameters<typeof HouseholdMembersView>[0]> = {}) {
  await act(async () => root.render(<HouseholdMembersView {...props} {...overrides} />))
}
function findButton(label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") ?? button.textContent) === label)
  expect(element, label).toBeDefined()
  return element!
}
async function click(label: string) { await act(async () => findButton(label).click()) }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("household members UI", () => {
  it("shows safe identities, roles, own membership, and invitation entry", async () => {
    await render()
    expect(container.textContent).toContain("3 people with access")
    expect(container.textContent).toContain("alice@example.test")
    expect(container.textContent).toContain("Your own Owner role cannot be changed here")
    expect(container.querySelector('[aria-label="Remove access: Current Owner"]')).toBeNull()
    await click("Invite member")
    expect(onInvite).toHaveBeenCalledOnce()
    expect(updateRole).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })

  it.each(["cancel", "escape"])("%s keeps a role unchanged and returns focus", async (method) => {
    await render()
    await click("Make Owner: Alice")
    expect(container.textContent).toContain("including yours")
    expect(document.activeElement?.getAttribute("role")).toBe("region")
    if (method === "cancel") await click("Cancel")
    else await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(container.querySelector('[role="region"]')).toBeNull()
    expect(document.activeElement).toBe(findButton("Make Owner: Alice"))
    expect(updateRole).not.toHaveBeenCalled()
  })

  it("promotes only the confirmed member once, reloads actual state, and restores focus", async () => {
    await render()
    await click("Make Owner: Alice")
    const confirmButton = findButton("Confirm: make owner")
    await act(async () => { confirmButton.click(); confirmButton.click() })
    expect(updateRole).toHaveBeenCalledExactlyOnceWith("household-a", "membership-alice", "owner")
    expect(getMembers).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain("Alice is now an Owner")
    expect(findButton("Make Member: Alice")).toBeDefined()
    expect(document.activeElement).toBe(findButton("Refresh members"))
  })

  it("demotes another Owner with the queued-operation warning", async () => {
    await render()
    await click("Make Member: Bob")
    expect(container.textContent).toContain("Stock changes still queued")
    await click("Confirm: make member")
    expect(updateRole).toHaveBeenCalledExactlyOnceWith("household-a", "membership-bob", "member")
    expect(container.textContent).toContain("Bob is now a Member with read-only cellar access")
  })

  it("explains irreversible private-data removal and preserves stock/account semantics", async () => {
    await render()
    await click("Remove access: Alice")
    expect(container.textContent).toContain("private notes and preferences for this household are deleted")
    expect(container.textContent).toContain("may remain readable until those devices reconnect")
    expect(revoke).not.toHaveBeenCalled()
    await click("Confirm: remove access")
    expect(revoke).toHaveBeenCalledExactlyOnceWith("household-a", "membership-alice")
    expect(container.textContent).toContain("2 people with access")
    expect(container.textContent).toContain("Their account and your cellar stock remain unchanged")
    expect(container.querySelector('[aria-label="Make Owner: Alice"]')).toBeNull()
  })

  it("gives Members a read-only directory, never management or invitation controls", async () => {
    database[0].role = "member"
    await render({ role: "member" })
    expect(container.textContent).toContain("Alice")
    expect(container.textContent).toContain("Only Owners can invite")
    expect([...container.querySelectorAll("button")].map((node) => node.textContent)).toEqual(["Refresh members"])
    expect(updateRole).not.toHaveBeenCalled()
  })

  it("fails closed when the live actor is Member despite stale synchronized Owner role", async () => {
    database[0].role = "member"
    await render()
    expect(container.querySelector('[aria-label="Make Owner: Alice"]')).toBeNull()
    expect(container.textContent).not.toContain("Invite member")
  })

  it("loads no directory offline and clears identities and confirmations on disconnection", async () => {
    await render({ isOnline: false })
    expect(getMembers).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Membership changes are never queued offline")
    await render()
    await click("Remove access: Alice")
    await render({ isOnline: false })
    expect(container.textContent).not.toContain("alice@example.test")
    expect(container.querySelector('[role="region"]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    await render()
    expect(container.textContent).toContain("alice@example.test")
  })

  it.each(["target role", "target removed", "actor role"])("aborts when %s changes before confirmation is submitted", async (change) => {
    await render()
    await click("Remove access: Alice")
    if (change === "target role") database[1].role = "owner"
    if (change === "target removed") database = database.filter((member) => member.userId !== "alice")
    if (change === "actor role") database[0].role = "member"
    await click("Confirm: remove access")
    expect(revoke).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Nothing was submitted")
  })

  it("does not retry a mutation whose response is lost; reads the changed server state", async () => {
    updateRole.mockImplementationOnce(async () => { database[1].role = "owner"; throw new Error("Connection lost") })
    await render()
    await click("Make Owner: Alice")
    await click("Confirm: make owner")
    expect(updateRole).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("change could not be confirmed")
    expect(findButton("Make Member: Alice")).toBeDefined()
    expect(container.textContent).not.toContain("Alice is now an Owner")
  })

  it("distinguishes successful writes from a failed reload and blocks further actions", async () => {
    await render()
    await click("Remove access: Alice")
    getMembers.mockResolvedValueOnce(structuredClone(database)).mockRejectedValueOnce(new Error("offline"))
    await click("Confirm: remove access")
    expect(container.textContent).toContain("Access removed for Alice")
    expect(container.textContent).toContain("current list could not be refreshed")
    expect(container.querySelector('[aria-label="Remove access: Bob"]')).toBeNull()
    await click("Refresh members")
    expect(container.textContent).toContain("2 people with access")
  })

  it("clears the directory on server denial and offers read-only retry", async () => {
    await render()
    getMembers.mockRejectedValueOnce(new Error("Not a household member"))
    await click("Refresh members")
    expect(container.textContent).toContain("Not a household member")
    expect(container.textContent).not.toContain("alice@example.test")
    expect(container.querySelector('[aria-label="Remove access: Bob"]')).toBeNull()
    await click("Refresh members")
    expect(container.textContent).toContain("alice@example.test")
  })

  it("ignores an old household's delayed directory response", async () => {
    const pending = deferred<HouseholdMember[]>()
    getMembers.mockReturnValueOnce(pending.promise)
    await render()
    database = [{ ...fixtures[0], email: "new@example.test", displayName: "New household" }]
    await render({ householdId: "household-b" })
    await act(async () => pending.resolve(structuredClone(fixtures)))
    expect(container.textContent).toContain("New household")
    expect(container.textContent).not.toContain("alice@example.test")
  })

  it("never submits an old confirmation after switching household during the preflight", async () => {
    await render()
    await click("Remove access: Alice")
    const pending = deferred<HouseholdMember[]>()
    getMembers.mockReturnValueOnce(pending.promise)
    await click("Confirm: remove access")
    await render({ householdId: "household-b" })
    await act(async () => pending.resolve(structuredClone(fixtures)))
    expect(revoke).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain("Access removed")
  })

  it("rejects a response belonging to another authenticated account", async () => {
    database[0].userId = "unexpected-user"
    await render()
    expect(container.textContent).toContain("The account changed")
    expect(container.textContent).not.toContain("alice@example.test")
    expect(container.querySelector('[aria-label="Remove access: Bob"]')).toBeNull()
  })

  it("clears an open confirmation immediately when the synchronized role changes", async () => {
    await render()
    await click("Remove access: Alice")
    database[0].role = "member"
    await render({ role: "member" })
    expect(container.querySelector('[role="region"]')).toBeNull()
    expect(container.querySelector('[aria-label="Remove access: Alice"]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
  })

  it("ignores an old mutation response after household switching without refreshing the old directory", async () => {
    await render()
    await click("Make Owner: Alice")
    const pending = deferred<void>()
    updateRole.mockReturnValueOnce(pending.promise)
    await click("Confirm: make owner")
    await render({ householdId: "household-b" })
    const reads = getMembers.mock.calls.length
    await act(async () => pending.resolve())
    expect(updateRole).toHaveBeenCalledExactlyOnceWith("household-a", "membership-alice", "owner")
    expect(getMembers).toHaveBeenCalledTimes(reads)
    expect(container.textContent).not.toContain("Alice is now an Owner")
  })
})
