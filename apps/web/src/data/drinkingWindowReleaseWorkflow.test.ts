import { describe, expect, it, vi } from "vitest"
import { previewPublicationImpact } from "./drinkingWindowReleaseWorkflow"

describe("publication impact preview", () => {
  it("continues until the server finishes, and returns only aggregate results", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "job", error: null })
      .mockResolvedValueOnce({ data: { completed: false, wine_count: 40 }, error: null })
      .mockResolvedValueOnce({ data: { completed: true, content_sha256: "hash", wine_count: 82,
        matched_count: 12, changed_count: 5, unchanged_count: 3,
        private_preserved_count: 4, unresolved_count: 6 }, error: null })
    const onProgress = vi.fn()
    const result = await previewPublicationImpact("version", { rpc, onProgress })
    expect(rpc.mock.calls).toEqual([
      ["start_drinking_window_impact_preview", { p_version_id: "version" }],
      ["continue_drinking_window_impact_preview", { p_job_id: "job" }],
      ["continue_drinking_window_impact_preview", { p_job_id: "job" }],
    ])
    expect(result).toEqual({ contentSha256: "hash", wineCount: 82, matchedCount: 12,
      changedCount: 5, unchangedCount: 3, privatePreservedCount: 4, unresolvedCount: 6 })
    expect(onProgress.mock.calls).toEqual([[40], [82]])
  })

  it("does not hide a stale draft error from the server", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: "job", error: null })
      .mockResolvedValueOnce({ error: { message: "Draft changed during impact preview" } })
    await expect(previewPublicationImpact("version", { rpc })).rejects.toThrow("Draft changed")
  })

  it("rejects a malformed batch response", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: "job", error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
    await expect(previewPublicationImpact("version", { rpc })).rejects.toThrow("Invalid publication preview")
  })
})
