import { describe, expect, it, vi } from "vitest"

import {
  getMySharedWindowCandidates,
  submitSharedWindowCandidate,
  validateSharedWindowCandidate,
} from "./drinkingWindowCandidateSubmission"

const valid = {
  firstTrialYear: 2026,
  bestStartYear: 2029,
  bestEndYear: 2040,
  rationale: "A release-specific estimate with a clear ageing argument.",
  evidenceUrls: ["https://example.org/producer-note"],
}

describe("shared drinking-window candidate submission", () => {
  it("rejects missing, inverted, or pre-vintage milestones before calling the database", async () => {
    const rpc = vi.fn()
    expect(() => validateSharedWindowCandidate({ ...valid, firstTrialYear: 2022 }, 2023)).toThrow()
    expect(() => validateSharedWindowCandidate({ ...valid, bestStartYear: 2025 }, 2023)).toThrow()
    expect(() => validateSharedWindowCandidate({ ...valid, bestEndYear: 2028 }, 2023)).toThrow()
    await expect(submitSharedWindowCandidate("wine", 2023, { ...valid, firstTrialYear: 0 }, { rpc }))
      .rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("requires a reason and bounded HTTPS links", () => {
    expect(() => validateSharedWindowCandidate({ ...valid, rationale: "too short" }, 2023)).toThrow()
    expect(() => validateSharedWindowCandidate({ ...valid, evidenceUrls: ["http://example.org"] }, 2023)).toThrow()
    expect(() => validateSharedWindowCandidate({ ...valid, evidenceUrls: Array(11).fill("https://example.org") }, 2023)).toThrow()
  })

  it("sends only the exact-release proposal fields; it never publishes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "candidate-id", error: null })
    await expect(submitSharedWindowCandidate("wine-id", 2023, valid, { rpc })).resolves.toBe("candidate-id")
    expect(rpc).toHaveBeenCalledWith("submit_drinking_window_candidate_for_wine", {
      p_wine_id: "wine-id",
      p_first_trial_year: 2026,
      p_best_start_year: 2029,
      p_best_end_year: 2040,
      p_rationale: valid.rationale,
      p_evidence_urls: valid.evidenceUrls,
    })
  })

  it("parses only the owner's candidate status, not a published reference", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      id: "candidate-id", created_at: "2026-10-28T12:00:00Z",
      review_status: "staged", review_disposition: null,
      first_trial_year: 2026, best_start_year: 2029, best_end_year: 2040,
    }], error: null })
    await expect(getMySharedWindowCandidates("wine-id", { rpc })).resolves.toEqual([{
      id: "candidate-id", createdAt: "2026-10-28T12:00:00Z",
      reviewStatus: "staged", reviewDisposition: null,
      firstTrialYear: 2026, bestStartYear: 2029, bestEndYear: 2040,
    }])
    expect(rpc).toHaveBeenCalledWith("get_my_drinking_window_candidates_for_wine", { p_wine_id: "wine-id" })
  })

  it("hides the feature while its separately deployed database function is absent", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Function not found" } })
    await expect(getMySharedWindowCandidates("wine-id", { rpc })).resolves.toBeNull()
  })
})
