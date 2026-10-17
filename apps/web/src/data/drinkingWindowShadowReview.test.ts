import { describe, expect, it } from "vitest"

import {
  getShadowReport,
  listShadowReports,
  reviewShadowReport,
} from "./drinkingWindowShadowReview"

function rpc(data: unknown) {
  return { rpc: async () => ({ data, error: null }) }
}

describe("private drinking-window comparison review", () => {
  const listing = {
    reportId: "report-1", versionNumber: 7, versionStatus: "draft",
    wineCount: 1, draftIssueCount: 0, recordedAt: "2026-10-17T00:00:00Z",
    latestVerdict: null,
  }

  it("parses the owner-scoped report list", async () => {
    expect(await listShadowReports("household-1", rpc([{
      report_id: "report-1", version_number: 7, version_status: "draft",
      wine_count: 1, draft_issue_count: 0,
      recorded_at: "2026-10-17T00:00:00Z", latest_verdict: null,
    }]))).toEqual([listing])
  })

  it("keeps current and proposed windows separate", async () => {
    const report = await getShadowReport(listing, rpc({
      report_id: "report-1", content_sha256: "a".repeat(64), rows: [{
        wine_id: "wine-1", comparison_status: "changed",
        current_source: "model", draft_status: "draft_match",
        matched_scope: "region", current_first_trial_year: 2024,
        current_best_start_year: 2026, current_best_end_year: 2030,
        proposed_first_trial_year: 2025, proposed_best_start_year: 2027,
        proposed_best_end_year: 2032, reason: null,
      }],
    }))
    expect(report.rows[0]).toMatchObject({
      currentBestEndYear: 2030, proposedBestEndYear: 2032,
    })
  })

  it("sends the exact report hash and requires a meaningful decision", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = []
    const client = { rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return { data: "decision-1", error: null }
    } }
    const report = { ...listing, contentSha256: "b".repeat(64), rows: [] }
    await expect(reviewShadowReport(report, "approve", "short", client)).rejects.toThrow()
    await reviewShadowReport(report, "approve", "I checked the dates", client)
    expect(calls).toEqual([{
      name: "review_drinking_window_shadow_report",
      args: {
        p_report_id: "report-1",
        p_expected_content_sha256: "b".repeat(64),
        p_verdict: "approve", p_rationale: "I checked the dates",
      },
    }])
  })
})
