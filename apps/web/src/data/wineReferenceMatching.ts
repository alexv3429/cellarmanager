export type WineReferenceReviewStatus =
  | "matched"
  | "unavailable"
  | "unmatched"

export type WineReferenceDecision =
  | "confirmed"
  | "rejected"

export interface WineReferenceCandidateDetails {
  classification: string | null
  colour: string | null
  country: string | null
  designation: string | null
  displayName: string | null
  finalVintage: number | null
  firstVintage: number | null
  lwin7: string
  parcel: string | null
  producerName: string | null
  region: string | null
  site: string | null
  subRegion: string | null
  wineName: string | null
}

export interface WineReferenceCandidateEvidence {
  appellationScore: number
  areaScore: number
  colorCompatible: boolean | null
  producerPreferred: boolean
  producerScore: number
  productScore: number
  reviewRequired: true
  vintageCompatible: boolean | null
}

export interface WineReferenceCandidate {
  blockers: string[]
  details: WineReferenceCandidateDetails
  evidence: WineReferenceCandidateEvidence
  generatedAt: string
  lwin7: string
  matchStrength: "possible" | "strong"
  rank: number
  score: number
}

export interface MatchedWineReference {
  lwin7: string | null
  producerName: string
  productName: string
  referenceId: string
  referenceType: "package" | "product" | "release"
}

export interface WineReferenceReview {
  candidates: WineReferenceCandidate[]
  matchedReference: MatchedWineReference | null
  rejectedCandidates: WineReferenceCandidate[]
  sourceFingerprint: string
  sourceUpdatedThrough: string | null
  status: WineReferenceReviewStatus
}

interface RpcError {
  message: string
}

interface WineReferenceRpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown
    error: RpcError | null
  }>
}

async function getDefaultRpcClient(): Promise<WineReferenceRpcClient> {
  const { supabase } = await import("./supabase")

  return supabase
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid wine-reference response: ${field}`)
  }

  return value
}

function optionalString(
  value: unknown,
  field: string,
): string | null {
  if (value === null) {
    return null
  }

  return requiredString(value, field)
}

function requiredNumber(
  value: unknown,
  field: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid wine-reference response: ${field}`)
  }

  return value
}

function optionalInteger(
  value: unknown,
  field: string,
): number | null {
  if (value === null) {
    return null
  }

  const parsed = requiredNumber(value, field)

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid wine-reference response: ${field}`)
  }

  return parsed
}

function optionalBoolean(
  value: unknown,
  field: string,
): boolean | null {
  if (value === null) {
    return null
  }

  if (typeof value !== "boolean") {
    throw new Error(`Invalid wine-reference response: ${field}`)
  }

  return value
}

function parseCandidateDetails(
  value: unknown,
): WineReferenceCandidateDetails {
  if (!isRecord(value)) {
    throw new Error(
      "Invalid wine-reference response: candidate details",
    )
  }

  return {
    classification: optionalString(
      value.classification,
      "candidate classification",
    ),
    colour: optionalString(value.colour, "candidate colour"),
    country: optionalString(value.country, "candidate country"),
    designation: optionalString(
      value.designation,
      "candidate designation",
    ),
    displayName: optionalString(
      value.display_name,
      "candidate display name",
    ),
    finalVintage: optionalInteger(
      value.final_vintage,
      "candidate final vintage",
    ),
    firstVintage: optionalInteger(
      value.first_vintage,
      "candidate first vintage",
    ),
    lwin7: requiredString(value.lwin7, "candidate LWIN7"),
    parcel: optionalString(value.parcel, "candidate parcel"),
    producerName: optionalString(
      value.producer_name,
      "candidate producer",
    ),
    region: optionalString(value.region, "candidate region"),
    site: optionalString(value.site, "candidate site"),
    subRegion: optionalString(
      value.sub_region,
      "candidate sub-region",
    ),
    wineName: optionalString(
      value.wine_name,
      "candidate wine name",
    ),
  }
}

function parseCandidateEvidence(
  value: unknown,
): WineReferenceCandidateEvidence {
  if (!isRecord(value) || value.review_required !== true) {
    throw new Error(
      "Invalid wine-reference response: candidate evidence",
    )
  }

  if (typeof value.producer_preferred !== "boolean") {
    throw new Error(
      "Invalid wine-reference response: producer preference",
    )
  }

  return {
    appellationScore: requiredNumber(
      value.appellation_score,
      "appellation score",
    ),
    areaScore: requiredNumber(value.area_score, "area score"),
    colorCompatible: optionalBoolean(
      value.color_compatible,
      "color compatibility",
    ),
    producerPreferred: value.producer_preferred,
    producerScore: requiredNumber(
      value.producer_score,
      "producer score",
    ),
    productScore: requiredNumber(
      value.product_score,
      "product score",
    ),
    reviewRequired: true,
    vintageCompatible: optionalBoolean(
      value.vintage_compatible,
      "vintage compatibility",
    ),
  }
}

function parseCandidate(value: unknown): WineReferenceCandidate {
  if (!isRecord(value) || !Array.isArray(value.blockers)) {
    throw new Error(
      "Invalid wine-reference response: candidate",
    )
  }

  const matchStrength = requiredString(
    value.match_strength,
    "match strength",
  )

  if (
    matchStrength !== "strong" &&
    matchStrength !== "possible"
  ) {
    throw new Error(
      "Invalid wine-reference response: match strength",
    )
  }

  const blockers = value.blockers.map((blocker) =>
    requiredString(blocker, "candidate blocker"),
  )
  const details = parseCandidateDetails(value.details)
  const lwin7 = requiredString(value.lwin7, "candidate LWIN7")

  if (details.lwin7 !== lwin7 || !/^\d{7}$/u.test(lwin7)) {
    throw new Error(
      "Invalid wine-reference response: inconsistent LWIN7",
    )
  }

  return {
    blockers,
    details,
    evidence: parseCandidateEvidence(value.evidence),
    generatedAt: requiredString(
      value.generated_at,
      "candidate generation time",
    ),
    lwin7,
    matchStrength,
    rank: requiredNumber(value.rank, "candidate rank"),
    score: requiredNumber(value.score, "candidate score"),
  }
}

function parseMatchedReference(
  value: unknown,
): MatchedWineReference | null {
  if (value === null) {
    return null
  }

  if (!isRecord(value)) {
    throw new Error(
      "Invalid wine-reference response: matched reference",
    )
  }

  const referenceType = requiredString(
    value.reference_type,
    "reference type",
  )

  if (
    referenceType !== "package" &&
    referenceType !== "product" &&
    referenceType !== "release"
  ) {
    throw new Error(
      "Invalid wine-reference response: reference type",
    )
  }

  const lwin7 = optionalString(value.lwin7, "matched LWIN7")

  if (lwin7 !== null && !/^\d{7}$/u.test(lwin7)) {
    throw new Error(
      "Invalid wine-reference response: matched LWIN7",
    )
  }

  return {
    lwin7,
    producerName: requiredString(
      value.producer_name,
      "matched producer",
    ),
    productName: requiredString(
      value.product_name,
      "matched product",
    ),
    referenceId: requiredString(
      value.reference_id,
      "reference id",
    ),
    referenceType,
  }
}

export function parseWineReferenceReview(
  value: unknown,
): WineReferenceReview {
  if (
    !isRecord(value) ||
    !Array.isArray(value.candidates) ||
    !Array.isArray(value.rejected_candidates)
  ) {
    throw new Error("Invalid wine-reference response")
  }

  const status = requiredString(value.status, "status")

  if (
    status !== "matched" &&
    status !== "unavailable" &&
    status !== "unmatched"
  ) {
    throw new Error("Invalid wine-reference response: status")
  }

  const review: WineReferenceReview = {
    candidates: value.candidates.map(parseCandidate),
    matchedReference: parseMatchedReference(
      value.matched_reference,
    ),
    rejectedCandidates:
      value.rejected_candidates.map(parseCandidate),
    sourceFingerprint: requiredString(
      value.source_fingerprint,
      "source fingerprint",
    ),
    sourceUpdatedThrough: optionalString(
      value.source_updated_through,
      "source update time",
    ),
    status,
  }

  if (
    (status === "matched") !==
    (review.matchedReference !== null)
  ) {
    throw new Error(
      "Invalid wine-reference response: matched status",
    )
  }

  return review
}

async function callReviewRpc(
  functionName: string,
  parameters: Record<string, unknown>,
  rpcClient?: WineReferenceRpcClient,
): Promise<WineReferenceReview> {
  const client = rpcClient ?? (await getDefaultRpcClient())
  const { data, error } = await client.rpc(
    functionName,
    parameters,
  )

  if (error) {
    throw new Error(error.message)
  }

  return parseWineReferenceReview(data)
}

export async function getWineReferenceReview(
  wineId: string,
  refresh = false,
  rpcClient?: WineReferenceRpcClient,
): Promise<WineReferenceReview> {
  if (wineId.trim().length === 0) {
    throw new Error("Wine id is required")
  }

  return callReviewRpc(
    "get_wine_reference_review",
    {
      p_wine_id: wineId,
      p_refresh: refresh,
    },
    rpcClient,
  )
}

export async function decideWineReferenceMatch(
  wineId: string,
  lwin7: string,
  decision: WineReferenceDecision,
  rememberProducer: boolean,
  rpcClient?: WineReferenceRpcClient,
): Promise<WineReferenceReview> {
  if (wineId.trim().length === 0) {
    throw new Error("Wine id is required")
  }

  if (!/^\d{7}$/u.test(lwin7)) {
    throw new Error("A valid LWIN7 is required")
  }

  if (decision === "rejected" && rememberProducer) {
    throw new Error(
      "A rejected match cannot remember its producer",
    )
  }

  return callReviewRpc(
    "decide_wine_reference_match",
    {
      p_wine_id: wineId,
      p_lwin7: lwin7,
      p_decision: decision,
      p_remember_producer: rememberProducer,
    },
    rpcClient,
  )
}

export function getWineReferenceBlockerLabel(
  blocker: string,
): string {
  switch (blocker) {
    case "appellation_conflict":
      return "Appellation differs"
    case "close_runner_up":
      return "Another candidate is almost as close"
    case "color_conflict":
      return "Color differs"
    case "producer_preference_conflict":
      return "Different from the remembered producer"
    case "vintage_outside_known_range":
      return "Vintage is outside the known range"
    default:
      return blocker.replaceAll("_", " ")
  }
}
