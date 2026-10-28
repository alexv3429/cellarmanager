export type ReviewScope = "release" | "producer_appellation" | "producer_region" | "appellation" | "region"
export type RightsStatus = "unverified" | "reuse-allowed" | "restricted"
export type ReviewDisposition = "investigate" | "propose" | "reject"

export interface IdentityRequest {
  id: string
  requestedAt: string
  producer: string | null
  cuvee: string | null
  vintage: number | null
  color: string | null
  appellation: string | null
  region: string | null
  sourceChanged: boolean
}

export interface CandidateReview {
  id: string
  proposedScope: ReviewScope
  firstTrialYear: number | null
  bestStartYear: number | null
  bestEndYear: number | null
  ageingGroupNote: string
  rationale: string
  evidenceUrls: string[]
  rightsStatus: RightsStatus
  disposition: ReviewDisposition
  createdAt: string
}

export interface DrinkingWindowCandidate {
  id: string
  sourceLocator: string
  sourceIdentity: Record<string, unknown>
  candidateScope: string
  reviewReason: string | null
  wineColor: string | null
  vintageYear: number | null
  firstTrialYear: number | null
  bestStartYear: number | null
  bestEndYear: number | null
  review: CandidateReview | null
}

export interface DrinkingWindowReviewWorkspace {
  eligible: boolean
  identityRequests: IdentityRequest[]
  candidates: DrinkingWindowCandidate[]
}

export interface CandidateReviewDraft {
  candidateId: string
  expectedReviewId: string | null
  proposedScope: ReviewScope
  firstTrialYear: number | null
  bestStartYear: number | null
  bestEndYear: number | null
  ageingGroupNote: string
  rationale: string
  evidenceUrls: string[]
  rightsStatus: RightsStatus
  disposition: ReviewDisposition
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid review workspace response")
  return value as Record<string, unknown>
}

function str(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid review workspace response")
  return value
}

function optionalStr(value: unknown): string | null {
  return value === null ? null : str(value)
}

function year(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1800 || value > 2300) {
    throw new Error("Invalid review workspace year")
  }
  return value
}

const scopes: ReviewScope[] = ["release", "producer_appellation", "producer_region", "appellation", "region"]
const rights: RightsStatus[] = ["unverified", "reuse-allowed", "restricted"]
const dispositions: ReviewDisposition[] = ["investigate", "propose", "reject"]

function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw new Error("Invalid review workspace choice")
  return value as T
}

export function parseDrinkingWindowReviewWorkspace(value: unknown): DrinkingWindowReviewWorkspace {
  const response = object(value)
  if (typeof response.eligible !== "boolean" || !Array.isArray(response.identity_requests) || !Array.isArray(response.candidates)) {
    throw new Error("Invalid review workspace response")
  }
  if (!response.eligible && (response.identity_requests.length || response.candidates.length)) {
    throw new Error("Review workspace leaked curator data")
  }
  return {
    eligible: response.eligible,
    identityRequests: response.identity_requests.map((entry: unknown) => {
      const row = object(entry)
      if (typeof row.source_changed !== "boolean") throw new Error("Invalid review request")
      return {
        id: str(row.id), requestedAt: str(row.requested_at),
        producer: optionalStr(row.producer), cuvee: optionalStr(row.cuvee),
        vintage: year(row.vintage), color: optionalStr(row.color),
        appellation: optionalStr(row.appellation), region: optionalStr(row.region),
        sourceChanged: row.source_changed,
      }
    }),
    candidates: response.candidates.map((entry: unknown) => {
      const row = object(entry)
      const review = row.review === null ? null : object(row.review)
      if (review && !Array.isArray(review.evidence_urls)) throw new Error("Invalid review evidence")
      return {
        id: str(row.id), sourceLocator: str(row.source_locator),
        sourceIdentity: object(row.source_identity), candidateScope: str(row.candidate_scope),
        reviewReason: optionalStr(row.review_reason), wineColor: optionalStr(row.wine_color),
        vintageYear: year(row.vintage_year), firstTrialYear: year(row.first_trial_year),
        bestStartYear: year(row.best_start_year), bestEndYear: year(row.best_end_year),
        review: review ? {
          id: str(review.id), proposedScope: choice(review.proposed_scope, scopes),
          firstTrialYear: year(review.first_trial_year), bestStartYear: year(review.best_start_year),
          bestEndYear: year(review.best_end_year), ageingGroupNote: String(review.ageing_group_note ?? ""),
          rationale: str(review.rationale), evidenceUrls: (review.evidence_urls as unknown[]).map(str),
          rightsStatus: choice(review.rights_status, rights),
          disposition: choice(review.disposition, dispositions), createdAt: str(review.created_at),
        } : null,
      }
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

export async function getDrinkingWindowReviewWorkspace(options: Options = {}): Promise<DrinkingWindowReviewWorkspace> {
  return parseDrinkingWindowReviewWorkspace(await call("get_drinking_window_review_workspace", {}, options))
}

export async function saveDrinkingWindowCandidateReview(draft: CandidateReviewDraft, options: Options = {}): Promise<string> {
  if (draft.disposition === "propose" && (
    draft.firstTrialYear === null || draft.bestStartYear === null || draft.bestEndYear === null ||
    draft.evidenceUrls.length === 0 || draft.rightsStatus !== "reuse-allowed"
  )) throw new Error("A complete, sourced window with reuse rights is needed before proposing")
  return str(await call("save_drinking_window_candidate_review", {
    p_candidate_id: draft.candidateId,
    p_expected_review_id: draft.expectedReviewId,
    p_proposed_scope: draft.proposedScope,
    p_first_trial_year: draft.firstTrialYear,
    p_best_start_year: draft.bestStartYear,
    p_best_end_year: draft.bestEndYear,
    p_ageing_group_note: draft.ageingGroupNote,
    p_rationale: draft.rationale,
    p_evidence_urls: draft.evidenceUrls,
    p_rights_status: draft.rightsStatus,
    p_disposition: draft.disposition,
  }, options))
}

export async function stageDrinkingWindowCandidateAsDraft(input: {
  candidateId: string
  expectedReviewId: string
  baseVersionId: string
}, options: Options = {}): Promise<{ versionId: string; versionNumber: number; rowId: string; alreadyStaged: boolean }> {
  const result = object(await call("stage_drinking_window_candidate_as_draft", {
    p_candidate_id: input.candidateId,
    p_expected_review_id: input.expectedReviewId,
    p_base_version_id: input.baseVersionId,
  }, options))
  if (typeof result.already_staged !== "boolean" ||
    typeof result.version_number !== "number" || !Number.isInteger(result.version_number)) {
    throw new Error("Invalid draft staging response")
  }
  return {
    versionId: str(result.version_id), versionNumber: result.version_number,
    rowId: str(result.row_id),
    alreadyStaged: result.already_staged,
  }
}
