import { describe, expect, it } from "vitest"

import {
  getDrinkingWindowRolloutStatus,
  getShadowReport,
  listShadowReports,
  requestDrinkingWindowShadowReport,
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
        proposed_best_end_year: 2032,
        proposed_group_key: "reviewed-long-ageing-2022-morgon",
        proposed_group_definition: "Individually reviewed long-ageing wines",
        proposed_reference_rationale: "Owner-authored estimate",
        reason: null,
      }],
    }))
    expect(report.rows[0]).toMatchObject({
      currentBestEndYear: 2030, proposedBestEndYear: 2032,
      proposedGroupKey: "reviewed-long-ageing-2022-morgon",
      proposedGroupDefinition: "Individually reviewed long-ageing wines",
      proposedReferenceRationale: "Owner-authored estimate",
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

  it("shows a published version without treating an unselected cellar as enabled", async () => {
    expect(await getDrinkingWindowRolloutStatus("household-1", rpc({
      active_version_number: 8, selected_version_number: null,
      selected_enabled: false, global_enabled: true,
    }))).toEqual({
      activeVersionNumber: 8, selectedVersionNumber: null,
      selectedEnabled: false, globalEnabled: true,
    })
  })

  it("requests a comparison only for the selected household", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = []
    const client = { rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return { data: "report-2", error: null }
    } }
    expect(await requestDrinkingWindowShadowReport("household-1", client)).toBe("report-2")
    expect(calls).toEqual([{
      name: "request_drinking_window_shadow_report",
      args: { p_household_id: "household-1" },
    }])
  })
})
