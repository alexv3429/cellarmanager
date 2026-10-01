import { readFile } from "node:fs/promises"
import path from "node:path"

import { canonicalUuid, sha256, uuidV5, verifyArchive } from "./restore_metadata_lib.mjs"

const OBSERVATION_NAMESPACE = "9a7f1ad8-1737-52f5-966c-d53fcf328bbe"
const PROFILE_FIELDS = new Set([
  "composition:composition",
  "drinking_window:drinking_window",
  "identifiers:external_identifiers",
  "market_value:quick_sale_estimate",
  "market_value:replacement_value",
  "market_value:secondary_market_value",
  "maturity:maturity",
  "pairing:dish_pairings",
  "reviews:critical_reviews",
  "serving:serving_advice",
])

async function readRows(exportsDir, manifest, table) {
  const entry = manifest[table]
  if (!entry?.export_file) throw new Error(`Archive is missing ${table}`)
  const contents = await readFile(path.join(exportsDir, entry.export_file), "utf8")
  return contents.split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

function clean(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim().replace(/\s+/gu, " ")
  return text || null
}

function dateOnly(value) {
  const date = clean(value)?.slice(0, 10)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    && date >= "1900-01-01" && date <= new Date().toISOString().slice(0, 10)
    ? date : null
}

function safeUrl(value) {
  const raw = clean(value)
  if (!raw || raw.length > 2048) return null
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && url.username === "" && url.password === "" ? raw : null
  } catch {
    return null
  }
}

function identifierKey(wineId, scheme, value) {
  const normalizedScheme = String(scheme).normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en")
  return `${wineId}|${normalizedScheme}|${value}`
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function describeComposition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const parts = []
  if (Array.isArray(value.grapes)) {
    const grapes = value.grapes.map((grape) => {
      const name = clean(grape?.name)
      const share = Number(grape?.percentage)
      return name ? `${name}${Number.isFinite(share) && share > 0 && share <= 100 ? ` ${share}%` : ""}` : null
    }).filter(Boolean)
    if (grapes.length) parts.push(`grapes ${grapes.join(", ")}`)
  }
  for (const [label, field] of [["sweetness", "sweetness"], ["oak", "oak"]]) {
    if (clean(value[field])) parts.push(`${label} ${clean(value[field])}`)
  }
  const alcohol = Number(value.alcohol_percent)
  if (value.alcohol_percent !== null && Number.isFinite(alcohol) && alcohol > 0 && alcohol <= 30) {
    parts.push(`alcohol ${alcohol}%`)
  }
  if (Array.isArray(value.certifications) && value.certifications.length) {
    parts.push(`certifications ${value.certifications.map(clean).filter(Boolean).join(", ")}`)
  }
  return parts.length ? `Archived composition: ${parts.join("; ")}.` : null
}

function describeWindow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const after = Number(value.drink_after_year)
  const before = Number(value.drink_before_year)
  if (!Number.isInteger(after) || !Number.isInteger(before) || after < 1900 || before < after || before > 2200) return null
  return `Archived drinking window: ${after}–${before}.`
}

function describeMaturity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const state = clean(value.state)
  const rationale = clean(value.rationale)
  return state ? `Archived maturity assessment: ${state}${rationale ? ` — ${rationale}` : ""}.` : null
}

function describePairings(value) {
  if (!Array.isArray(value)) return null
  const dishes = value.map((item) => clean(item?.dish)).filter(Boolean)
  return dishes.length ? `Archived pairing examples: ${dishes.join("; ")}.` : null
}

function describeServing(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const parts = []
  const low = Number(value.temperature_min_c)
  const high = Number(value.temperature_max_c)
  if (value.temperature_min_c !== null && value.temperature_max_c !== null
    && Number.isFinite(low) && Number.isFinite(high) && low <= high) {
    parts.push(`${low}–${high} °C`)
  }
  const decant = Number(value.decant_minutes)
  if (value.decant_minutes !== null && Number.isFinite(decant) && decant > 0) parts.push(`decant ${decant} min`)
  const stand = Number(value.stand_upright_hours)
  if (value.stand_upright_hours !== null && Number.isFinite(stand) && stand > 0) parts.push(`stand upright ${stand} h`)
  if (clean(value.glass)) parts.push(`glass ${clean(value.glass)}`)
  if (clean(value.method)) parts.push(`method ${clean(value.method)}`)
  return parts.length ? `Archived serving notes: ${parts.join("; ")}.` : null
}

function describeReviews(value) {
  if (!Array.isArray(value) || value.length === 0) return null
  // Old review excerpts are not copied into the current cellar. Their count
  // points the owner back to the preserved private archive if needed.
  return `${value.length} archived critical-review references remain in the private source archive; excerpts are not restored.`
}

function profileValue(profile, field, blockers, wineId) {
  const entry = profile?.[field]
  if (entry === undefined) return null
  if (!entry || typeof entry !== "object" || !("value" in entry)) {
    blockers.push({ field, reason: "invalid-profile-entry", wineId })
    return null
  }
  return entry.value
}

function profileSummary(profile, blockers, wineId) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    blockers.push({ field: "profile_json", reason: "invalid-object", wineId })
    return []
  }
  for (const field of Object.keys(profile)) {
    if (!PROFILE_FIELDS.has(field)) blockers.push({ field, reason: "unknown-profile-field", wineId })
  }
  return [
    describeComposition(profileValue(profile, "composition:composition", blockers, wineId)),
    describeWindow(profileValue(profile, "drinking_window:drinking_window", blockers, wineId)),
    describeMaturity(profileValue(profile, "maturity:maturity", blockers, wineId)),
    describePairings(profileValue(profile, "pairing:dish_pairings", blockers, wineId)),
    describeServing(profileValue(profile, "serving:serving_advice", blockers, wineId)),
    describeReviews(profileValue(profile, "reviews:critical_reviews", blockers, wineId)),
  ].filter(Boolean)
}

export async function buildLegacyEnrichmentPlan({ archiveDir, expectedSourceSha256 }) {
  const { exportsDir, importPlan, manifest } = await verifyArchive(archiveDir, expectedSourceSha256)
  const [wines, identifiers, profiles, sources] = await Promise.all([
    readRows(exportsDir, manifest, "wines"),
    readRows(exportsDir, manifest, "wine_external_identifiers"),
    readRows(exportsDir, manifest, "wine_enrichment_profiles"),
    readRows(exportsDir, manifest, "enrichment_sources"),
  ])
  const blockers = []
  const wineIds = new Set(wines.map((wine) => canonicalUuid(wine.id)))
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const byWine = new Map()
  const tableIdentifierKeys = new Set()
  const getWine = (wineId) => {
    const id = canonicalUuid(wineId)
    if (!wineIds.has(id)) blockers.push({ field: "wine_id", reason: "unknown-wine", wineId: id })
    if (!byWine.has(id)) byWine.set(id, { identifiers: [], profile: null, dates: [] })
    return [id, byWine.get(id)]
  }

  for (const identifier of identifiers) {
    const [wineId, group] = getWine(identifier.wine_id)
    const scheme = clean(identifier.scheme)
    const value = clean(identifier.value)
    const source = sourceById.get(identifier.source_id)
    const url = safeUrl(source?.url)
    const confidence = Number(identifier.confidence)
    if (!scheme || scheme.length > 120 || !value || value.length > 200
      || !source || !url || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      blockers.push({ field: "external_identifier", reason: "invalid-entry", wineId })
      continue
    }
    const updated = dateOnly(identifier.updated_at)
    if (!updated) blockers.push({ field: "external_identifier", reason: "invalid-date", wineId })
    else group.dates.push(updated)
    group.identifiers.push({ scheme, value, url })
    tableIdentifierKeys.add(identifierKey(wineId, scheme, value))
  }

  for (const record of profiles) {
    const [wineId, group] = getWine(record.wine_id)
    if (group.profile) {
      blockers.push({ field: "profile_json", reason: "duplicate-wine", wineId })
      continue
    }
    try {
      group.profile = typeof record.profile_json === "string" ? JSON.parse(record.profile_json) : record.profile_json
    } catch {
      blockers.push({ field: "profile_json", reason: "invalid-json", wineId })
    }
    const updated = dateOnly(record.updated_at)
    if (!updated) blockers.push({ field: "profile_json", reason: "invalid-date", wineId })
    else group.dates.push(updated)
  }

  const rows = []
  let profileIdentifierCandidates = 0
  let profileOnlyIdentifiers = 0
  for (const [wineId, group] of [...byWine.entries()].sort(([a], [b]) => compareText(a, b))) {
    const lines = [
      "Archived v0.1 enrichment (historical reference only; not used for current wine facts, recommendations, or stock).",
      `Verified source archive: ${expectedSourceSha256}.`,
    ]
    if (group.identifiers.length) {
      lines.push("Archived external identifiers (retailer/reference codes, not bottle barcodes):")
      for (const identifier of group.identifiers.sort((a, b) => compareText(a.scheme, b.scheme) || compareText(a.value, b.value))) {
        lines.push(`- ${identifier.scheme}: ${identifier.value} (source: ${identifier.url})`)
      }
    }
    if (group.profile) {
      lines.push(...profileSummary(group.profile, blockers, wineId))
      const candidates = profileValue(group.profile, "identifiers:external_identifiers", blockers, wineId)
      if (candidates !== null && !Array.isArray(candidates)) {
        blockers.push({ field: "identifiers:external_identifiers", reason: "not-an-array", wineId })
      } else for (const candidate of candidates ?? []) {
        if (!candidate || !clean(candidate.scheme) || !clean(candidate.value)) {
          blockers.push({ field: "identifiers:external_identifiers", reason: "invalid-candidate", wineId })
          continue
        }
        profileIdentifierCandidates += 1
        if (!tableIdentifierKeys.has(identifierKey(wineId, candidate.scheme, candidate.value))) profileOnlyIdentifiers += 1
      }
    }
    const note = lines.join("\n")
    if (note.length > 5000) blockers.push({ field: "observation_note", reason: "over-5000", wineId })
    const date = group.dates.sort().at(-1)
    if (!date) blockers.push({ field: "observation_date", reason: "missing", wineId })
    rows.push({
      wine_id: wineId,
      observation_date: date ?? null,
      observation_id: uuidV5(OBSERVATION_NAMESPACE, `${expectedSourceSha256}|${wineId}|enrichment-archive`),
      observation_note: note,
    })
  }

  const report = {
    blockers,
    deferred: {
      market_profile_values: profiles.reduce((count, record) => {
        try {
          return count + Object.keys(JSON.parse(record.profile_json)).filter((key) => key.startsWith("market_value:")).length
        } catch { return count }
      }, 0),
      profile_identifier_candidates: profileIdentifierCandidates,
      profile_only_identifiers: profileOnlyIdentifiers,
    },
    external_identifiers: identifiers.length,
    legacy_profiles: profiles.length,
    observations: rows.length,
    proposed_wines: rows.length,
    source: { archive_source_sha256: expectedSourceSha256, ready_to_apply: importPlan.ready_to_apply, wines: wines.length },
  }
  const body = { report, rows }
  return { ...body, plan_sha256: sha256(JSON.stringify(body)) }
}
