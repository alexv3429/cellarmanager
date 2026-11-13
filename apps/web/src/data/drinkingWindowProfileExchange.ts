import Ajv2020 from "ajv/dist/2020.js"

import placeSchema from "../../../../docs/schemas/place_exchange_v1.schema.json"
import producerSchema from "../../../../docs/schemas/producer_exchange_v1.schema.json"

export type ProfileKind = "producer" | "appellation" | "region"

export interface FullProfilePreview {
  kind: ProfileKind
  name: string
  datasetVersion: string
  releaseCount: number
  factCount: number
  sourceCount: number
  document: Record<string, unknown>
}

export interface FullProfileImport {
  id: string
  documentSha256: string
  kind: ProfileKind
  name: string
  schemaVersion: string
  datasetVersion: string
  releaseCount: number
  submittedAt: string
}

export interface ProfileStageItem {
  key: string
  status: "ready" | "unchanged" | "quarantined"
  reason: string | null
  rationale: string | null
  name: string
  canonicalId: string | null
  firstTrialYear: number | null
  bestStartYear: number | null
  bestEndYear: number | null
  sourceUrls: string[]
  children: ProfileStageItem[]
}

export interface ProfileStagePreview {
  profileId: string
  versionId: string
  previewSha256: string
  items: ProfileStageItem[]
  ready: number
  unchanged: number
  quarantined: number
}

export interface ProfileStageResult {
  staged: number
  unchanged: number
  quarantined: number
  published: false
}

export interface ProfileIdentityMap {
  producer_id?: string
  cuvees?: Record<string, string>
  regions?: Record<string, string>
  appellations?: Record<string, string>
  release_appellations?: Record<string, string>
}

export interface ProfileIdentitySuggestions {
  map: ProfileIdentityMap
  producerMatches: number
  ambiguousCuvees: string[]
}

export async function getReviewedProfileMappings(profile: FullProfileImport,
  options: RpcOptions = {}): Promise<ProfileIdentityMap> {
  if (profile.kind !== "producer") throw new Error("Choose a producer profile")
  const result = object(await call("get_reviewed_profile_identity_mappings", {
    p_id: profile.id,
  }, options), "Reviewed profile mappings")
  const mappings: ProfileIdentityMap = {}
  if (result.producer_id !== undefined) mappings.producer_id = string(result.producer_id, "Shared producer ID")
  for (const key of ["cuvees", "regions", "appellations", "release_appellations"] as const) {
    if (result[key] === undefined) continue
    mappings[key] = Object.fromEntries(Object.entries(object(result[key], "Reviewed mappings"))
      .map(([source, target]) => [string(source, "Profile identity"), string(target, "Shared identity")]))
  }
  return mappings
}

export interface ProfilePlaceSuggestion {
  kind: "region" | "appellation"
  sourceName: string
  targetId: string
  targetName: string
  reason: "parent_region_prefix" | "premier_cru_spelling" | "existing_place_alias"
    | "classification_parent_appellation"
}

export interface ProfilePlaceSuggestions {
  regions: ProfilePlaceSuggestion[]
  appellations: ProfilePlaceSuggestion[]
}

export interface ProfileIdentityEntry {
  key: string
  cuveeId: string | null
  cuveeName: string | null
  vintage: number | null
  productStatus: "existing" | "create" | "blocked"
  releaseStatus: "existing" | "create" | "blocked"
  sourceUrls: string[]
  reason: string | null
}

export interface ProfileIdentityBatchPreview {
  profileId: string
  planSha256: string
  status: "ready" | "blocked"
  producerName: string
  producerStatus: "existing" | "create" | "blocked"
  entries: ProfileIdentityEntry[]
}

export interface ProfileIdentityBatchResult {
  createdProducers: number
  createdProducts: number
  createdReleases: number
  datesStaged: 0
  winesLinked: 0
  published: false
}

interface RpcOptions {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

const ajv = new Ajv2020({ allErrors: true, strict: false })
ajv.addFormat("date", {
  type: "string",
  validate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return false
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  },
})
ajv.addFormat("uri", {
  type: "string",
  validate(value: string) {
    try { return new URL(value).protocol === "https:" } catch { return false }
  },
})
const validateProducer = ajv.compile(producerSchema)
const validatePlace = ajv.compile(placeSchema)

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: expected a list`)
  return value
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}: expected text`)
  return value.trim()
}

function checkSources(ids: unknown, sources: Set<string>, label: string) {
  const values = array(ids, label).map((id) => string(id, label))
  if (!values.length || new Set(values).size !== values.length || values.some((id) => !sources.has(id))) {
    throw new Error(`${label}: missing, duplicate or unknown source ID`)
  }
}

function schemaError(label: string, errors: typeof validateProducer.errors) {
  const first = errors?.[0]
  const field = first?.params && ("missingProperty" in first.params ? first.params.missingProperty
    : "additionalProperty" in first.params ? first.params.additionalProperty : "")
  return new Error(`${label}: ${first?.instancePath || "$"}${field ? `/${field}` : ""} ${first?.message || "is invalid"}`)
}

// An omitted optional description and an empty one mean the same thing in an
// exchange file. Keep the strict schema for non-empty values, but do not make
// a whole research package unusable because an optional field was left blank.
// Never repair identity, source, release or date fields here.
function omitEmptyOptionalProducerDescriptions(document: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(document.cuvees)) return document
  return {
    ...document,
    cuvees: document.cuvees.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value
      const cuvee = { ...value } as Record<string, unknown>
      for (const field of ["site_description", "style_summary", "grape"]) {
        if (cuvee[field] === "") delete cuvee[field]
      }
      return cuvee
    }),
  }
}

function validateProducerCrossReferences(document: Record<string, unknown>): FullProfilePreview {
  const producer = object(document.producer, "Producer")
  const cuvees = array(document.cuvees, "Cuvées").map((value) => object(value, "Cuvée"))
  const sources = array(document.sources, "Sources").map((value) => object(value, "Source"))
  const sourceIds = new Set(sources.map((source) => string(source.id, "Source ID")))
  const sourceUrls = new Map(sources.map((source) => [string(source.id, "Source ID"), string(source.url, "Source URL")]))
  if (sourceIds.size !== sources.length) throw new Error("Sources: duplicate ID")
  for (const source of sources) {
    const reuse = object(source.reuse, "Source reuse")
    if (reuse.store_raw_content !== false || reuse.pointer_candidate_only !== true) {
      throw new Error("Sources: source rights cannot authorize raw content or publication")
    }
  }
  checkSources(producer.source_ids, sourceIds, "Producer sources")
  const cuveeIds = new Set<string>()
  for (const cuvee of cuvees) {
    const id = string(cuvee.id, "Cuvée ID")
    if (cuveeIds.has(id)) throw new Error(`Duplicate cuvée ID: ${id}`)
    cuveeIds.add(id)
    checkSources(cuvee.source_ids, sourceIds, `Cuvée ${id} sources`)
    for (const history of array(cuvee.name_history ?? [], "Name history")) {
      checkSources(object(history, "Name history").source_ids, sourceIds, `Cuvée ${id} name history`)
    }
  }
  const releases = array(document.exact_release_calibrations, "Releases")
  const releaseKeys = new Set<string>()
  for (const item of releases) {
    const release = object(item, "Release")
    const id = string(release.cuvee_id, "Release cuvée")
    if (!cuveeIds.has(id)) throw new Error(`Release: unknown cuvée ${id}`)
    const key = `${id}|${release.vintage}|${release.format_ml}`
    if (releaseKeys.has(key)) throw new Error(`Duplicate release: ${key}`)
    releaseKeys.add(key)
    const existence = object(release.release_existence, "Release existence")
    const proposal = object(release.proposal, "Release proposal")
    checkSources(existence.source_ids, sourceIds, `Release ${key} existence sources`)
    checkSources(proposal.supporting_source_ids, sourceIds, `Release ${key} date sources`)
    const linkedUrls = new Set(array(proposal.supporting_source_ids, "Release source IDs")
      .map((sourceId) => sourceUrls.get(String(sourceId))))
    const proposedUrls = array(proposal.supporting_source_urls, "Release source URLs")
    if (!proposedUrls.length || proposedUrls.some((url) => !linkedUrls.has(String(url)))) {
      throw new Error(`Release ${key}: every context URL must belong to a cited source ID`)
    }
    const years = [release.vintage, proposal.first_trial_year, proposal.best_start_year, proposal.best_end_year]
    if (years.some((year) => !Number.isInteger(year)) || years.some((year, index) => index > 0 && (year as number) < (years[index - 1] as number))) {
      throw new Error(`Release ${key}: three years must be ordered`)
    }
  }
  for (const key of ["vintage_effects", "known_nonproduced_releases", "external_drinking_observations", "structure_profiles", "pairing_profiles", "source_discrepancies"]) {
    for (const entry of array(document[key] ?? [], key)) {
      const value = object(entry, key)
      if (value.source_ids) checkSources(value.source_ids, sourceIds, `${key} sources`)
      if (value.source_id && !sourceIds.has(string(value.source_id, `${key} source`))) throw new Error(`${key}: unknown source ID`)
      if (value.cuvee_id && !cuveeIds.has(string(value.cuvee_id, `${key} cuvée`))) throw new Error(`${key}: unknown cuvée ID`)
      for (const dish of array(value.pairings ?? [], `${key} pairings`)) {
        checkSources(object(dish, "Pairing").source_ids, sourceIds, `${key} pairing sources`)
      }
    }
  }
  return {
    kind: "producer", name: string(producer.name, "Producer name"),
    datasetVersion: string(document.dataset_version, "Dataset version"),
    releaseCount: releases.length,
    factCount: cuvees.length + array(document.structure_profiles ?? [], "Structure profiles").length
      + array(document.pairing_profiles ?? [], "Pairing profiles").length,
    sourceCount: sources.length, document,
  }
}

function validatePlaceCrossReferences(document: Record<string, unknown>): FullProfilePreview {
  const place = object(document.place, "Place")
  const kind = document.profile_kind as "appellation" | "region"
  const sources = array(document.sources, "Sources").map((value) => object(value, "Source"))
  const sourceIds = new Set(sources.map((source) => string(source.id, "Source ID")))
  if (sourceIds.size !== sources.length) throw new Error("Sources: duplicate ID")
  checkSources(place.source_ids, sourceIds, "Place sources")
  const groups = array(document.ageing_groups, "Ageing groups")
  const groupIds = new Set<string>()
  let releaseCount = 0
  for (const item of groups) {
    const group = object(item, "Ageing group")
    const id = string(group.id, "Ageing group ID")
    if (groupIds.has(id)) throw new Error(`Duplicate ageing group: ${id}`)
    groupIds.add(id)
    checkSources(group.source_ids, sourceIds, `Group ${id} sources`)
    for (const item of array(group.members, `Group ${id} members`)) {
      const member = object(item, "Member")
      if (member.kind === "release" && !Number.isInteger(member.vintage)) throw new Error(`Group ${id}: exact release needs a vintage`)
      if (member.kind !== "release" && member.vintage !== undefined) throw new Error(`Group ${id}: vintage only belongs to a release`)
      if (member.first_vintage !== undefined && member.last_vintage !== undefined
        && (member.first_vintage as number) > (member.last_vintage as number)) throw new Error(`Group ${id}: inverted membership range`)
      checkSources(member.source_ids, sourceIds, `Group ${id} membership sources`)
    }
    const vintages = new Set<number>()
    for (const item of array(group.windows, `Group ${id} windows`)) {
      const window = object(item, "Window")
      const vintage = window.vintage as number
      if (vintages.has(vintage)) throw new Error(`Group ${id}: duplicate vintage ${vintage}`)
      vintages.add(vintage)
      const years = [vintage, window.first_trial_year, window.best_start_year, window.best_end_year]
      if (years.some((year, index) => index > 0 && (year as number) < (years[index - 1] as number))) {
        throw new Error(`Group ${id}: three years must be ordered`)
      }
      checkSources(window.source_ids, sourceIds, `Group ${id} window sources`)
      releaseCount++
    }
  }
  for (const item of array(document.facts, "Facts")) checkSources(object(item, "Fact").source_ids, sourceIds, "Fact sources")
  return {
    kind, name: string(place.name, "Place name"),
    datasetVersion: string(document.dataset_version, "Dataset version"),
    releaseCount, factCount: array(document.facts, "Facts").length,
    sourceCount: sources.length, document,
  }
}

export function previewFullProfileExchange(input: unknown): FullProfilePreview {
  const document = object(input, "Profile")
  if (document.format === "cellarmanager.producer_research") {
    const normalized = omitEmptyOptionalProducerDescriptions(document)
    if (!validateProducer(normalized)) throw schemaError("Producer profile", validateProducer.errors)
    return validateProducerCrossReferences(normalized)
  }
  if (document.format === "cellarmanager.place_profile") {
    if (!validatePlace(document)) throw schemaError("Place profile", validatePlace.errors)
    return validatePlaceCrossReferences(document)
  }
  throw new Error("Unsupported profile exchange format")
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

export async function importFullProfileExchange(input: unknown, options: RpcOptions = {}): Promise<FullProfileImport> {
  const preview = previewFullProfileExchange(input)
  const response = object(await call("import_drinking_window_profile_exchange", {
    p_document: preview.document,
  }, options), "Profile import")
  return parseImport(response)
}

function parseImport(value: unknown): FullProfileImport {
  const item = object(value, "Profile import")
  const kind = item.profile_kind
  if (kind !== "producer" && kind !== "appellation" && kind !== "region") throw new Error("Invalid profile kind")
  const hash = string(item.document_sha256, "Profile hash")
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid profile hash")
  return {
    id: string(item.id, "Profile ID"), documentSha256: hash,
    kind, name: string(item.profile_name, "Profile name"),
    schemaVersion: typeof item.schema_version === "string" ? item.schema_version : "",
    datasetVersion: string(item.dataset_version, "Dataset version"),
    releaseCount: typeof item.release_count === "number" ? item.release_count : 0,
    submittedAt: typeof item.submitted_at === "string" ? item.submitted_at : "",
  }
}

export async function listFullProfileExchanges(options: RpcOptions = {}): Promise<FullProfileImport[]> {
  const value = await call("list_drinking_window_profile_exchanges", {}, options)
  if (!Array.isArray(value)) throw new Error("Invalid profile import list")
  return value.map(parseImport)
}

export async function exportFullProfileExchange(id: string, options: RpcOptions = {}): Promise<Record<string, unknown>> {
  return object(await call("export_drinking_window_profile_exchange", { p_id: id }, options), "Profile export")
}

export async function suggestProfileIdentities(profile: FullProfileImport,
  options: RpcOptions = {}): Promise<ProfileIdentitySuggestions> {
  if (profile.kind !== "producer") throw new Error("Choose a producer profile")
  const result = object(await call("suggest_drinking_window_profile_identities", {
    p_id: profile.id,
  }, options), "Identity suggestions")
  if (result.profile_id !== profile.id || result.published !== false || result.wines_linked !== 0 ||
      !Number.isInteger(result.producer_matches) || (result.producer_matches as number) < 0 ||
      !Array.isArray(result.ambiguous_cuvees)) throw new Error("Invalid identity suggestions")
  const cuvees = object(result.cuvees, "Cuvée suggestions")
  const mapped = Object.fromEntries(Object.entries(cuvees).map(([source, target]) => [
    string(source, "Profile cuvée ID"), string(target, "Shared cuvée ID"),
  ]))
  const producerId = result.producer_id === null ? undefined : string(result.producer_id, "Shared producer ID")
  if ((result.producer_matches === 1) !== Boolean(producerId) || (!producerId && Object.keys(mapped).length)) {
    throw new Error("Invalid producer suggestions")
  }
  return { map: { ...(producerId ? { producer_id: producerId } : {}),
    ...(Object.keys(mapped).length ? { cuvees: mapped } : {}) },
    producerMatches: result.producer_matches as number,
    ambiguousCuvees: result.ambiguous_cuvees.map((value) => string(value, "Ambiguous cuvée")),
  }
}

export async function suggestProfilePlaces(profile: FullProfileImport,
  options: RpcOptions = {}): Promise<ProfilePlaceSuggestions> {
  if (profile.kind !== "producer") throw new Error("Choose a producer profile")
  const result = object(await call("suggest_drinking_window_profile_places", {
    p_id: profile.id,
  }, options), "Place suggestions")
  function parse(items: unknown, kind: "region" | "appellation"): ProfilePlaceSuggestion[] {
    if (!Array.isArray(items)) throw new Error("Invalid place suggestions")
    return items.map((value: unknown) => {
      const item = object(value, "Place suggestion")
      if (item.kind !== kind || (item.reason !== "parent_region_prefix"
        && item.reason !== "premier_cru_spelling"
        && item.reason !== "existing_place_alias"
        && item.reason !== "classification_parent_appellation")) throw new Error("Invalid place suggestion")
      return {
        kind, sourceName: string(item.source_name, "Source place"),
        targetId: string(item.target_id, "Shared place ID"),
        targetName: string(item.target_name, "Shared place"), reason: item.reason,
      }
    })
  }
  return { regions: parse(result.regions, "region"),
    appellations: parse(result.appellations, "appellation") }
}

function identityStatus(value: unknown): "existing" | "create" | "blocked" {
  if (value === "existing" || value === "create" || value === "blocked") return value
  throw new Error("Invalid identity status")
}

export interface ProfileLwinCandidate {
  lwin7: string
  name: string
  producer: string
  region: string | null
  appellation: string | null
  site: string | null
  parcel: string | null
  color: string | null
  classification: string | null
}

export async function searchProfileLwin(profileId: string, cuveeId: string, producerId: string,
  query: string, options: RpcOptions = {}): Promise<ProfileLwinCandidate[]> {
  if (!profileId || !cuveeId || !producerId || query.trim().length < 3) throw new Error("Choose a profile, producer and search term")
  const result = await call("search_drinking_window_profile_lwin", {
    p_profile_id: profileId, p_cuvee_id: cuveeId, p_producer_id: producerId, p_query: query.trim(),
  }, options)
  if (!Array.isArray(result)) throw new Error("Invalid LWIN search response")
  return result.map((value: unknown) => {
    const item = object(value, "LWIN candidate")
    const lwin7 = string(item.lwin7, "LWIN7")
    if (!/^\d{7}$/.test(lwin7)) throw new Error("Invalid LWIN7")
    return { lwin7, name: string(item.name, "LWIN wine"), producer: string(item.producer, "LWIN producer"),
      region: optionalText(item.region), appellation: optionalText(item.appellation),
      site: optionalText(item.site), parcel: optionalText(item.parcel),
      color: optionalText(item.color), classification: optionalText(item.classification) }
  })
}

export async function reuseProfileLwin(profileId: string, cuveeId: string, producerId: string,
  lwin7: string, reason: string, confirmed: boolean, options: RpcOptions = {}): Promise<string> {
  if (!profileId || !cuveeId || !producerId || !/^\d{7}$/.test(lwin7)
    || !confirmed || reason.trim().length < 30) throw new Error("Review and confirm the LWIN wine identity")
  const result = object(await call("reuse_drinking_window_profile_lwin", {
    p_profile_id: profileId, p_cuvee_id: cuveeId, p_producer_id: producerId,
    p_lwin7: lwin7, p_reason: reason.trim(), p_confirmed: true,
  }, options), "LWIN reuse")
  if (result.lwin7 !== lwin7 || result.dates_staged !== 0 || result.wines_linked !== 0 || result.published !== false) {
    throw new Error("Invalid LWIN reuse response")
  }
  return string(result.product_id, "Shared product ID")
}

export async function previewProfileIdentityBatch(profile: FullProfileImport, identityMap: ProfileIdentityMap,
  releaseKeys: string[], options: RpcOptions = {}): Promise<ProfileIdentityBatchPreview> {
  if (profile.kind !== "producer" || !releaseKeys.length || releaseKeys.length > 100) {
    throw new Error("Select producer-profile releases for identity review")
  }
  const result = object(await call("preview_drinking_window_profile_identity_batch", {
    p_id: profile.id, p_identity_map: identityMap, p_release_keys: releaseKeys,
  }, options), "Identity batch preview")
  const hash = string(result.plan_sha256, "Identity plan hash")
  if (!/^[0-9a-f]{64}$/.test(hash) || !Array.isArray(result.entries)
    || (result.status !== "ready" && result.status !== "blocked")) {
    throw new Error("Invalid identity batch preview")
  }
  return {
    profileId: string(result.profile_id, "Profile ID"), planSha256: hash,
    status: result.status, producerName: string(result.producer_name, "Producer name"),
    producerStatus: identityStatus(result.producer_status),
    entries: result.entries.map((value: unknown) => {
      const item = object(value, "Identity entry")
      return {
        key: string(item.key, "Release key"), cuveeId: optionalText(item.cuvee_id),
        cuveeName: optionalText(item.cuvee_name), vintage: integer(item.vintage),
        productStatus: identityStatus(item.product_status),
        releaseStatus: identityStatus(item.release_status), sourceUrls: urls(item.source_urls),
        reason: optionalText(item.reason),
      }
    }),
  }
}

export async function createProfileIdentityBatch(profile: FullProfileImport, identityMap: ProfileIdentityMap,
  releaseKeys: string[], preview: ProfileIdentityBatchPreview, reviewReason: string,
  confirmed: boolean, options: RpcOptions = {}): Promise<ProfileIdentityBatchResult> {
  if (profile.kind !== "producer" || preview.profileId !== profile.id || preview.status !== "ready"
    || !confirmed || reviewReason.trim().length < 30) {
    throw new Error("Review and confirm the selected shared wine identities")
  }
  const result = object(await call("create_drinking_window_profile_identity_batch", {
    p_id: profile.id, p_identity_map: identityMap, p_release_keys: releaseKeys,
    p_expected_plan_sha256: preview.planSha256,
    p_review_reason: reviewReason.trim(), p_confirmed: true,
  }, options), "Identity batch result")
  const counts = [result.created_producers, result.created_products, result.created_releases]
  if (!counts.every((count) => Number.isInteger(count) && (count as number) >= 0)
    || result.dates_staged !== 0 || result.wines_linked !== 0 || result.published !== false) {
    throw new Error("Invalid identity batch result")
  }
  return {
    createdProducers: counts[0] as number, createdProducts: counts[1] as number,
    createdReleases: counts[2] as number, datesStaged: 0, winesLinked: 0, published: false,
  }
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && /^\d{4}$/.test(value)) return Number(value)
  return null
}

function urls(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string") : []
}

export async function previewProfileStaging(profile: FullProfileImport, versionId: string,
  identityMap: ProfileIdentityMap = {},
  options: RpcOptions = {}): Promise<ProfileStagePreview> {
  const response = object(await call(profile.kind === "producer"
    ? "preview_drinking_window_profile_exchange"
    : "preview_selectable_drinking_window_place_profile", {
    p_id: profile.id, p_version_id: versionId,
    ...(profile.kind === "producer" ? { p_identity_map: identityMap } : {}),
  }, options), "Profile staging preview")
  const sha = string(response.preview_sha256, "Preview hash")
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("Invalid staging preview hash")
  const source = profile.kind === "producer" ? response.rows : response.groups
  if (!Array.isArray(source)) throw new Error("Invalid staging preview items")
  const items: ProfileStageItem[] = source.map((value: unknown) => {
    const item = object(value, "Profile staging item")
    if (item.status !== "ready" && item.status !== "unchanged" && item.status !== "quarantined") {
      throw new Error("Invalid staging status")
    }
    const windows = Array.isArray(item.windows) ? item.windows : []
    const members = Array.isArray(item.members) ? item.members : []
    return {
      key: string(item.key, "Staging key"), status: item.status,
      reason: optionalText(item.reason), rationale: optionalText(item.rationale ?? item.definition),
      name: profile.kind === "producer"
        ? `${optionalText(item.cuvee) || "?"} · ${optionalText(item.vintage) || "?"} · ${optionalText(item.format_ml) || "?"} ml`
        : `${optionalText(item.name) || "?"} · ${optionalText(item.color) || "?"}`,
      canonicalId: optionalText(profile.kind === "producer" ? item.release_id : item.existing_group_id),
      firstTrialYear: integer(item.first_trial_year), bestStartYear: integer(item.best_start_year),
      bestEndYear: integer(item.best_end_year), sourceUrls: urls(item.source_urls),
      children: [...members.map((value: unknown, index: number) => {
        const member = object(value, "Place member")
        return {
          key: `${item.key}:member:${index}`, status: item.status as ProfileStageItem["status"],
          reason: optionalText(member.reason), rationale: optionalText(member.rationale),
          name: `${optionalText(member.kind) || "?"} · ${optionalText(member.name) || "?"}`,
          canonicalId: optionalText(member.target_id),
          firstTrialYear: null, bestStartYear: null, bestEndYear: null,
          sourceUrls: urls(member.source_urls), children: [],
        }
      }), ...windows.map((value: unknown) => {
        const window = object(value, "Place window")
        const selectionStatus = window.selection_status ?? item.status
        if (selectionStatus !== "ready" && selectionStatus !== "unchanged" && selectionStatus !== "quarantined") {
          throw new Error("Invalid window selection status")
        }
        return {
          key: `${item.key}:${window.vintage}`, status: selectionStatus as ProfileStageItem["status"],
          reason: optionalText(item.reason), rationale: optionalText(window.rationale),
          name: String(window.vintage), canonicalId: null,
          firstTrialYear: integer(window.first_trial_year), bestStartYear: integer(window.best_start_year),
          bestEndYear: integer(window.best_end_year), sourceUrls: urls(window.source_urls), children: [],
        }
      })],
    }
  })
  return {
    profileId: string(response.profile_id, "Profile ID"),
    versionId: string(response.version_id, "Version ID"), previewSha256: sha, items,
    ready: items.filter((item) => item.status === "ready").length,
    unchanged: items.filter((item) => item.status === "unchanged").length,
    quarantined: items.filter((item) => item.status === "quarantined").length,
  }
}

export async function stageProfileExchange(profile: FullProfileImport, preview: ProfileStagePreview,
  reviewReason: string, adoptAndShare: boolean, identityMap: ProfileIdentityMap = {},
  options: RpcOptions = {}): Promise<ProfileStageResult> {
  if (!adoptAndShare || reviewReason.trim().length < 30 || !preview.ready) {
    throw new Error("Review the ready rows and explicitly authorize their shared editorial estimates")
  }
  const result = object(await call(profile.kind === "producer"
    ? "stage_drinking_window_profile_exchange"
    : "stage_drinking_window_place_profile_exchange", {
    p_id: profile.id, p_version_id: preview.versionId,
    p_expected_preview_sha256: preview.previewSha256,
    p_review_reason: reviewReason.trim(), p_adopt_and_share: true,
    ...(profile.kind === "producer" ? { p_identity_map: identityMap } : {}),
  }, options), "Profile staging result")
  const staged = result.staged ?? result.staged_groups
  const unchanged = result.unchanged ?? result.unchanged_groups
  const quarantined = result.quarantined ?? result.quarantined_groups
  if (![staged, unchanged, quarantined].every((count) => Number.isInteger(count))) {
    throw new Error("Invalid staging result")
  }
  return { staged: staged as number, unchanged: unchanged as number,
    quarantined: quarantined as number, published: false }
}

export async function stageSelectedProfileWindows(profile: FullProfileImport, preview: ProfileStagePreview,
  reviewReason: string, adoptAndShare: boolean, identityMap: ProfileIdentityMap,
  selectedKeys: string[], options: RpcOptions = {}): Promise<ProfileStageResult> {
  const selectable = profile.kind === "producer" ? preview.items : preview.items.flatMap((item) => item.children)
  if (!adoptAndShare || reviewReason.trim().length < 30
      || !selectedKeys.length || new Set(selectedKeys).size !== selectedKeys.length
      || selectedKeys.some((key) => !selectable.some((item) => item.key === key && item.status === "ready"
        && (profile.kind === "producer" || item.firstTrialYear !== null)))) {
    throw new Error("Review the selected ready rows and explicitly authorize their shared editorial estimates")
  }
  const result = object(await call(profile.kind === "producer"
    ? "stage_selected_drinking_window_profile_exchange" : "stage_selected_drinking_window_place_profile", {
    p_id: profile.id, p_version_id: preview.versionId,
    p_expected_preview_sha256: preview.previewSha256, p_review_reason: reviewReason.trim(),
    p_adopt_and_share: true, p_selected_keys: selectedKeys,
    ...(profile.kind === "producer" ? { p_identity_map: identityMap } : {}),
  }, options), "Profile staging result")
  if (![result.staged, result.unchanged, result.quarantined].every((count) => Number.isInteger(count))) {
    throw new Error("Invalid staging result")
  }
  return { staged: result.staged as number, unchanged: result.unchanged as number,
    quarantined: result.quarantined as number, published: false }
}
