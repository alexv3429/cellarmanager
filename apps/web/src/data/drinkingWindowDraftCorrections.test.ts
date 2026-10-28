import { describe, expect, it, vi } from "vitest"

import {
  changeDraftRowEvidence,
  correctDraftRow,
  getDraftRowCorrection,
  parseDraftRowCorrection,
} from "./drinkingWindowDraftCorrections"

const hash = "a".repeat(64)
const response = {
  hash, first_trial_year: 2025, best_start_year: 2028, best_end_year: 2040,
  rationale: "A reviewed draft estimate for this exact release.",
  linked: [{ evidence_id: "evidence", claim_part: "first_trial", evidence_role: "supports",
    source_name: "Producer page", source_url: "https://example.org/wine",
    review_status: "reviewed", reuse_right: "allowed" }],
  available: [{ evidence_id: "evidence", source_name: "Producer page",
    source_url: "https://example.org/wine", source_published_on: null }],
  history: [{ action: "dates", created_at: "2026-10-28T12:00:00Z" }],
}

describe("drinking-window draft correction transport", () => {
  it("reads a bounded curator edit state and rejects malformed hashes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: response, error: null })
    const result = await getDraftRowCorrection("version", "row", { rpc })
    expect(rpc).toHaveBeenCalledWith("get_drinking_window_draft_row_correction", {
      p_version_id: "version", p_row_id: "row",
    })
    expect(result.linked[0].claimPart).toBe("first_trial")
    expect(result.available[0].sourceName).toBe("Producer page")
    expect(() => parseDraftRowCorrection({ ...response, hash: "wrong" })).toThrow("hash")
  })

  it("sends the expected subject hash for date and evidence edits", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: hash, error: null })
    await correctDraftRow({ versionId: "version", rowId: "row", expectedHash: hash,
      firstTrialYear: 2026, bestStartYear: 2029, bestEndYear: 2041,
      rationale: "A corrected reason for this exact release." }, { rpc })
    expect(rpc).toHaveBeenCalledWith("correct_drinking_window_draft_row", expect.objectContaining({
      p_expected_hash: hash, p_first_trial_year: 2026, p_best_end_year: 2041,
    }))
    await changeDraftRowEvidence({ versionId: "version", rowId: "row", expectedHash: hash,
      action: "attach", evidenceId: "evidence" }, { rpc })
    expect(rpc).toHaveBeenCalledWith("change_drinking_window_draft_row_evidence", expect.objectContaining({
      p_action: "attach", p_evidence_id: "evidence",
    }))
    expect(rpc.mock.calls[1][1]).not.toHaveProperty("p_claim_part")
    await expect(correctDraftRow({ versionId: "version", rowId: "row", expectedHash: hash,
      firstTrialYear: 2030, bestStartYear: 2029, bestEndYear: 2041,
      rationale: "An invalid inverted correction." }, { rpc })).rejects.toThrow("ordered years")
  })
})
