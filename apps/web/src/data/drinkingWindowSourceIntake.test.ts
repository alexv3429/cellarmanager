import { describe, expect, it, vi } from "vitest"

import { getSourceIntakes, parseSourceIntakes, reviewSourceIntake, submitSourceIntake } from "./drinkingWindowSourceIntake"

const item = {
  id: "intake", source_name: "Producer page", source_kind: "producer",
  source_url: "https://example.org/wine", claim_note: "The three dates are listed in the maturity table.",
  rights_evidence_url: "https://example.org/terms",
  rights_note: "The source terms permit display and reuse of these facts.",
  first_trial_year: 2025, best_start_year: 2028, best_end_year: 2040,
  row_hash: "a".repeat(64), status: "pending", submitted_at: "2026-10-28T14:00:00Z",
  review_note: null, evidence_id: null,
}

describe("exact-release source intake transport", () => {
  it("parses the private curator inbox and rejects malformed statuses", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [item], error: null })
    const result = await getSourceIntakes("version", "row", { rpc })
    expect(result[0]).toMatchObject({ sourceName: "Producer page", status: "pending", bestEndYear: 2040 })
    expect(rpc).toHaveBeenCalledWith("get_drinking_window_source_intake", {
      p_version_id: "version", p_row_id: "row",
    })
    expect(() => parseSourceIntakes([{ ...item, status: "unknown" }])).toThrow("Invalid")
  })

  it("submits a source lead, then records an explicit independent review", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: "intake", error: null })
      .mockResolvedValueOnce({ data: { status: "approved", evidence_id: "evidence" }, error: null })
    await submitSourceIntake({ versionId: "version", rowId: "row", expectedHash: item.row_hash,
      sourceName: "Producer page", sourceKind: "producer", sourceUrl: item.source_url,
      claimNote: item.claim_note, rightsEvidenceUrl: item.rights_evidence_url,
      rightsNote: item.rights_note }, { rpc })
    expect(rpc).toHaveBeenCalledWith("submit_drinking_window_source_intake", expect.objectContaining({
      p_expected_hash: item.row_hash, p_source_url: item.source_url,
    }))
    const reviewed = await reviewSourceIntake({ intakeId: "intake", expectedHash: item.row_hash,
      verdict: "approve", reviewNote: "All three dates and the reuse rights were checked.",
      datesChecked: true, rightsChecked: true }, { rpc })
    expect(reviewed).toEqual({ status: "approved", evidenceId: "evidence" })
    expect(rpc).toHaveBeenCalledWith("review_drinking_window_source_intake", expect.objectContaining({
      p_dates_checked: true, p_rights_checked: true, p_verdict: "approve",
    }))
  })
})
