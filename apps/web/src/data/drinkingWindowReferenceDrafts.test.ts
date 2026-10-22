import { describe, expect, it, vi } from "vitest"

import {
  getReferenceDrafts,
  parseReferenceDraftWorkspace,
  recordReferenceReview,
} from "./drinkingWindowReferenceDrafts"

const subject = {
  kind: "row", id: "row-id", hash: "a".repeat(64), title: "Beaujolais · 2022 · red",
  details: { first_trial_year: 2025, best_start_year: 2028, best_end_year: 2035 },
  rationale: "Owner-authored dates for this group.",
  evidence: [{ claim_part: "optimal_period", evidence_role: "supports",
    source_name: "Owner review", source_url: "https://example.test/source",
    review_status: "reviewed", cross_household_reuse_right: "allowed" }],
  reviews: [], issues: ["missing_current_approval"],
}

describe("drinking-window reference draft curator boundary", () => {
  it("parses actual references without treating historical workbook candidates as approved", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      eligible: true, drafts: [{ version_id: "version-id", version_number: 1, subjects: [subject] }],
    }, error: null })
    const result = await getReferenceDrafts({ rpc })
    expect(result.drafts[0].subjects[0]).toMatchObject({
      kind: "row", details: { first_trial_year: 2025, best_start_year: 2028, best_end_year: 2035 },
      issues: ["missing_current_approval"],
    })
    expect(rpc).toHaveBeenCalledWith("get_drinking_window_reference_drafts", {})
    expect(() => parseReferenceDraftWorkspace({ eligible: false, drafts: [{ version_id: "hidden" }] }))
      .toThrow("leaked")
  })

  it("submits a hash-bound decision and rejects an unexplained approval", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "decision-id", error: null })
    const review = { versionId: "version-id", kind: "row" as const,
      subjectId: "row-id", expectedHash: "a".repeat(64), verdict: "approve" as const,
      rationale: "I checked the exact dates and supporting source." }
    expect(await recordReferenceReview(review, { rpc })).toBe("decision-id")
    expect(rpc).toHaveBeenCalledWith("record_drinking_window_reference_review", expect.objectContaining({
      p_subject_kind: "row", p_expected_hash: "a".repeat(64), p_verdict: "approve",
    }))
    await expect(recordReferenceReview({ ...review, rationale: "Too short" }, { rpc }))
      .rejects.toThrow("10–2000")
  })
})
