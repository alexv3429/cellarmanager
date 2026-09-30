import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { lookupBarcodeProduct } from "./wineBarcodes"

vi.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({
      data: { session: { access_token: "test-session" } }, error: null,
    }) },
  },
}))

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("online barcode lookup response", () => {
  it("treats a confirmed absent product as missing, not unavailable", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ product: null }))
    await expect(lookupBarcodeProduct("08053853110343")).resolves.toBeNull()
  })

  it("preserves a safe service failure reason for the UI", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: "not_configured" }, { status: 503 }))
    await expect(lookupBarcodeProduct("08053853110343")).rejects.toThrow("barcode_not_configured")
  })

  it("distinguishes a browser network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(lookupBarcodeProduct("08053853110343")).rejects.toThrow("barcode_network_error")
  })
})
