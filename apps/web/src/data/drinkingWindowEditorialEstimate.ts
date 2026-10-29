interface RpcOptions {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

async function call(name: string, parameters: Record<string, unknown>, options: RpcOptions): Promise<unknown> {
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, parameters)
  if (result.error) throw new Error(result.error.message)
  return result.data
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid editorial estimate")
  return value as Record<string, unknown>
}

export function editorialEvidenceId(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null
  try {
    const url = new URL(sourceUrl)
    if (url.pathname !== "/catalog") return null
    const id = url.searchParams.get("editorial-evidence")
    return id && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(id) ? id : null
  } catch { return null }
}

export function editorialContextId(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null
  try {
    const url = new URL(sourceUrl)
    if (url.pathname !== "/catalog") return null
    const id = url.searchParams.get("editorial-context")
    return id && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(id) ? id : null
  } catch { return null }
}

export interface EditorialEstimate {
  firstTrialYear: number
  bestStartYear: number
  bestEndYear: number
  rationale: string
  supportingUrls: string[]
  attribution: string
}

export async function getEditorialEstimate(evidenceId: string, options: RpcOptions = {}): Promise<EditorialEstimate> {
  const item = object(await call("get_drinking_window_editorial_estimate", {
    p_evidence_id: evidenceId,
  }, options))
  if (![item.first_trial_year, item.best_start_year, item.best_end_year].every(Number.isInteger)
    || typeof item.rationale !== "string" || typeof item.attribution !== "string"
    || !Array.isArray(item.supporting_urls)
    || !item.supporting_urls.every((value: unknown) => typeof value === "string" && value.startsWith("https://"))) {
    throw new Error("Invalid editorial estimate")
  }
  return {
    firstTrialYear: item.first_trial_year as number,
    bestStartYear: item.best_start_year as number,
    bestEndYear: item.best_end_year as number,
    rationale: item.rationale,
    supportingUrls: item.supporting_urls,
    attribution: item.attribution,
  }
}

export async function attestEditorialEstimate(input: {
  versionId: string
  rowId: string
  expectedHash: string
  rationale: string
  supportingUrls: string[]
  adoptAndShare: boolean
}, options: RpcOptions = {}): Promise<string> {
  if (input.rationale.trim().length < 30 || input.supportingUrls.length < 1 || !input.adoptAndShare) {
    throw new Error("Review the estimate, sources and sharing consent")
  }
  const result = object(await call("attest_drinking_window_editorial_estimate", {
    p_version_id: input.versionId,
    p_row_id: input.rowId,
    p_expected_hash: input.expectedHash,
    p_rationale: input.rationale.trim(),
    p_supporting_urls: input.supportingUrls,
    p_adopt_and_share: input.adoptAndShare,
  }, options))
  if (typeof result.evidence_id !== "string") throw new Error("Invalid editorial evidence response")
  return result.evidence_id
}

export interface EditorialContext {
  subjectKind: "group" | "membership"
  rationale: string
  supportingUrls: string[]
  attribution: string
}

export async function getEditorialContext(evidenceId: string, options: RpcOptions = {}): Promise<EditorialContext> {
  const item = object(await call("get_drinking_window_editorial_context", {
    p_evidence_id: evidenceId,
  }, options))
  if ((item.subject_kind !== "group" && item.subject_kind !== "membership")
    || typeof item.rationale !== "string" || typeof item.attribution !== "string"
    || !Array.isArray(item.supporting_urls)
    || !item.supporting_urls.every((value: unknown) => typeof value === "string" && value.startsWith("https://"))) {
    throw new Error("Invalid editorial context")
  }
  return { subjectKind: item.subject_kind, rationale: item.rationale,
    supportingUrls: item.supporting_urls, attribution: item.attribution }
}

export async function attestEditorialContext(input: {
  versionId: string
  subjectKind: "group" | "membership"
  subjectId: string
  expectedHash: string
  rationale: string
  supportingUrls: string[]
  adoptAndShare: boolean
}, options: RpcOptions = {}): Promise<string> {
  if (input.rationale.trim().length < 30 || !input.supportingUrls.length || !input.adoptAndShare) {
    throw new Error("Review the assessment, sources and sharing consent")
  }
  const result = object(await call("attest_drinking_window_editorial_context", {
    p_version_id: input.versionId,
    p_subject_kind: input.subjectKind,
    p_subject_id: input.subjectId,
    p_expected_hash: input.expectedHash,
    p_rationale: input.rationale.trim(),
    p_supporting_urls: input.supportingUrls,
    p_adopt_and_share: input.adoptAndShare,
  }, options))
  if (typeof result.evidence_id !== "string") throw new Error("Invalid editorial context response")
  return result.evidence_id
}
