export type ReferenceSubjectKind = "row" | "group" | "membership"
export type ReferenceVerdict = "approve" | "disagree"

export interface ReferenceEvidence {
  claimPart: string
  evidenceRole: string
  sourceName: string
  sourceUrl: string | null
  reviewStatus: string
  reuseRight: string
}

export interface ReferenceReview {
  verdict: ReferenceVerdict
  rationale: string
  decidedAt: string
  curatorId: string
}

export interface ReferenceSubject {
  kind: ReferenceSubjectKind
  id: string
  hash: string
  title: string
  details: Record<string, unknown>
  rationale: string
  evidence: ReferenceEvidence[]
  reviews: ReferenceReview[]
  issues: string[]
}

export interface ReferenceDraft {
  versionId: string
  versionNumber: number
  subjects: ReferenceSubject[]
}

export interface ReferenceDraftWorkspace {
  eligible: boolean
  drafts: ReferenceDraft[]
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reference draft response")
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid reference draft response")
  return value
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid reference draft response")
  return value
}

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error("Invalid reference draft response")
  return value as T
}

export function parseReferenceDraftWorkspace(value: unknown): ReferenceDraftWorkspace {
  const result = object(value)
  if (typeof result.eligible !== "boolean") throw new Error("Invalid reference draft response")
  const drafts = array(result.drafts)
  if (!result.eligible && drafts.length) throw new Error("Reference drafts leaked to an ineligible user")
  return {
    eligible: result.eligible,
    drafts: drafts.map((entry) => {
      const draft = object(entry)
      if (typeof draft.version_number !== "number" || !Number.isInteger(draft.version_number)) {
        throw new Error("Invalid reference draft response")
      }
      return {
        versionId: string(draft.version_id), versionNumber: draft.version_number,
        subjects: array(draft.subjects).map((entry) => {
          const subject = object(entry)
          const hash = string(subject.hash)
          if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid reference draft hash")
          return {
            kind: choice(subject.kind, ["row", "group", "membership"] as const),
            id: string(subject.id), hash, title: string(subject.title),
            details: object(subject.details), rationale: string(subject.rationale),
            evidence: array(subject.evidence).map((entry) => {
              const evidence = object(entry)
              return {
                claimPart: string(evidence.claim_part), evidenceRole: string(evidence.evidence_role),
                sourceName: string(evidence.source_name),
                sourceUrl: evidence.source_url === null ? null : string(evidence.source_url),
                reviewStatus: string(evidence.review_status), reuseRight: string(evidence.cross_household_reuse_right),
              }
            }),
            reviews: array(subject.reviews).map((entry) => {
              const review = object(entry)
              return {
                verdict: choice(review.verdict, ["approve", "disagree"] as const),
                rationale: string(review.rationale), decidedAt: string(review.decided_at),
                curatorId: string(review.curator_id),
              }
            }),
            issues: array(subject.issues).map(string),
          }
        }),
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

export async function getReferenceDrafts(options: Options = {}): Promise<ReferenceDraftWorkspace> {
  return parseReferenceDraftWorkspace(await call("get_drinking_window_reference_drafts", {}, options))
}

export async function recordReferenceReview(input: {
  versionId: string
  kind: ReferenceSubjectKind
  subjectId: string
  expectedHash: string
  verdict: ReferenceVerdict
  rationale: string
}, options: Options = {}): Promise<string> {
  if (input.rationale.trim().length < 10 || input.rationale.trim().length > 2000) {
    throw new Error("Please explain the review in 10–2000 characters")
  }
  return string(await call("record_drinking_window_reference_review", {
    p_version_id: input.versionId,
    p_subject_kind: input.kind,
    p_subject_id: input.subjectId,
    p_expected_hash: input.expectedHash,
    p_verdict: input.verdict,
    p_rationale: input.rationale.trim(),
  }, options))
}
