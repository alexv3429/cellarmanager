import { afterEach, beforeEach, expect, it, vi } from "vitest"

const loadApplication = vi.fn()

beforeEach(() => {
  vi.resetModules()
  loadApplication.mockClear()
  vi.doMock("./main", () => {
    loadApplication()
    return {}
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock("./main")
})

it("redirects HTTP invitations without loading authentication or local cellar data", async () => {
  const replace = vi.fn()
  const path = `/invite#token=${"a".repeat(64)}`
  vi.stubGlobal("window", { location: { href: `http://preview.trycloudflare.com${path}`, replace } })

  await import("./bootstrap")

  expect(replace).toHaveBeenCalledWith(`https://preview.trycloudflare.com${path}`)
  expect(loadApplication).not.toHaveBeenCalled()
})

it.each(["https://preview.trycloudflare.com/invite", "http://localhost:8796/"])(
  "loads the application without redirecting at %s", async (href) => {
    const replace = vi.fn()
    vi.stubGlobal("window", { location: { href, replace } })

    await import("./bootstrap")

    await vi.waitFor(() => expect(loadApplication).toHaveBeenCalledOnce())
    expect(replace).not.toHaveBeenCalled()
  },
)
