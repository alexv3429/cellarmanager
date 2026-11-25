import { describe, expect, it, vi } from "vitest"
import { createCurationClimates, listCurationClimates } from "./drinkingWindowFallbackAuthoring"

describe("shared climat authoring", () => {
  it("requires a confirmed reason before sending a batch", async () => {
    const rpc = vi.fn()
    await expect(createCurationClimates({ appellationId: "app", names: ["Les Charmes"],
      sourceUrl: "https://example.org", reason: "A sufficiently detailed reason", confirmed: false }, { rpc }))
      .rejects.toThrow("Confirm")
    expect(rpc).not.toHaveBeenCalled()
  })
  it("keeps the chosen parent, source and separate canonical names", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { created: [{ id: "one", canonical_name: "Les Charmes" }] }, error: null })
    const result = await createCurationClimates({ appellationId: "app", names: [" Les Charmes "],
      sourceUrl: "https://example.org", reason: "A sufficiently detailed reason", confirmed: true }, { rpc })
    expect(rpc).toHaveBeenCalledWith("create_drinking_window_curation_climates", expect.objectContaining({
      p_appellation_id: "app", p_names: ["Les Charmes"], p_source_url: "https://example.org", p_confirmed: true,
    }))
    expect(result).toEqual([{ id: "one", name: "Les Charmes" }])
  })
  it("lists names returned for one appellation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "one", canonical_name: "Les Charmes" }], error: null })
    await expect(listCurationClimates("app", { rpc })).resolves.toEqual([{ id: "one", name: "Les Charmes" }])
    expect(rpc).toHaveBeenCalledWith("list_drinking_window_curation_climates", { p_appellation_id: "app" })
  })
})
