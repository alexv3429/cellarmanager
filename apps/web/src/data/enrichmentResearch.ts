export type EnrichmentResearchStatus =
  | "queued"
  | "researching"
  | "draft-ready"
  | "owner-reviewed"
  | "needs-identity-review"
  | "needs-source-review"
  | "not-found"
  | "retrying"
  | "failed"
  | "published"

export type EnrichmentResearchVerdict =
  | "accepted"
  | "edited"
  | "rejected"

export interface EnrichmentResearchSource {
  attribution: string | null
  name: string
  retrievedAt: string
  url: string
}

export interface EnrichmentResearchReview {
  createdAt: string
  id: string
  note: string | null
  proposal: Record<string, unknown> | null
  verdict: EnrichmentResearchVerdict
}

export interface EnrichmentResearchDraft {
  confidence: number
  createdAt: string
  id: string
  proposal: Record<string, unknown>
  proposalKind: "fact" | "profile"
  rationale: string
  review: EnrichmentResearchReview | null
  revision: number
  sources: EnrichmentResearchSource[]
  synthesisModel: string
}

export interface EnrichmentResearchItem {
  caseId: string
  exemplarWineId: string
  gapType: string
  lastErrorCode: string | null
  matchingWineIds: string[]
  notifiedAt: string | null
  requestedAt: string
  seenAt: string | null
  status: EnrichmentResearchStatus
  subject: {
    appellation: string | null
    area: string | null
    color: string | null
    cuvee: string | null
    producer: string | null
    title: string
    vintage: number | null
  }
  subjectKey: string
  subjectType: string
  subscriptionStatus: "open" | "reviewed" | "rejected" | "published"
  draft: EnrichmentResearchDraft | null
}

export interface EnrichmentResearchInbox {
  items: EnrichmentResearchItem[]
  status: "available"
  unreadCount: number
}

export function partitionEnrichmentResearchItems(
  items: readonly EnrichmentResearchItem[],
): {
  active: EnrichmentResearchItem[]
  published: EnrichmentResearchItem[]
} {
  return items.reduce<{
    active: EnrichmentResearchItem[]
    published: EnrichmentResearchItem[]
  }>(
    (groups, item) => {
      groups[item.status === "published" ? "published" : "active"].push(item)
      return groups
    },
    { active: [], published: [] },
  )
}

export interface EnrichmentResearchCurationAction {
  kind: "open" | "request" | "waiting"
  label: string
}

export interface EnrichmentResearchProducerCandidate {
  canonicalName: string
  examples: string[]
  producerKey: string
  score: number
}

export function findEnrichmentResearchForCurationItem(
  inbox: EnrichmentResearchInbox | null,
  gapType: string,
  wineIds: readonly string[],
): EnrichmentResearchItem | null {
  if (inbox === null) return null

  return inbox.items.find(
    (item) =>
      item.gapType === gapType &&
      item.matchingWineIds.some((wineId) => wineIds.includes(wineId)),
  ) ?? null
}

export function enrichmentResearchCurationAction(
  item: EnrichmentResearchItem | null,
): EnrichmentResearchCurationAction {
  if (item === null) {
    return { kind: "request", label: "Request research" }
  }

  switch (item.status) {
    case "needs-identity-review":
      return { kind: "open", label: "Review identity" }
    case "draft-ready":
      return {
        kind: "open",
        label:
          item.subscriptionStatus === "rejected"
            ? "Review again"
            : "Review draft",
      }
    case "needs-source-review":
      return { kind: "waiting", label: "Source review pending" }
    case "owner-reviewed":
      return { kind: "waiting", label: "Awaiting publication" }
    case "published":
      return { kind: "waiting", label: "Published" }
    case "not-found":
    case "failed":
      return { kind: "request", label: "Retry research" }
    case "queued":
    case "researching":
    case "retrying":
      return { kind: "waiting", label: "Research in progress" }
  }
}

interface RpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

async function defaultClient(): Promise<RpcClient> {
  const { supabase } = await import("./supabase")
  return supabase
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be non-empty text`)
  }
  return value.trim()
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null
  return text(value, field)
}

function dateText(value: unknown, field: string): string {
  const parsed = text(value, field)
  if (Number.isNaN(Date.parse(parsed))) throw new Error(`${field} is invalid`)
  return parsed
}

function optionalDateText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null
  return dateText(value, field)
}

function integer(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`)
  return parsed
}

function number(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number`)
  return parsed
}

function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((item, index) =>
    text(item, `${field} ${index + 1}`),
  )
}

function optionalInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null
  return integer(value, field)
}

function parseReview(value: unknown): EnrichmentResearchReview | null {
  if (value === null || value === undefined) return null
  const item = record(value, "Research review")
  const verdict = item.verdict
  if (verdict !== "accepted" && verdict !== "edited" && verdict !== "rejected") {
    throw new Error("Research verdict is invalid")
  }
  return {
    createdAt: dateText(item.created_at, "Research review time"),
    id: text(item.id, "Research review ID"),
    note: optionalText(item.note, "Research review note"),
    proposal:
      item.proposal === null || item.proposal === undefined
        ? null
        : record(item.proposal, "Reviewed research proposal"),
    verdict,
  }
}

function parseDraft(value: unknown): EnrichmentResearchDraft | null {
  if (value === null || value === undefined) return null
  const item = record(value, "Research draft")
  const proposalKind = item.proposal_kind
  if (proposalKind !== "fact" && proposalKind !== "profile") {
    throw new Error("Research proposal kind is invalid")
  }
  const confidence = number(item.confidence, "Research confidence")
  if (confidence < 0 || confidence > 1) {
    throw new Error("Research confidence is outside its allowed range")
  }
  return {
    confidence,
    createdAt: dateText(item.created_at, "Research draft time"),
    id: text(item.id, "Research draft ID"),
    proposal: record(item.proposal, "Research proposal"),
    proposalKind,
    rationale: text(item.rationale, "Research rationale"),
    review: parseReview(item.review),
    revision: integer(item.revision, "Research revision"),
    sources: array(item.sources, "Research sources").map((value, index) => {
      const source = record(value, `Research source ${index + 1}`)
      return {
        attribution: optionalText(
          source.attribution,
          `Research source ${index + 1} attribution`,
        ),
        name: text(source.name, `Research source ${index + 1} name`),
        retrievedAt: dateText(
          source.retrieved_at,
          `Research source ${index + 1} retrieval time`,
        ),
        url: text(source.url, `Research source ${index + 1} URL`),
      }
    }),
    synthesisModel: text(item.synthesis_model, "Research synthesis model"),
  }
}

export function parseEnrichmentResearchInbox(
  value: unknown,
): EnrichmentResearchInbox {
  const result = record(value, "Research inbox")
  if (result.status !== "available") {
    throw new Error("Research inbox status is invalid")
  }
  const unreadCount = integer(result.unread_count, "Unread research count")
  if (unreadCount < 0) throw new Error("Unread research count cannot be negative")

  const statuses: EnrichmentResearchStatus[] = [
    "queued",
    "researching",
    "draft-ready",
    "owner-reviewed",
    "needs-identity-review",
    "needs-source-review",
    "not-found",
    "retrying",
    "failed",
    "published",
  ]

  return {
    items: array(result.items, "Research inbox items").map((value, index) => {
      const item = record(value, `Research inbox item ${index + 1}`)
      const status = item.status as EnrichmentResearchStatus
      if (!statuses.includes(status)) {
        throw new Error(`Research inbox item ${index + 1} status is invalid`)
      }
      const subscriptionStatus = item.subscription_status
      if (
        subscriptionStatus !== "open" &&
        subscriptionStatus !== "reviewed" &&
        subscriptionStatus !== "rejected" &&
        subscriptionStatus !== "published"
      ) {
        throw new Error(`Research inbox item ${index + 1} subscription status is invalid`)
      }
      const subject = record(item.subject, `Research inbox item ${index + 1} subject`)
      return {
        caseId: text(item.case_id, `Research inbox item ${index + 1} case ID`),
        draft: parseDraft(item.draft),
        exemplarWineId: text(
          item.exemplar_wine_id,
          `Research inbox item ${index + 1} exemplar wine ID`,
        ),
        gapType: text(item.gap_type, `Research inbox item ${index + 1} gap`),
        lastErrorCode: optionalText(
          item.last_error_code,
          `Research inbox item ${index + 1} error`,
        ),
        matchingWineIds: stringArray(
          item.matching_wine_ids,
          `Research inbox item ${index + 1} matching wines`,
        ),
        notifiedAt: optionalDateText(
          item.notified_at,
          `Research inbox item ${index + 1} notification time`,
        ),
        requestedAt: dateText(
          item.requested_at,
          `Research inbox item ${index + 1} request time`,
        ),
        seenAt: optionalDateText(
          item.seen_at,
          `Research inbox item ${index + 1} seen time`,
        ),
        status,
        subject: {
          appellation: optionalText(subject.appellation, "Research appellation"),
          area: optionalText(subject.area, "Research area"),
          color: optionalText(subject.color, "Research color"),
          cuvee: optionalText(subject.cuvee, "Research cuvée"),
          producer: optionalText(subject.producer, "Research producer"),
          title: text(subject.title, "Research subject title"),
          vintage: optionalInteger(subject.vintage, "Research vintage"),
        },
        subjectKey: text(item.subject_key, `Research inbox item ${index + 1} subject key`),
        subjectType: text(item.subject_type, `Research inbox item ${index + 1} subject type`),
        subscriptionStatus,
      }
    }),
    status: "available",
    unreadCount,
  }
}

export function parseEnrichmentResearchProducerCandidates(
  value: unknown,
): EnrichmentResearchProducerCandidate[] {
  const result = record(value, "Research producer candidates")
  if (result.status !== "available") {
    throw new Error("Research producer candidates are unavailable")
  }

  return array(result.candidates, "Research producer candidate list").map(
    (value, index) => {
      const candidate = record(
        value,
        `Research producer candidate ${index + 1}`,
      )
      const score = number(
        candidate.score,
        `Research producer candidate ${index + 1} score`,
      )
      if (score < 0 || score > 1) {
        throw new Error("Research producer candidate score is invalid")
      }
      return {
        canonicalName: text(
          candidate.canonical_name,
          `Research producer candidate ${index + 1} name`,
        ),
        examples: stringArray(
          candidate.examples,
          `Research producer candidate ${index + 1} example`,
        ),
        producerKey: text(
          candidate.producer_key,
          `Research producer candidate ${index + 1} key`,
        ),
        score,
      }
    },
  )
}

async function callInboxRpc(
  functionName: string,
  parameters: Record<string, unknown>,
  rpcClient?: RpcClient,
): Promise<EnrichmentResearchInbox> {
  const client = rpcClient ?? (await defaultClient())
  const { data, error } = await client.rpc(functionName, parameters)
  if (error) throw new Error(error.message)
  return parseEnrichmentResearchInbox(data)
}

export function getEnrichmentResearchInbox(
  householdId: string,
  rpcClient?: RpcClient,
): Promise<EnrichmentResearchInbox> {
  return callInboxRpc(
    "get_household_enrichment_research_inbox",
    { p_household_id: householdId },
    rpcClient,
  )
}

export function requestEnrichmentResearch(
  householdId: string,
  wineId: string,
  gapType: string,
  priority: number,
  rpcClient?: RpcClient,
): Promise<EnrichmentResearchInbox> {
  return callInboxRpc(
    "request_enrichment_research",
    {
      p_gap_type: gapType,
      p_household_id: householdId,
      p_priority: priority,
      p_wine_id: wineId,
    },
    rpcClient,
  )
}

export async function getEnrichmentResearchProducerCandidates(
  householdId: string,
  caseId: string,
  rpcClient?: RpcClient,
): Promise<EnrichmentResearchProducerCandidate[]> {
  const client = rpcClient ?? (await defaultClient())
  const { data, error } = await client.rpc(
    "get_enrichment_research_producer_candidates",
    { p_case_id: caseId, p_household_id: householdId },
  )
  if (error) throw new Error(error.message)
  return parseEnrichmentResearchProducerCandidates(data)
}

export function confirmEnrichmentResearchProducerIdentity(
  householdId: string,
  caseId: string,
  producerKey: string,
  rpcClient?: RpcClient,
): Promise<EnrichmentResearchInbox> {
  return callInboxRpc(
    "confirm_enrichment_research_producer_identity",
    {
      p_case_id: caseId,
      p_household_id: householdId,
      p_producer_key: producerKey,
    },
    rpcClient,
  )
}

export function suggestEnrichmentResearchSource(
  householdId: string,
  caseId: string,
  sourceUrl: string,
  sourceKind: "official" | "institutional" | "technical" | "editorial" | "other",
  rpcClient?: RpcClient,
): Promise<EnrichmentResearchInbox> {
  return callInboxRpc(
    "suggest_enrichment_research_source",
    {
      p_case_id: caseId,
      p_household_id: householdId,
      p_source_kind: sourceKind,
      p_source_url: sourceUrl,
    },
    rpcClient,
  )
}

export function markEnrichmentResearchSeen(
  householdId: string,
  caseId: string | null,
  rpcClient?: RpcClient,
): Promise<EnrichmentResearchInbox> {
  return callInboxRpc(
    "mark_enrichment_research_seen",
    { p_case_id: caseId, p_household_id: householdId },
    rpcClient,
  )
}

export function reviewEnrichmentResearchDraft(
  householdId: string,
  draftId: string,
  verdict: EnrichmentResearchVerdict,
  proposal: Record<string, unknown> | null,
  note: string,
  rpcClient?: RpcClient,
): Promise<EnrichmentResearchInbox> {
  return callInboxRpc(
    "review_enrichment_research_draft",
    {
      p_draft_id: draftId,
      p_household_id: householdId,
      p_note: note,
      p_proposal: proposal,
      p_verdict: verdict,
    },
    rpcClient,
  )
}
