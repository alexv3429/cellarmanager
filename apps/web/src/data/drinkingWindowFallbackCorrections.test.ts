import { describe, expect, it, vi } from "vitest"
import { narrowFallbackToAppellation } from "./drinkingWindowFallbackCorrections"

describe("scope correction", () => {
  it("passes the current version, group, appellation, hash and reason to the guarded action", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { group_id: "group", rows_changed: 2 }, error: null })
    await narrowFallbackToAppellation({ versionId: "draft", groupId: "group", appellationId: "app",
      expectedHash: "hash", reason: "The members all belong to the selected appellation." }, { rpc })
    expect(rpc).toHaveBeenCalledWith("narrow_drinking_window_region_group", {
      p_version_id: "draft", p_group_id: "group", p_appellation_id: "app", p_expected_hash: "hash",
      p_reason: "The members all belong to the selected appellation.", p_confirm: true,
    })
  })
  it("rejects a response for the wrong group", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { group_id: "different" }, error: null })
    await expect(narrowFallbackToAppellation({ versionId: "draft", groupId: "group", appellationId: "app",
      expectedHash: "hash", reason: "The members all belong to the selected appellation." }, { rpc }))
      .rejects.toThrow("Invalid scope correction result")
  })
})
