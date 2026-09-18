// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ResetPasswordForm } from "./ResetPasswordForm"
import { supabase } from "../data/supabase"
import { PASSWORD_RECOVERY_STORAGE_KEY } from "../auth/authEmailFlow"

vi.mock("../data/supabase", () => ({ supabase: { auth: { updateUser: vi.fn() } } }))
const update = vi.mocked(supabase.auth.updateUser)
const complete = vi.fn()
let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.resetAllMocks()
  sessionStorage.setItem(PASSWORD_RECOVERY_STORAGE_KEY, "true")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<ResetPasswordForm onComplete={complete} />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})
async function fill(password: string, confirmation: string) {
  await act(async () => {
    container.querySelectorAll("input").forEach((input, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, index === 0 ? password : confirmation)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  })
}
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }

describe("email recovery password form", () => {
  it.each([["short", "short"], ["valid-secret", "different-secret"]])("rejects invalid or mismatched passwords before Auth", async (password, confirmation) => {
    await fill(password, confirmation)
    await submit()
    expect(update).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })
  it("updates only the authenticated password, clears secrets and lets the user continue", async () => {
    update.mockResolvedValue({ data: { user: { id: "self", email: "self@example.test", user_metadata: {}, app_metadata: {}, aud: "authenticated", created_at: "2026-09-01" } }, error: null })
    await fill("new-local-secret", "new-local-secret")
    await submit()
    expect(update).toHaveBeenCalledExactlyOnceWith({ password: "new-local-secret" })
    expect(container.querySelector("input")).toBeNull()
    expect(sessionStorage.getItem(PASSWORD_RECOVERY_STORAGE_KEY)).toBeNull()
    expect(container.textContent).toContain("Your password has been updated")
    await act(async () => container.querySelector("button")!.click())
    expect(complete).toHaveBeenCalledOnce()
  })
  it("retains the recovery flow when Auth rejects the update", async () => {
    update.mockRejectedValue(new Error("Session expired. Request a new reset link."))
    await fill("new-local-secret", "new-local-secret")
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Session expired")
    expect(sessionStorage.getItem(PASSWORD_RECOVERY_STORAGE_KEY)).toBe("true")
    expect(complete).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledOnce()
  })
})
