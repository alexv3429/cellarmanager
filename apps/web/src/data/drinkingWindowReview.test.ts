import { describe, expect, it, vi } from "vitest"

import {
  getDrinkingWindowReviewWorkspace,
  parseDrinkingWindowReviewWorkspace,
  saveDrinkingWindowCandidateReview,
  stageDrinkingWindowCandidateAsDraft,
} from "./drinkingWindowReview"

const workspace = {
  eligible: true,
  identity_requests: [{
    id: "request", requested_at: "2026-10-16T20:00:00Z", producer: "Barraud",
    cuvee: "En France", vintage: 2019, color: "white", appellation: "Pouilly-Fuissé",
    region: "Bourgogne", source_changed: false,
  }],
  candidates: [{
    id: "candidate", source_locator: "Barraud!A2:F2",
    source_identity: { producer: "Barraud", cuvee: "En France" },
    candidate_scope: "release", review_reason: null, wine_color: "white",
    vintage_year: 2019, first_trial_year: null,
    best_start_year: 2024, best_end_year: 2031, review: null,
  }],
}

describe("drinking-window curator workspace boundary", () => {
  it("parses only eligible curator data and keeps historical dates as candidates", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: workspace, error: null })
    const result = await getDrinkingWindowReviewWorkspace({ rpc })
    expect(result.candidates[0]).toMatchObject({
      vintageYear: 2019, firstTrialYear: null, bestStartYear: 2024, review: null,
    })
    expect(result.identityRequests[0].producer).toBe("Barraud")
    expect(rpc).toHaveBeenCalledWith("get_drinking_window_review_workspace", {})
    expect(() => parseDrinkingWindowReviewWorkspace({
      ...workspace, eligible: false,
    })).toThrow("leaked")
  })

  it("saves an append-only review draft with optimistic concurrency", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "review-id", error: null })
    const draft = {
      candidateId: "candidate", expectedReviewId: null,
      proposedScope: "release" as const, firstTrialYear: 2023,
      bestStartYear: 2024, bestEndYear: 2031,
      ageingGroupNote: "specific cuvée", rationale: "Reviewed producer evidence for this wine.",
      evidenceUrls: ["https://example.test/evidence"], rightsStatus: "reuse-allowed" as const,
      disposition: "propose" as const,
    }
    expect(await saveDrinkingWindowCandidateReview(draft, { rpc })).toBe("review-id")
    expect(rpc).toHaveBeenCalledWith("save_drinking_window_candidate_review", expect.objectContaining({
      p_candidate_id: "candidate", p_expected_review_id: null,
      p_first_trial_year: 2023, p_rights_status: "reuse-allowed",
    }))
    await expect(saveDrinkingWindowCandidateReview({ ...draft, firstTrialYear: null }, { rpc }))
      .rejects.toThrow("complete, sourced window")
  })

  it("stages a reviewed candidate only through the curator RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      version_id: "new-version", version_number: 3, row_id: "new-row", already_staged: false,
    }, error: null })
    expect(await stageDrinkingWindowCandidateAsDraft({
      candidateId: "candidate", expectedReviewId: "review", baseVersionId: "base",
    }, { rpc })).toEqual({
      versionId: "new-version", versionNumber: 3, rowId: "new-row", alreadyStaged: false,
    })
    expect(rpc).toHaveBeenCalledWith("stage_drinking_window_candidate_as_draft", {
      p_candidate_id: "candidate", p_expected_review_id: "review", p_base_version_id: "base",
    })
  })
})
