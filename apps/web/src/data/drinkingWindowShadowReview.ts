interface RpcClient {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message: string } | null
  }>
}

async function client(): Promise<RpcClient> {
  const { supabase } = await import("./supabase")
  return supabase
}

async function call(name: string, args: Record<string, unknown>, provided?: RpcClient) {
  const { data, error } = await (provided ?? await client()).rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

function item(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid drinking-window review response")
  }
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid drinking-window review response")
  return value
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("Invalid drinking-window review response")
  }
  return value
}

export interface ShadowReportListing {
  reportId: string
  versionNumber: number
  versionStatus: string
  wineCount: number
  draftIssueCount: number
  recordedAt: string
  latestVerdict: string | null
}

export interface ShadowComparisonRow {
  wineId: string
  comparisonStatus: string
  currentSource: string
  draftStatus: string
  matchedScope: string | null
  currentFirstTrialYear: number | null
  currentBestStartYear: number | null
  currentBestEndYear: number | null
  proposedFirstTrialYear: number | null
  proposedBestStartYear: number | null
  proposedBestEndYear: number | null
  reason: string | null
}

export interface ShadowReport extends ShadowReportListing {
  contentSha256: string
  rows: ShadowComparisonRow[]
}

function optionalString(value: unknown): string | null {
  return value === null ? null : string(value)
}

function optionalInteger(value: unknown): number | null {
  return value === null ? null : integer(value)
}

export async function listShadowReports(
  householdId: string,
  rpcClient?: RpcClient,
): Promise<ShadowReportListing[]> {
  const raw = await call("list_drinking_window_shadow_reports", {
    p_household_id: householdId,
  }, rpcClient)
  if (!Array.isArray(raw)) throw new Error("Invalid drinking-window review response")
  return raw.map((value) => {
    const row = item(value)
    return {
      reportId: string(row.report_id),
      versionNumber: integer(row.version_number),
      versionStatus: string(row.version_status),
      wineCount: integer(row.wine_count),
      draftIssueCount: integer(row.draft_issue_count),
      recordedAt: string(row.recorded_at),
      latestVerdict: optionalString(row.latest_verdict),
    }
  })
}

export async function getShadowReport(
  listing: ShadowReportListing,
  rpcClient?: RpcClient,
): Promise<ShadowReport> {
  const raw = item(await call("get_drinking_window_shadow_report", {
    p_report_id: listing.reportId,
  }, rpcClient))
  if (!Array.isArray(raw.rows) || string(raw.report_id) !== listing.reportId) {
    throw new Error("Invalid drinking-window review response")
  }
  return {
    ...listing,
    contentSha256: string(raw.content_sha256),
    rows: raw.rows.map((value) => {
      const row = item(value)
      return {
        wineId: string(row.wine_id),
        comparisonStatus: string(row.comparison_status),
        currentSource: string(row.current_source),
        draftStatus: string(row.draft_status),
        matchedScope: optionalString(row.matched_scope),
        currentFirstTrialYear: optionalInteger(row.current_first_trial_year),
        currentBestStartYear: optionalInteger(row.current_best_start_year),
        currentBestEndYear: optionalInteger(row.current_best_end_year),
        proposedFirstTrialYear: optionalInteger(row.proposed_first_trial_year),
        proposedBestStartYear: optionalInteger(row.proposed_best_start_year),
        proposedBestEndYear: optionalInteger(row.proposed_best_end_year),
        reason: optionalString(row.reason),
      }
    }),
  }
}

export async function reviewShadowReport(
  report: ShadowReport,
  verdict: "approve" | "reject",
  rationale: string,
  rpcClient?: RpcClient,
): Promise<void> {
  if (rationale.trim().length < 10) throw new Error("Explain your decision in at least 10 characters")
  await call("review_drinking_window_shadow_report", {
    p_report_id: report.reportId,
    p_expected_content_sha256: report.contentSha256,
    p_verdict: verdict,
    p_rationale: rationale.trim(),
  }, rpcClient)
}
