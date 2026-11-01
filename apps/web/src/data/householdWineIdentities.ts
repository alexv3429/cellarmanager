export interface SharedWineIdentity {
  referenceId: string
  referenceType: "product" | "release"
  producerName: string
  productName: string
  vintageYear: number | null
  releaseDesignator: string | null
}

export interface HouseholdWineIdentityStatus {
  wineId: string
  sourceFingerprint: string
  matchedReference: {
    referenceId: string
    producerName: string
    productName: string
  } | null
  requestStatus: "pending" | "reviewed" | "declined" | null
}

export interface WineIdentityReconciliationItem {
  wineId: string
  sourceFingerprint: string
  candidateCount: number
  candidates: (SharedWineIdentity & { matchBasis: "exact_or_curated_alias" | "name_containment" })[]
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid wine identity response")
  }
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid wine identity response")
  return value
}

export function parseSharedWineIdentities(value: unknown): SharedWineIdentity[] {
  if (!Array.isArray(value)) throw new Error("Invalid wine identity search response")
  return value.map((item) => {
    const row = record(item)
    const referenceType = string(row.reference_type)
    if (referenceType !== "product" && referenceType !== "release") {
      throw new Error("Invalid wine identity type")
    }
    const vintageYear = row.vintage_year === null ? null : Number(row.vintage_year)
    if (vintageYear !== null && (!Number.isInteger(vintageYear) || vintageYear < 1800 || vintageYear > 2200)) {
      throw new Error("Invalid wine identity vintage")
    }
    if ((referenceType === "product") !== (vintageYear === null)) {
      throw new Error("Invalid wine identity vintage scope")
    }
    return {
      referenceId: string(row.reference_id),
      referenceType,
      producerName: string(row.producer_name),
      productName: string(row.product_name),
      vintageYear,
      releaseDesignator: row.release_designator === null ? null : string(row.release_designator),
    }
  })
}

export function parseWineIdentityReconciliation(value: unknown): WineIdentityReconciliationItem[] {
  if (!Array.isArray(value)) throw new Error("Invalid wine reconciliation response")
  return value.map((item) => {
    const row = record(item)
    const count = Number(row.candidate_count)
    if (!Number.isInteger(count) || count < 0) throw new Error("Invalid wine reconciliation count")
    const rawCandidates = row.candidates
    const candidates = parseSharedWineIdentities(rawCandidates)
    if (candidates.length > count || candidates.length > 5 || (count <= 5 && candidates.length !== count)) {
      throw new Error("Invalid wine reconciliation candidates")
    }
    if (!Array.isArray(rawCandidates)) throw new Error("Invalid wine reconciliation candidates")
    return {
      wineId: string(row.wine_id),
      sourceFingerprint: string(row.source_fingerprint),
      candidateCount: count,
      candidates: candidates.map((candidate, index) => {
        const basis = record(rawCandidates[index]).match_basis
        if (basis !== "exact_or_curated_alias" && basis !== "name_containment") {
          throw new Error("Invalid wine reconciliation match basis")
        }
        return { ...candidate, matchBasis: basis }
      }),
    }
  })
}

export async function previewWineIdentityReconciliation(wineIds: string[], options: Options = {}): Promise<WineIdentityReconciliationItem[]> {
  if (wineIds.length < 1 || wineIds.length > 100 || new Set(wineIds).size !== wineIds.length) {
    throw new Error("Choose 1 to 100 distinct wines")
  }
  const items = parseWineIdentityReconciliation(await call("preview_household_wine_identity_reconciliation", {
    p_wine_ids: wineIds,
  }, options))
  if (items.length !== wineIds.length || new Set(items.map((item) => item.wineId)).size !== wineIds.length ||
      items.some((item) => !wineIds.includes(item.wineId))) {
    throw new Error("Wine reconciliation response does not match the request")
  }
  return items
}

export async function confirmWineIdentityReconciliation(
  choices: { wineId: string; referenceId: string; sourceFingerprint: string }[],
  options: Options = {},
): Promise<void> {
  if (choices.length < 1 || choices.length > 50 || new Set(choices.map((choice) => choice.wineId)).size !== choices.length) {
    throw new Error("Choose 1 to 50 distinct wine links")
  }
  const result = await call("confirm_household_wine_identity_reconciliation", {
    p_choices: choices.map((choice) => ({
      wine_id: string(choice.wineId), reference_id: string(choice.referenceId),
      source_fingerprint: string(choice.sourceFingerprint),
    })),
  }, options)
  if (!Array.isArray(result) || result.length !== choices.length || result.some((value, index) => {
    const row = record(value)
    return row.wine_id !== choices[index].wineId || row.reference_id !== choices[index].referenceId
  })) throw new Error("Wine reconciliation could not be confirmed")
}

export function parseHouseholdWineIdentityStatus(value: unknown, wineId: string): HouseholdWineIdentityStatus {
  const row = record(value)
  if (row.wine_id !== wineId) throw new Error("Wine identity response belongs to another wine")
  const matched = row.matched_reference === null ? null : record(row.matched_reference)
  const requestStatus = row.request_status
  if (requestStatus !== null && requestStatus !== "pending" && requestStatus !== "reviewed" && requestStatus !== "declined") {
    throw new Error("Invalid wine identity request status")
  }
  return {
    wineId,
    sourceFingerprint: string(row.source_fingerprint),
    matchedReference: matched === null ? null : {
      referenceId: string(matched.reference_id),
      producerName: string(matched.producer_name),
      productName: string(matched.product_name),
    },
    requestStatus,
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

export async function searchHouseholdWineIdentities(wineId: string, query: string, options: Options = {}): Promise<SharedWineIdentity[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2 || trimmed.length > 100) throw new Error("Search with 2 to 100 characters")
  return parseSharedWineIdentities(await call("search_household_wine_references", {
    p_wine_id: string(wineId), p_query: trimmed,
  }, options))
}

export async function getHouseholdWineIdentityStatus(wineId: string, options: Options = {}): Promise<HouseholdWineIdentityStatus> {
  return parseHouseholdWineIdentityStatus(await call("get_household_wine_identity_status", {
    p_wine_id: string(wineId),
  }, options), wineId)
}

export async function manageHouseholdWineIdentity(
  wineId: string,
  action: "link" | "remove",
  identity: SharedWineIdentity | null,
  expectedFingerprint: string,
  expectedReferenceId: string | null,
  options: Options = {},
): Promise<string | null> {
  if (action === "link" && !identity) throw new Error("Choose a shared wine")
  const expectedId = action === "link" ? identity?.referenceId ?? null : null
  const response = record(await call("manage_household_wine_identity", {
    p_wine_id: string(wineId),
    p_action: action,
    p_reference_id: expectedId,
    p_expected_fingerprint: string(expectedFingerprint),
    p_expected_reference_id: expectedReferenceId,
  }, options))
  if (response.wine_id !== wineId || response.reference_id !== expectedId ||
      response.reference_type !== (action === "link" ? identity?.referenceType : null) ||
      response.source_fingerprint !== expectedFingerprint) {
    throw new Error("Wine identity decision could not be confirmed")
  }
  return expectedId
}

export async function requestSharedWineIdentity(wineId: string, expectedFingerprint: string, options: Options = {}): Promise<string> {
  const response = record(await call("request_household_wine_identity", {
    p_wine_id: string(wineId), p_expected_fingerprint: string(expectedFingerprint),
  }, options))
  if (response.wine_id !== wineId) throw new Error("Wine identity request could not be confirmed")
  return string(response.request_id)
}
