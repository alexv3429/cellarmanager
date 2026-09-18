import type { User } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getAccountProfile, normalizeDisplayName, requestAccountPasswordReset, saveAccountDisplayName } from "./accountProfile"

const user = (metadata: Record<string, unknown> = {}): User => ({
  id: "self", email: "self@example.test", user_metadata: metadata, app_metadata: {}, aud: "authenticated", created_at: "2026-09-01",
})
const auth = { getUser: vi.fn(), updateUser: vi.fn(), resetPasswordForEmail: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  auth.getUser.mockResolvedValue({ data: { user: user({ full_name: "Alice", role: "owner" }) }, error: null })
  auth.updateUser.mockImplementation(async (attributes) => ({ data: { user: user(attributes.data) }, error: null }))
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
})

describe("own account profile", () => {
  it("uses a verified Auth user, not cached session or editable security metadata", async () => {
    expect(await getAccountProfile("self", { auth })).toEqual({ userId: "self", email: "self@example.test", displayName: "Alice" })
    expect(auth.getUser).toHaveBeenCalledOnce()
  })
  it.each([
    [{ name: "Legacy" }, "Legacy"], [{ full_name: "", name: "Legacy" }, ""],
    [{ full_name: { unsafe: true } }, ""], [{ full_name: "  Zoé  " }, "Zoé"],
  ])("handles existing metadata %j", async (metadata, expected) => {
    auth.getUser.mockResolvedValue({ data: { user: user(metadata) }, error: null })
    expect((await getAccountProfile("self", { auth })).displayName).toBe(expected)
  })
  it.each(["  Zoé 🍷  ", ""]) ("saves only full_name, including an explicit blank: %s", async (name) => {
    expect((await saveAccountDisplayName("self", name, { auth })).displayName).toBe(name.trim())
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ data: { full_name: name.trim() } })
    expect(auth.getUser).toHaveBeenCalledBefore(auth.updateUser)
  })
  it.each(["x".repeat(81), "Alice\u0000", "Alice\u202eOwner"]) ("rejects invalid names", async (name) => {
    expect(() => normalizeDisplayName(name)).toThrow("80 characters")
    await expect(saveAccountDisplayName("self", name, { auth })).rejects.toThrow()
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it.each(["save", "email"])("fails closed when verified identity differs: %s", async (action) => {
    const promise = action === "save" ? saveAccountDisplayName("other", "Name", { auth }) : requestAccountPasswordReset("other", "https://cellar.example", { auth })
    await expect(promise).rejects.toThrow("verify this account")
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
  it.each(["save", "email"])("does not start a mutation after navigation/account change: %s", async (action) => {
    const options = { auth, isCurrent: () => false }
    const promise = action === "save" ? saveAccountDisplayName("self", "Name", options) : requestAccountPasswordReset("self", "https://cellar.example", options)
    await expect(promise).rejects.toThrow("verify this account")
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
  it("reports an uncertain name save without automatically retrying", async () => {
    auth.updateUser.mockResolvedValue({ data: { user: null }, error: { message: "internal detail" } })
    await expect(saveAccountDisplayName("self", "Name", { auth })).rejects.toThrow("Reload your account")
    expect(auth.updateUser).toHaveBeenCalledOnce()
  })
  it("addresses recovery to the freshly verified email and a secure redirect", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { ...user(), email: "updated@example.test" } }, error: null })
    expect(await requestAccountPasswordReset("self", "http://preview.example/path", { auth })).toBe("updated@example.test")
    expect(auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith("updated@example.test", { redirectTo: "https://preview.example" })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it("handles expired sessions without sending email", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } })
    await expect(requestAccountPasswordReset("self", "https://cellar.example", { auth })).rejects.toThrow("sign in again")
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
  it("does not automatically retry rate-limited email requests", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "limit reached" } })
    await expect(requestAccountPasswordReset("self", "https://cellar.example", { auth })).rejects.toThrow("rate-limited")
    expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce()
  })
})
