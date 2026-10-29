import { parseDrinkingWindowReviewWorkspace } from "./drinkingWindowReview"

// An exchange package is research input, not a published reference. The
// browser sends only compact candidate claims; the source file stays local.
export interface ProducerCandidate {
  cuvee_id: string
  cuvee: string
  appellation: string
  region: string
  color: string
  vintage: number
  format_ml: number
  first_trial_year: number
  best_start_year: number
  best_end_year: number
  rationale: string
  confidence: string
  date_origin: string
  evidence_urls: string[]
  review_status: "candidate_not_approved"
}

export interface ProducerImportPreview {
  producer: string
  datasetVersion: string
  candidates: ProducerCandidate[]
}

interface RpcOptions {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected an object`)
  return value as Record<string, unknown>
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: expected a list`)
  return value
}

function required(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label}: missing or too long`)
  return value.trim()
}

function year(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1800 || (value as number) > 2300) {
    throw new Error(`${label}: invalid year`)
  }
  return value as number
}

function sourceIds(value: unknown, sources: Map<string, string>, label: string): string[] {
  const ids = list(value, label).map((id) => required(id, label, 120))
  if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !sources.has(id))) {
    throw new Error(`${label}: missing, duplicate or unknown source`)
  }
  return ids
}

export function previewProducerResearchPackage(input: unknown): ProducerImportPreview {
  const pack = record(input, "Package")
  const policy = record(pack.import_policy, "Import policy")
  if (pack.format !== "cellarmanager.producer_research" || pack.schema_version !== "1.1.0"
    || pack.status !== "draft_for_curator_review" || pack.scope !== "producer_independent_of_any_household"
    || policy.review_required !== true || policy.no_direct_production_publication !== true
    || policy.no_direct_household_inventory_write !== true) {
    throw new Error("Unsupported or unsafe producer exchange package")
  }
  const producerRecord = record(pack.producer, "Producer")
  const producer = required(producerRecord.name, "Producer")
  const datasetVersion = required(pack.dataset_version, "Dataset version", 80)
  const sources = new Map<string, string>()
  for (const sourceValue of list(pack.sources, "Sources")) {
    const source = record(sourceValue, "Source")
    const id = required(source.id, "Source ID", 120)
    const url = required(source.url, "Source URL", 1000)
    const reuse = record(source.reuse, "Source reuse policy")
    if (sources.has(id) || !url.startsWith("https://") || reuse.store_raw_content !== false
      || reuse.pointer_candidate_only !== true) throw new Error("Invalid source pointer or rights policy")
    sources.set(id, url)
  }
  sourceIds(producerRecord.source_ids, sources, "Producer sources")
  const cuvees = new Map<string, Record<string, unknown>>()
  for (const cuveeValue of list(pack.cuvees, "Cuvées")) {
    const cuvee = record(cuveeValue, "Cuvée")
    const id = required(cuvee.id, "Cuvée ID", 120)
    if (cuvees.has(id)) throw new Error(`Duplicate cuvée ID: ${id}`)
    required(cuvee.name, "Cuvée name")
    required(cuvee.appellation, "Appellation")
    required(cuvee.region, "Region")
    sourceIds(cuvee.source_ids, sources, `Cuvée ${id} sources`)
    cuvees.set(id, cuvee)
  }
  const releases = list(pack.exact_release_calibrations, "Release calibrations")
  if (!releases.length || releases.length > 100) throw new Error("A file must contain 1–100 release proposals")
  const keys = new Set<string>()
  const candidates = releases.map((releaseValue): ProducerCandidate => {
    const release = record(releaseValue, "Release")
    const cuveeId = required(release.cuvee_id, "Release cuvée ID", 120)
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(cuveeId)) throw new Error("Invalid local cuvée ID")
    const cuvee = cuvees.get(cuveeId)
    if (!cuvee) throw new Error(`Unknown cuvée: ${cuveeId}`)
    const vintage = year(release.vintage, "Vintage")
    const format = release.format_ml
    if (!Number.isInteger(format) || (format as number) < 50 || (format as number) > 30000) {
      throw new Error("Bottle size must be explicit")
    }
    const key = `${cuveeId}|${vintage}|${format}`
    if (keys.has(key)) throw new Error(`Duplicate release: ${key}`)
    keys.add(key)
    const existence = record(release.release_existence, "Release existence")
    if (existence.status !== "confirmed_by_named_vintage_source") throw new Error(`Unconfirmed release: ${key}`)
    const existenceUrls = sourceIds(existence.source_ids, sources, `Release ${key} existence`)
      .map((id) => sources.get(id)!)
    const declaredExistenceUrls = list(existence.source_urls, "Declared release source URLs")
    if (declaredExistenceUrls.length !== existenceUrls.length
      || existenceUrls.some((url) => !declaredExistenceUrls.includes(url))) {
      throw new Error(`Release existence source URL mismatch: ${key}`)
    }
    const proposal = record(release.proposal, "Proposal")
    if (proposal.review_status !== "candidate_not_approved") throw new Error(`Already-approved proposal: ${key}`)
    const first = year(proposal.first_trial_year, "Start tasting")
    const start = year(proposal.best_start_year, "Optimum start")
    const end = year(proposal.best_end_year, "Optimum end")
    if (first < vintage || first > start || start > end) throw new Error(`Unordered dates: ${key}`)
    const ids = sourceIds(proposal.supporting_source_ids, sources, `Release ${key} sources`)
    const urls = ids.map((id) => sources.get(id)!)
    const declaredUrls = list(proposal.supporting_source_urls, "Declared source URLs")
    if (declaredUrls.length !== urls.length || urls.some((url) => !declaredUrls.includes(url))) {
      throw new Error(`Source URL mismatch: ${key}`)
    }
    return {
      cuvee_id: cuveeId, cuvee: required(cuvee.name, "Cuvée name"),
      appellation: required(cuvee.appellation, "Appellation"),
      region: required(cuvee.region, "Region"),
      color: required(cuvee.color, "Color", 30), vintage, format_ml: format as number,
      first_trial_year: first, best_start_year: start, best_end_year: end,
      rationale: required(proposal.rationale, "Rationale", 2000),
      confidence: required(proposal.confidence, "Confidence", 30),
      date_origin: required(proposal.date_origin, "Date origin", 100),
      evidence_urls: urls, review_status: "candidate_not_approved",
    }
  })
  return { producer, datasetVersion, candidates }
}

export async function hashProducerPackage(contents: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contents))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function submitProducerResearchPackage(contents: string, options: RpcOptions = {}) {
  const preview = previewProducerResearchPackage(JSON.parse(contents) as unknown)
  const digest = await hashProducerPackage(contents)
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc("submit_drinking_window_producer_profile", {
    p_package_sha256: digest,
    p_producer_name: preview.producer,
    p_dataset_version: preview.datasetVersion,
    p_candidates: preview.candidates,
  })
  if (result.error) throw new Error(result.error.message)
  return { preview, digest, response: result.data }
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

export interface ProducerImportRecord {
  packageSha256: string
  producer: string
  datasetVersion: string
  candidateCount: number
}

export async function getProducerProfileImports(options: RpcOptions = {}): Promise<ProducerImportRecord[]> {
  const data = await call("get_drinking_window_producer_profile_imports", {}, options)
  if (!Array.isArray(data)) throw new Error("Invalid profile import list")
  return data.map((entry: unknown) => {
    const row = record(entry, "Profile import")
    if (typeof row.package_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.package_sha256)
      || !Number.isInteger(row.candidate_count) || (row.candidate_count as number) < 0) {
      throw new Error("Invalid profile import list")
    }
    return {
      packageSha256: row.package_sha256,
      producer: required(row.producer, "Producer"),
      datasetVersion: required(row.dataset_version, "Dataset version", 80),
      candidateCount: row.candidate_count as number,
    }
  })
}

export async function getProducerProfileCandidates(packageSha256: string, options: RpcOptions = {}) {
  if (!/^[0-9a-f]{64}$/.test(packageSha256)) throw new Error("Choose an imported profile")
  return parseDrinkingWindowReviewWorkspace(await call("get_drinking_window_producer_profile_candidates", {
    p_package_sha256: packageSha256,
  }, options))
}

export interface CanonicalReleaseOption {
  releaseId: string
  producer: string
  cuvee: string
  vintage: number
}

export async function searchProducerCandidateReleases(candidateId: string, query: string, options: RpcOptions = {}): Promise<CanonicalReleaseOption[]> {
  if (query.trim().length < 2) throw new Error("Search with at least two letters")
  const data = await call("search_drinking_window_producer_candidate_releases", {
    p_candidate_id: candidateId, p_query: query.trim(),
  }, options)
  if (!Array.isArray(data)) throw new Error("Invalid canonical release search")
  return data.map((entry: unknown) => {
    const row = record(entry, "Canonical release")
    return {
      releaseId: required(row.release_id, "Release ID", 50),
      producer: required(row.producer, "Producer"),
      cuvee: required(row.cuvee, "Cuvée"),
      vintage: year(row.vintage, "Vintage"),
    }
  })
}

export async function stageProducerCandidateIntoDraft(input: {
  candidateId: string
  expectedReviewId: string
  versionId: string
  releaseId: string
  identityReason: string
}, options: RpcOptions = {}) {
  if (input.identityReason.trim().length < 10) throw new Error("Explain the exact wine identity")
  const data = record(await call("stage_drinking_window_producer_candidate", {
    p_candidate_id: input.candidateId,
    p_expected_review_id: input.expectedReviewId,
    p_version_id: input.versionId,
    p_release_id: input.releaseId,
    p_identity_reason: input.identityReason.trim(),
  }, options), "Draft staging")
  return { rowId: required(data.row_id, "Reference row ID", 50),
    versionId: required(data.version_id, "Draft version ID", 50),
    alreadyStaged: data.already_staged === true }
}

export async function createCandidateRelease(input: {
  candidateId: string
  expectedReviewId: string
  producerId: string | null
  productId: string | null
  producerName: string
  productName: string
  identityReason: string
  confirmed: boolean
}, options: RpcOptions = {}) {
  if (!input.confirmed || input.identityReason.trim().length < 20) {
    throw new Error("Confirm the shared identity and explain why it is exact")
  }
  const data = record(await call("create_drinking_window_candidate_release", {
    p_candidate_id: input.candidateId,
    p_expected_review_id: input.expectedReviewId,
    p_producer_id: input.producerId,
    p_product_id: input.productId,
    p_producer_name: input.producerName.trim(),
    p_product_name: input.productName.trim(),
    p_identity_reason: input.identityReason.trim(),
    p_confirmed: input.confirmed,
  }, options), "Created canonical release")
  return {
    producerId: required(data.producer_id, "Producer ID", 50),
    productId: required(data.product_id, "Cuvée ID", 50),
    releaseId: required(data.release_id, "Release ID", 50),
    alreadyCreated: data.already_created === true,
  }
}
