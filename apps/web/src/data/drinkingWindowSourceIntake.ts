export type SourceKind = "producer" | "critic" | "provider" | "vintage-report"
export type SourceIntakeStatus = "pending" | "approved" | "rejected"

export interface SourceIntake {
  id: string
  sourceName: string
  sourceKind: SourceKind
  sourceUrl: string
  claimNote: string
  rightsEvidenceUrl: string
  rightsNote: string
  firstTrialYear: number
  bestStartYear: number
  bestEndYear: number
  rowHash: string
  status: SourceIntakeStatus
  submittedAt: string
  reviewNote: string | null
  evidenceId: string | null
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid source intake response")
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid source intake response")
  return value
}

function year(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1800 || value > 2300) {
    throw new Error("Invalid source intake response")
  }
  return value
}

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error("Invalid source intake response")
  return value as T
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value)
}

export function parseSourceIntakes(value: unknown): SourceIntake[] {
  if (!Array.isArray(value)) throw new Error("Invalid source intake response")
  return value.map((entry) => {
    const item = object(entry)
    return {
      id: string(item.id), sourceName: string(item.source_name),
      sourceKind: choice(item.source_kind, ["producer", "critic", "provider", "vintage-report"]),
      sourceUrl: string(item.source_url), claimNote: string(item.claim_note),
      rightsEvidenceUrl: string(item.rights_evidence_url), rightsNote: string(item.rights_note),
      firstTrialYear: year(item.first_trial_year), bestStartYear: year(item.best_start_year),
      bestEndYear: year(item.best_end_year), rowHash: string(item.row_hash),
      status: choice(item.status, ["pending", "approved", "rejected"]),
      submittedAt: string(item.submitted_at), reviewNote: nullableString(item.review_note),
      evidenceId: nullableString(item.evidence_id),
    }
  })
}

async function call(name: string, parameters: Record<string, unknown>, options: Options): Promise<unknown> {
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, parameters)
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function getSourceIntakes(versionId: string, rowId: string, options: Options = {}) {
  return parseSourceIntakes(await call("get_drinking_window_source_intake", {
    p_version_id: versionId, p_row_id: rowId,
  }, options))
}

export async function submitSourceIntake(input: {
  versionId: string
  rowId: string
  expectedHash: string
  sourceName: string
  sourceKind: SourceKind
  sourceUrl: string
  claimNote: string
  rightsEvidenceUrl: string
  rightsNote: string
}, options: Options = {}) {
  return string(await call("submit_drinking_window_source_intake", {
    p_version_id: input.versionId, p_row_id: input.rowId,
    p_expected_hash: input.expectedHash,
    p_source_name: input.sourceName.trim(), p_source_kind: input.sourceKind,
    p_source_url: input.sourceUrl.trim(), p_claim_note: input.claimNote.trim(),
    p_rights_evidence_url: input.rightsEvidenceUrl.trim(),
    p_rights_note: input.rightsNote.trim(),
  }, options))
}

export async function reviewSourceIntake(input: {
  intakeId: string
  expectedHash: string
  verdict: "approve" | "reject"
  reviewNote: string
  datesChecked: boolean
  rightsChecked: boolean
}, options: Options = {}) {
  const result = object(await call("review_drinking_window_source_intake", {
    p_intake_id: input.intakeId, p_expected_hash: input.expectedHash,
    p_verdict: input.verdict, p_review_note: input.reviewNote.trim(),
    p_dates_checked: input.datesChecked, p_rights_checked: input.rightsChecked,
  }, options))
  return {
    status: choice(result.status, ["approved", "rejected"]),
    evidenceId: nullableString(result.evidence_id),
  }
}
