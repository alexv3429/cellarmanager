// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AccountView } from "./AccountView"
import { getAccountProfile, requestAccountPasswordReset, saveAccountDisplayName } from "../auth/accountProfile"

vi.mock("../auth/accountProfile", async (original) => ({
  ...await original<typeof import("../auth/accountProfile")>(),
  getAccountProfile: vi.fn(), requestAccountPasswordReset: vi.fn(), saveAccountDisplayName: vi.fn(),
}))
const fixture = { userId: "self", email: "alice@example.test", displayName: "Alice" }
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.resetAllMocks()
  vi.mocked(getAccountProfile).mockResolvedValue({ ...fixture })
  vi.mocked(saveAccountDisplayName).mockImplementation(async (_id, name) => ({ ...fixture, displayName: name.trim() }))
  vi.mocked(requestAccountPasswordReset).mockResolvedValue(fixture.email)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(userId = "self", isOnline = true) {
  await act(async () => root.render(<AccountView key={userId} userId={userId} isOnline={isOnline} />))
}
function button(label: string) {
  const element = [...container.querySelectorAll("button")].find((node) => node.textContent === label)
  expect(element, label).toBeDefined()
  return element!
}
async function click(label: string) { await act(async () => button(label).click()) }
async function name(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>("#account-name")!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("account settings", () => {
  it("shows own profile, readonly email, optional display name and separate password action", async () => {
    await render()
    expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.readOnly).toBe(true)
    expect(container.querySelector<HTMLInputElement>("#account-name")?.value).toBe("Alice")
    expect(button("Save display name").disabled).toBe(true)
    expect(container.textContent).toContain("across all your households")
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector("h1"))
  })
  it("saves a trimmed name and supports clearing it for email fallback", async () => {
    await render()
    await name("  Zoé  ")
    await click("Save display name")
    expect(saveAccountDisplayName).toHaveBeenCalledWith("self", "  Zoé  ", expect.any(Object))
    expect(container.textContent).toContain("Display name saved")
    expect(container.querySelector<HTMLInputElement>("#account-name")?.value).toBe("Zoé")
    await name("")
    await click("Save display name")
    expect(saveAccountDisplayName).toHaveBeenLastCalledWith("self", "", expect.any(Object))
  })
  it("requests a reset once, without collecting or changing a password in this screen", async () => {
    await render()
    await click("Send password reset email")
    expect(requestAccountPasswordReset).toHaveBeenCalledOnce()
    expect(button("Email requested").disabled).toBe(true)
    expect(container.textContent).toContain("alice@example.test. Check your inbox and Spam")
    expect(saveAccountDisplayName).not.toHaveBeenCalled()
  })
  it("blocks duplicate and overlapping submissions", async () => {
    const pending = deferred<Awaited<ReturnType<typeof saveAccountDisplayName>>>()
    vi.mocked(saveAccountDisplayName).mockReturnValue(pending.promise)
    await render()
    await name("New name")
    await act(async () => { button("Save display name").click(); container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    expect(saveAccountDisplayName).toHaveBeenCalledOnce()
    expect(button("Send password reset email").disabled).toBe(true)
    await act(async () => pending.resolve({ ...fixture, displayName: "New name" }))
  })
  it("offers explicit reload after an uncertain save, without retrying", async () => {
    vi.mocked(saveAccountDisplayName).mockRejectedValue(new Error("Could not confirm the saved name."))
    await render()
    await name("New name")
    await click("Save display name")
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not confirm")
    vi.mocked(getAccountProfile).mockResolvedValue({ ...fixture, displayName: "New name" })
    await click("Reload account")
    expect(container.querySelector<HTMLInputElement>("#account-name")?.value).toBe("New name")
    expect(saveAccountDisplayName).toHaveBeenCalledOnce()
  })
  it("keeps account changes unavailable offline, then reloads on reconnection", async () => {
    await render("self", false)
    expect(getAccountProfile).not.toHaveBeenCalled()
    expect(container.textContent).toContain("not queued offline")
    expect(container.querySelector("input")).toBeNull()
    await render()
    expect(getAccountProfile).toHaveBeenCalledOnce()
  })
  it("hides a previous account and ignores its delayed load on account switch", async () => {
    const pending = deferred<Awaited<ReturnType<typeof getAccountProfile>>>()
    vi.mocked(getAccountProfile).mockReturnValueOnce(pending.promise)
    await render()
    vi.mocked(getAccountProfile).mockResolvedValue({ userId: "other", email: "bob@example.test", displayName: "Bob" })
    await render("other")
    await act(async () => pending.resolve(fixture))
    expect(container.querySelector<HTMLInputElement>("#account-name")?.value).toBe("Bob")
    expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe("bob@example.test")
  })
  it("invalidates in-flight work on disconnect", async () => {
    const pending = deferred<string>()
    vi.mocked(requestAccountPasswordReset).mockReturnValue(pending.promise)
    await render()
    await click("Send password reset email")
    const options = vi.mocked(requestAccountPasswordReset).mock.calls[0][2]!
    await render("self", false)
    expect(options.isCurrent?.()).toBe(false)
    await act(async () => pending.resolve(fixture.email))
    expect(container.textContent).not.toContain("Password reset email requested for")
  })
})
