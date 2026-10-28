export interface DraftRowSource {
  evidenceId: string
  sourceName: string
  sourceUrl: string | null
}

export interface DraftRowLinkedSource extends DraftRowSource {
  claimPart: string
  evidenceRole: string
  reviewStatus: string
  reuseRight: string
}

export interface DraftRowCorrection {
  hash: string
  firstTrialYear: number
  bestStartYear: number
  bestEndYear: number
  rationale: string
  linked: DraftRowLinkedSource[]
  available: DraftRowSource[]
  history: { action: string; createdAt: string }[]
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid draft correction response")
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid draft correction response")
  return value
}

function year(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1800 || value > 2300) {
    throw new Error("Invalid draft correction response")
  }
  return value
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid draft correction response")
  return value
}

function source(value: unknown): DraftRowSource {
  const item = object(value)
  return {
    evidenceId: string(item.evidence_id),
    sourceName: string(item.source_name),
    sourceUrl: item.source_url === null ? null : string(item.source_url),
  }
}

function hash(value: unknown): string {
  const result = string(value)
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error("Invalid draft correction hash")
  return result
}

export function parseDraftRowCorrection(value: unknown): DraftRowCorrection {
  const result = object(value)
  return {
    hash: hash(result.hash),
    firstTrialYear: year(result.first_trial_year),
    bestStartYear: year(result.best_start_year),
    bestEndYear: year(result.best_end_year),
    rationale: string(result.rationale),
    linked: array(result.linked).map((entry) => {
      const item = object(entry)
      return {
        ...source(item),
        claimPart: string(item.claim_part),
        evidenceRole: string(item.evidence_role),
        reviewStatus: string(item.review_status),
        reuseRight: string(item.reuse_right),
      }
    }),
    available: array(result.available).map(source),
    history: array(result.history).map((entry) => {
      const item = object(entry)
      return { action: string(item.action), createdAt: string(item.created_at) }
    }),
  }
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

export async function getDraftRowCorrection(versionId: string, rowId: string, options: Options = {}) {
  return parseDraftRowCorrection(await call("get_drinking_window_draft_row_correction", {
    p_version_id: versionId, p_row_id: rowId,
  }, options))
}

export async function correctDraftRow(input: {
  versionId: string
  rowId: string
  expectedHash: string
  firstTrialYear: number
  bestStartYear: number
  bestEndYear: number
  rationale: string
}, options: Options = {}) {
  if (input.firstTrialYear > input.bestStartYear || input.bestStartYear > input.bestEndYear
    || input.rationale.trim().length < 10 || input.rationale.trim().length > 2000) {
    throw new Error("Provide three ordered years and a reason of 10–2000 characters")
  }
  return hash(await call("correct_drinking_window_draft_row", {
    p_version_id: input.versionId,
    p_row_id: input.rowId,
    p_expected_hash: input.expectedHash,
    p_first_trial_year: input.firstTrialYear,
    p_best_start_year: input.bestStartYear,
    p_best_end_year: input.bestEndYear,
    p_rationale: input.rationale.trim(),
  }, options))
}

export async function changeDraftRowEvidence(input: {
  versionId: string
  rowId: string
  expectedHash: string
  action: "attach" | "remove"
  evidenceId: string
}, options: Options = {}) {
  return hash(await call("change_drinking_window_draft_row_evidence", {
    p_version_id: input.versionId,
    p_row_id: input.rowId,
    p_expected_hash: input.expectedHash,
    p_action: input.action,
    p_evidence_id: input.evidenceId,
  }, options))
}
