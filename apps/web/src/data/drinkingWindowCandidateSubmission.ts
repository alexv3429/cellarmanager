export interface SharedWindowCandidateInput {
  firstTrialYear: number
  bestStartYear: number
  bestEndYear: number
  rationale: string
  evidenceUrls: string[]
}

export interface SharedWindowCandidateStatus {
  id: string
  createdAt: string
  reviewStatus: string
  reviewDisposition: string | null
  firstTrialYear: number
  bestStartYear: number
  bestEndYear: number
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string; code?: string } | null
  }>
}

class RpcCallError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

async function call(name: string, parameters: Record<string, unknown>, options: Options): Promise<unknown> {
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, parameters)
  if (result.error) throw new RpcCallError(result.error.message, result.error.code)
  return result.data
}

function year(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1800 || value > 2300) {
    throw new Error("Invalid shared-window candidate response")
  }
  return value
}

export function validateSharedWindowCandidate(input: SharedWindowCandidateInput, vintage: number): void {
  if (!Number.isInteger(vintage) || vintage < 1800 || vintage > 2200
    || ![input.firstTrialYear, input.bestStartYear, input.bestEndYear].every((value) =>
      Number.isInteger(value) && value >= 1800 && value <= 2300)
    || input.firstTrialYear < vintage
    || input.firstTrialYear > input.bestStartYear
    || input.bestStartYear > input.bestEndYear) {
    throw new Error("Enter three ordered years, starting no earlier than the vintage")
  }
  if (input.rationale.trim().length < 20 || input.rationale.trim().length > 2000) {
    throw new Error("Explain the proposed dates in at least 20 characters")
  }
  if (input.evidenceUrls.length > 10 || input.evidenceUrls.some((url) =>
    url.length > 1000 || !/^https:\/\/\S+$/.test(url))) {
    throw new Error("Use up to ten HTTPS source links, one per line")
  }
}

export async function submitSharedWindowCandidate(
  wineId: string,
  vintage: number,
  input: SharedWindowCandidateInput,
  options: Options = {},
): Promise<string> {
  validateSharedWindowCandidate(input, vintage)
  const result = await call("submit_drinking_window_candidate_for_wine", {
    p_wine_id: wineId,
    p_first_trial_year: input.firstTrialYear,
    p_best_start_year: input.bestStartYear,
    p_best_end_year: input.bestEndYear,
    p_rationale: input.rationale.trim(),
    p_evidence_urls: input.evidenceUrls,
  }, options)
  if (typeof result !== "string" || !result) throw new Error("Invalid shared-window candidate response")
  return result
}

export async function getMySharedWindowCandidates(wineId: string, options: Options = {}): Promise<SharedWindowCandidateStatus[] | null> {
  let result: unknown
  try {
    result = await call("get_my_drinking_window_candidates_for_wine", { p_wine_id: wineId }, options)
  } catch (error) {
    // Worker code may deploy before its separately authorized DB migration.
    if (error instanceof RpcCallError && error.code === "PGRST202") return null
    throw error
  }
  if (!Array.isArray(result)) throw new Error("Invalid shared-window candidate response")
  return result.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Invalid shared-window candidate response")
    }
    const row = item as Record<string, unknown>
    if (typeof row.id !== "string" || !row.id
      || typeof row.created_at !== "string" || !row.created_at
      || typeof row.review_status !== "string"
      || (row.review_disposition !== null && typeof row.review_disposition !== "string")) {
      throw new Error("Invalid shared-window candidate response")
    }
    return {
      id: row.id,
      createdAt: row.created_at,
      reviewStatus: row.review_status,
      reviewDisposition: row.review_disposition as string | null,
      firstTrialYear: year(row.first_trial_year),
      bestStartYear: year(row.best_start_year),
      bestEndYear: year(row.best_end_year),
    }
  })
}
