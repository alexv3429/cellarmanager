import { describe, expect, it, vi } from "vitest"

import {
  getHouseholdAgeingGroupReview,
  manageHouseholdAgeingGroupChoice,
} from "./householdAgeingGroups"

const response = {
  wine_id: "wine-1",
  context_status: "ready",
  source_fingerprint: "fingerprint",
  versions: [{
    version_id: "version-1", version_number: 1, version_status: "draft",
    groups: [{
      group_id: "group-1", scope: "region", group_key: "long-ageing",
      definition: "Reviewed long-ageing wines",
      first_trial_year: 2025, best_start_year: 2028, best_end_year: 2035,
    }],
    choices: [{ scope: "region", group_id: null, choice_revision: "revision-1" }],
  }],
}

describe("household ageing-group review", () => {
  it("parses scoped, versioned choices without treating them as shared membership", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: response, error: null })
    const review = await getHouseholdAgeingGroupReview("wine-1", { rpc })
    expect(review).toMatchObject({
      wineId: "wine-1", contextStatus: "ready", sourceFingerprint: "fingerprint",
      versions: [{ versionStatus: "draft", groups: [{ groupId: "group-1", scope: "region" }],
        choices: [{ groupId: null, choiceRevision: "revision-1" }] }],
    })
    expect(rpc).toHaveBeenCalledWith("get_household_wine_ageing_choices", { p_wine_id: "wine-1" })
  })

  it("hides only an RPC missing from an older database", async () => {
    await expect(getHouseholdAgeingGroupReview("wine-1", {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing RPC" } }),
    })).resolves.toBeNull()
    await expect(getHouseholdAgeingGroupReview("wine-1", {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "Not owner" } }),
    })).rejects.toThrow("Not owner")
  })

  it("rejects a response for another wine and inconsistent dates", async () => {
    await expect(getHouseholdAgeingGroupReview("wine-1", {
      rpc: vi.fn().mockResolvedValue({ data: { ...response, wine_id: "wine-2" }, error: null }),
    })).rejects.toThrow("another wine")
    await expect(getHouseholdAgeingGroupReview("wine-1", {
      rpc: vi.fn().mockResolvedValue({ data: { ...response, versions: [{ ...response.versions[0],
        groups: [{ ...response.versions[0].groups[0], best_end_year: 2020 }] }] }, error: null }),
    })).rejects.toThrow("dates")
  })

  it("accepts a superseded version still pinned by this cellar", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...response, versions: [{
      ...response.versions[0], version_status: "superseded",
    }] }, error: null })
    const review = await getHouseholdAgeingGroupReview("wine-1", { rpc })
    expect(review?.versions[0].versionStatus).toBe("superseded")
  })

  it("sends an exact private choice with concurrency tokens", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null })
    await manageHouseholdAgeingGroupChoice("wine-1", "version-1", "region", "select",
      "group-1", "fingerprint", "revision-1", { rpc })
    expect(rpc).toHaveBeenCalledWith("manage_household_wine_ageing_choice", {
      p_wine_id: "wine-1", p_version_id: "version-1", p_scope: "region",
      p_action: "select", p_group_id: "group-1", p_expected_fingerprint: "fingerprint",
      p_expected_revision: "revision-1",
    })
  })
})
