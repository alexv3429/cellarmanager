import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

const OBSERVATION_NAMESPACE = "9a7f1ad8-1737-52f5-966c-d53fcf328bbe"

const SWEETNESS_ALIASES = new Map([
  ["bone-dry", "bone-dry"],
  ["bone dry", "bone-dry"],
  ["dry", "dry"],
  ["sec", "dry"],
  ["off-dry", "off-dry"],
  ["off dry", "off-dry"],
  ["demi-sec", "off-dry"],
  ["medium-sweet", "medium-sweet"],
  ["medium sweet", "medium-sweet"],
  ["moelleux", "medium-sweet"],
  ["sweet", "sweet"],
  ["doux", "sweet"],
  ["liquoreux", "sweet"],
])

const FACT_FIELDS = [
  "country",
  "area",
  "classification",
  "vineyard",
  "grape_composition",
  "sweetness_category",
  "alcohol_percent",
  "certifications",
]

function cleanText(value) {
  if (value === null || value === undefined) {
    return null
  }

  const cleaned = String(value).trim().replace(/\s+/gu, " ")
  return cleaned.length > 0 ? cleaned : null
}

export function canonicalUuid(value) {
  const compact = String(value ?? "")
    .trim()
    .replaceAll("-", "")
    .toLowerCase()

  if (!/^[0-9a-f]{32}$/u.test(compact)) {
    throw new Error(`Invalid UUID: ${String(value)}`)
  }

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-")
}

function uuidToBytes(value) {
  return Buffer.from(canonicalUuid(value).replaceAll("-", ""), "hex")
}

function bytesToUuid(value) {
  const compact = Buffer.from(value).toString("hex")
  return canonicalUuid(compact)
}

export function uuidV5(namespace, name) {
  const digest = createHash("sha1")
    .update(uuidToBytes(namespace))
    .update(String(name), "utf8")
    .digest()
    .subarray(0, 16)

  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  return bytesToUuid(digest)
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath))
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"))
}

async function readJsonLines(filePath) {
  const contents = await readFile(filePath, "utf8")
  if (contents.length === 0) {
    return []
  }

  return contents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(
          `${path.basename(filePath)} line ${index + 1} is invalid JSON: ${error.message}`,
        )
      }
    })
}

function parseJsonArray(value, field, wineId, blockers) {
  if (value === null || value === undefined || value === "") {
    return []
  }

  let parsed = value
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value)
    } catch {
      blockers.push({ field, reason: "invalid-json", wineId })
      return []
    }
  }

  if (!Array.isArray(parsed)) {
    blockers.push({ field, reason: "not-an-array", wineId })
    return []
  }

  return parsed
}

function parseNamedArray(value, field, wineId, blockers) {
  const entries = parseJsonArray(value, field, wineId, blockers)
  const seen = new Set()
  const result = []

  for (const entry of entries) {
    const name = cleanText(
      typeof entry === "object" && entry !== null ? entry.name : entry,
    )
    if (name === null) {
      blockers.push({ field, reason: "empty-item", wineId })
      continue
    }

    const key = name.toLocaleLowerCase("en")
    if (seen.has(key)) {
      blockers.push({ field, reason: "duplicate-item", wineId })
      continue
    }
    seen.add(key)
    result.push(name)
  }

  if (result.length > 20) {
    blockers.push({ field, reason: "more-than-20-items", wineId })
  }

  return result.slice(0, 20)
}

function parseGrapes(value, wineId, blockers) {
  const entries = parseJsonArray(
    value,
    "grape_composition",
    wineId,
    blockers,
  )
  const seen = new Set()
  const result = []
  let knownTotal = 0

  for (const entry of entries) {
    const name = cleanText(
      typeof entry === "object" && entry !== null ? entry.name : entry,
    )
    if (name === null) {
      blockers.push({
        field: "grape_composition",
        reason: "empty-item",
        wineId,
      })
      continue
    }

    const key = name.toLocaleLowerCase("en")
    if (seen.has(key)) {
      blockers.push({
        field: "grape_composition",
        reason: "duplicate-item",
        wineId,
      })
      continue
    }
    seen.add(key)

    const rawPercentage =
      typeof entry === "object" && entry !== null
        ? entry.percentage
        : null
    const percentage =
      rawPercentage === null || rawPercentage === undefined
        ? null
        : Number(rawPercentage)

    if (
      percentage !== null &&
      (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100)
    ) {
      blockers.push({
        field: "grape_composition",
        reason: "invalid-percentage",
        wineId,
      })
      continue
    }

    knownTotal += percentage ?? 0
    result.push({ name, percentage })
  }

  if (result.length > 20) {
    blockers.push({
      field: "grape_composition",
      reason: "more-than-20-items",
      wineId,
    })
  }
  if (knownTotal > 100) {
    blockers.push({
      field: "grape_composition",
      reason: "percentages-over-100",
      wineId,
    })
  }

  return result.slice(0, 20)
}

function normalizeSweetness(value, wineId, blockers) {
  const cleaned = cleanText(value)
  if (cleaned === null) {
    return null
  }

  const mapped = SWEETNESS_ALIASES.get(cleaned.toLocaleLowerCase("en"))
  if (!mapped) {
    blockers.push({
      field: "sweetness_category",
      reason: "unsupported-value",
      value: cleaned,
      wineId,
    })
    return null
  }
  return mapped
}

function normalizeAlcohol(value, wineId, blockers) {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 30) {
    blockers.push({
      field: "alcohol_percent",
      reason: "outside-allowed-range",
      wineId,
    })
    return null
  }
  return parsed
}

function normalizeDate(
  value,
  field,
  wineId,
  blockers,
  { allowFuture = true } = {},
) {
  const cleaned = cleanText(value)
  if (cleaned === null) {
    return null
  }

  const date = cleaned.slice(0, 10)
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    date < "1900-01-01" ||
    (!allowFuture && date > new Date().toISOString().slice(0, 10))
  ) {
    blockers.push({ field, reason: "invalid-date", wineId })
    return null
  }
  return date
}

function percentageLabel(value) {
  if (value === null || value === undefined) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? `${Math.round(parsed * 100)}%` : null
}

function displayDate(value) {
  if (value === null) {
    return null
  }
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

function buildObservation(wine, wineId, sourceSha256, blockers) {
  const drinkAfter = normalizeDate(
    wine.drink_after,
    "drink_after",
    wineId,
    blockers,
  )
  const drinkBefore = normalizeDate(
    wine.drink_before,
    "drink_before",
    wineId,
    blockers,
  )
  const experience = cleanText(wine.advice_experience)
  const pairing = cleanText(wine.advice_pairing)
  const notes = cleanText(wine.notes)

  if (
    drinkAfter === null &&
    drinkBefore === null &&
    experience === null &&
    pairing === null &&
    notes === null
  ) {
    return null
  }

  if (drinkAfter !== null && drinkBefore !== null && drinkAfter > drinkBefore) {
    blockers.push({ field: "drinking_window", reason: "reversed", wineId })
  }

  const lines = [
    "Archived v0.1 guidance (restored; it does not replace current recommendations).",
  ]

  if (drinkAfter !== null || drinkBefore !== null) {
    lines.push(
      `Original drinking window: ${displayDate(drinkAfter) ?? "not set"} to ${displayDate(drinkBefore) ?? "not set"}.`,
    )
    const sources = [
      drinkAfter !== null
        ? `start ${cleanText(wine.drink_after_source) ?? "unknown"}${percentageLabel(wine.drink_after_confidence) ? ` (${percentageLabel(wine.drink_after_confidence)})` : ""}`
        : null,
      drinkBefore !== null
        ? `end ${cleanText(wine.drink_before_source) ?? "unknown"}${percentageLabel(wine.drink_before_confidence) ? ` (${percentageLabel(wine.drink_before_confidence)})` : ""}`
        : null,
    ].filter(Boolean)
    if (sources.length > 0) {
      lines.push(`Original window provenance: ${sources.join("; ")}.`)
    }
  }
  if (experience !== null) {
    lines.push(`Experience / advice: ${experience}`)
  }
  if (pairing !== null) {
    lines.push(`Pairing advice: ${pairing}`)
  }
  if (notes !== null) {
    lines.push(`Original note: ${notes}`)
  }

  const note = lines.join("\n")
  if (note.length > 5000) {
    blockers.push({ field: "observation_note", reason: "over-5000", wineId })
  }

  const observedOn = normalizeDate(
    wine.updated_at ?? wine.created_at,
    "observation_date",
    wineId,
    blockers,
    { allowFuture: false },
  )

  return {
    observation_date: observedOn,
    observation_id: uuidV5(
      OBSERVATION_NAMESPACE,
      `${sourceSha256}|${wineId}|guidance`,
    ),
    observation_note: note,
  }
}

function sourceFieldCounts(wines, details, manifest) {
  const present = (value) => cleanText(value) !== null
  const count = (rows, field) => rows.filter((row) => present(row[field])).length
  return {
    deferred: {
      acquisition_allocations:
        Number(manifest.acquisition_allocations?.rows) || 0,
      acquisitions: Number(manifest.acquisitions?.rows) || 0,
      barcodes: count(details, "barcode"),
      external_identifiers:
        Number(manifest.wine_external_identifiers?.rows) || 0,
      legacy_enrichment_profiles:
        Number(manifest.wine_enrichment_profiles?.rows) || 0,
      market_observations:
        Number(manifest.market_observations?.rows) || 0,
      market_values: wines.filter(
        (row) => row.market_value !== null && row.market_value !== undefined,
      ).length,
      movements: Number(manifest.movements?.rows) || 0,
    },
    source: {
      identity_details: details.length,
      wines: wines.length,
    },
  }
}

export async function verifyArchive(archiveDir, expectedSourceSha256) {
  const manifestPath = path.join(archiveDir, "source-manifest.json")
  const planPath = path.join(archiveDir, "import-plan.json")
  const [manifest, importPlan] = await Promise.all([
    readJson(manifestPath),
    readJson(planPath),
  ])

  if (importPlan?.source?.sha256 !== expectedSourceSha256) {
    throw new Error(
      `Archive source hash mismatch: expected ${expectedSourceSha256}, got ${String(importPlan?.source?.sha256)}`,
    )
  }
  if (importPlan.ready_to_apply !== true) {
    throw new Error("The archived v0.1 reconciliation was not ready to apply")
  }

  const exportsDir = path.join(archiveDir, "source-export")
  for (const [table, entry] of Object.entries(manifest)) {
    const exportPath = path.join(exportsDir, entry.export_file)
    const actualHash = await sha256File(exportPath)
    if (actualHash !== entry.export_sha256) {
      throw new Error(`Archive export hash mismatch for ${table}`)
    }
    const rows = await readJsonLines(exportPath)
    if (rows.length !== Number(entry.rows)) {
      throw new Error(`Archive export row-count mismatch for ${table}`)
    }
  }

  return { exportsDir, importPlan, manifest }
}

export async function buildRestorationPlan({
  archiveDir,
  expectedSourceSha256,
}) {
  const { exportsDir, importPlan, manifest } = await verifyArchive(
    archiveDir,
    expectedSourceSha256,
  )
  const [wines, details] = await Promise.all([
    readJsonLines(path.join(exportsDir, manifest.wines.export_file)),
    readJsonLines(
      path.join(exportsDir, manifest.wine_identity_details.export_file),
    ),
  ])

  const blockers = []
  const wineById = new Map()
  for (const wine of wines) {
    let wineId
    try {
      wineId = canonicalUuid(wine.id)
    } catch {
      blockers.push({ field: "wine_id", reason: "invalid-uuid" })
      continue
    }
    if (wineById.has(wineId)) {
      blockers.push({ field: "wine_id", reason: "duplicate", wineId })
      continue
    }
    wineById.set(wineId, wine)
  }

  const detailById = new Map()
  for (const detail of details) {
    let wineId
    try {
      wineId = canonicalUuid(detail.wine_id)
    } catch {
      blockers.push({ field: "detail_wine_id", reason: "invalid-uuid" })
      continue
    }
    if (!wineById.has(wineId)) {
      blockers.push({ field: "detail_wine_id", reason: "unknown-wine", wineId })
      continue
    }
    if (detailById.has(wineId)) {
      blockers.push({ field: "detail_wine_id", reason: "duplicate", wineId })
      continue
    }
    detailById.set(wineId, detail)
  }

  const rows = []
  const factCounts = Object.fromEntries(FACT_FIELDS.map((field) => [field, 0]))

  for (const [wineId, wine] of [...wineById.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const detail = detailById.get(wineId) ?? {}
    const grapes = parseGrapes(detail.grapes_json, wineId, blockers)
    const certifications = parseNamedArray(
      detail.certifications_json,
      "certifications",
      wineId,
      blockers,
    )
    const proposed = {
      alcohol_percent: normalizeAlcohol(
        detail.alcohol_percentage,
        wineId,
        blockers,
      ),
      area: cleanText(detail.region),
      certifications: certifications.length > 0 ? certifications : null,
      classification: cleanText(detail.classification),
      country: cleanText(detail.country),
      grape_composition: grapes.length > 0 ? grapes : null,
      sweetness_category: normalizeSweetness(
        detail.sweetness,
        wineId,
        blockers,
      ),
      vineyard: cleanText(detail.vineyard),
    }
    const observation = buildObservation(
      wine,
      wineId,
      expectedSourceSha256,
      blockers,
    )

    for (const field of FACT_FIELDS) {
      if (proposed[field] !== null) {
        factCounts[field] += 1
      }
    }

    if (Object.values(proposed).some((value) => value !== null) || observation) {
      rows.push({
        wine_id: wineId,
        ...proposed,
        observation_date: observation?.observation_date ?? null,
        observation_id: observation?.observation_id ?? null,
        observation_note: observation?.observation_note ?? null,
      })
    }
  }

  if (rows.some((row) => row.observation_note && row.observation_date === null)) {
    blockers.push({
      field: "observation_date",
      reason: "required-for-restored-observation",
    })
  }

  const counts = sourceFieldCounts(wines, details, manifest)
  const report = {
    blockers,
    deferred: counts.deferred,
    facts: factCounts,
    observations: rows.filter((row) => row.observation_note !== null).length,
    proposed_wines: rows.length,
    source: {
      archive_source_sha256: expectedSourceSha256,
      identity_details: counts.source.identity_details,
      ready_to_apply: importPlan.ready_to_apply,
      wines: counts.source.wines,
    },
  }

  const planBody = { report, rows }
  return {
    ...planBody,
    plan_sha256: sha256(JSON.stringify(planBody)),
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function jsonDollarQuote(value) {
  const body = JSON.stringify(value)
  let suffix = ""
  while (body.includes(`$v01_metadata${suffix}$`)) {
    suffix += "x"
  }
  const tag = `$v01_metadata${suffix}$`
  return `${tag}${body}${tag}`
}

export function renderRestorationSql({
  apply,
  commit = apply,
  expectedPreviewFingerprint,
  householdId,
  plan,
  recordedBy,
}) {
  const canonicalHousehold = canonicalUuid(householdId)
  const canonicalRecorder = canonicalUuid(recordedBy)
  if (plan.report.blockers.length > 0) {
    throw new Error("Cannot render SQL while the restoration plan has blockers")
  }
  if (apply && !expectedPreviewFingerprint) {
    throw new Error("Apply mode requires the reviewed preview fingerprint")
  }
  if (
    apply &&
    !/^[0-9a-f]{32}$/u.test(String(expectedPreviewFingerprint))
  ) {
    throw new Error("Preview fingerprint must be a lowercase MD5 value")
  }

  const mode = apply ? (commit ? "apply" : "rehearsal") : "preview"
  const jsonPayload = jsonDollarQuote(plan.rows)
  const finish = commit ? "commit;" : "rollback;"
  const applySql = apply
    ? `
do $guard$
declare
    v_actual text := (select fingerprint from _v01_preview_fingerprint);
    v_missing bigint := (
        select count(*) from _v01_target_state where target_wine_id is null
    );
    v_observation_conflicts bigint := (
        select count(*)
        from _v01_target_state
        where observation_status = 'conflict'
    );
begin
    if v_actual <> ${sqlLiteral(expectedPreviewFingerprint)} then
        raise exception 'Restoration preview changed: expected %, got %',
            ${sqlLiteral(expectedPreviewFingerprint)}, v_actual;
    end if;
    if v_missing <> 0 then
        raise exception 'Restoration has % missing target wines', v_missing;
    end if;
    if v_observation_conflicts <> 0 then
        raise exception 'Restoration has % conflicting archived observations',
            v_observation_conflicts;
    end if;
end;
$guard$;

update public.wines target
set country = case
        when target.country is null then proposed.country
        else target.country
    end,
    area = case
        when target.area is null then proposed.area
        else target.area
    end,
    classification = case
        when target.classification is null then proposed.classification
        else target.classification
    end,
    vineyard = case
        when target.vineyard is null then proposed.vineyard
        else target.vineyard
    end,
    grape_composition = case
        when target.grape_composition = '[]'::jsonb
            then coalesce(proposed.grape_composition, target.grape_composition)
        else target.grape_composition
    end,
    sweetness_category = case
        when target.sweetness_category is null then proposed.sweetness_category
        else target.sweetness_category
    end,
    alcohol_percent = case
        when target.alcohol_percent is null then proposed.alcohol_percent
        else target.alcohol_percent
    end,
    certifications = case
        when target.certifications = '[]'::jsonb
            then coalesce(proposed.certifications, target.certifications)
        else target.certifications
    end
from _v01_metadata proposed
where target.id = proposed.wine_id
  and target.household_id = ${sqlLiteral(canonicalHousehold)}::uuid
  and (
      (target.country is null and proposed.country is not null)
      or (target.area is null and proposed.area is not null)
      or (target.classification is null and proposed.classification is not null)
      or (target.vineyard is null and proposed.vineyard is not null)
      or (
          target.grape_composition = '[]'::jsonb
          and proposed.grape_composition is not null
      )
      or (
          target.sweetness_category is null
          and proposed.sweetness_category is not null
      )
      or (
          target.alcohol_percent is null
          and proposed.alcohol_percent is not null
      )
      or (
          target.certifications = '[]'::jsonb
          and proposed.certifications is not null
      )
  );

insert into public.household_wine_observations (
    id,
    household_id,
    wine_id,
    recorded_by,
    visibility,
    observation_type,
    observed_on,
    note,
    created_at,
    updated_at
)
select
    proposed.observation_id,
    ${sqlLiteral(canonicalHousehold)}::uuid,
    proposed.wine_id,
    ${sqlLiteral(canonicalRecorder)}::uuid,
    'household',
    'other',
    proposed.observation_date,
    proposed.observation_note,
    now(),
    now()
from _v01_metadata proposed
join public.wines target
  on target.id = proposed.wine_id
 and target.household_id = ${sqlLiteral(canonicalHousehold)}::uuid
where proposed.observation_id is not null
on conflict (id) do nothing;

do $inventory_guard$
declare
    v_after jsonb;
begin
    select jsonb_build_object(
        'wines', (select count(*) from public.wines where household_id = ${sqlLiteral(canonicalHousehold)}::uuid),
        'cellars', (select count(*) from public.cellars where household_id = ${sqlLiteral(canonicalHousehold)}::uuid),
        'locations', (select count(*) from public.locations where household_id = ${sqlLiteral(canonicalHousehold)}::uuid),
        'holdings', (select count(*) from public.holdings where household_id = ${sqlLiteral(canonicalHousehold)}::uuid),
        'bottles', (select coalesce(sum(quantity), 0) from public.holdings where household_id = ${sqlLiteral(canonicalHousehold)}::uuid)
    ) into v_after;

    if v_after <> (select counts from _v01_inventory_before) then
        raise exception 'Inventory changed during metadata restoration';
    end if;
end;
$inventory_guard$;
`
    : ""

  return `-- CellarManager v0.1 metadata restoration (${mode})
-- Source SHA-256: ${plan.report.source.archive_source_sha256}
-- Plan SHA-256: ${plan.plan_sha256}
-- Target household: ${canonicalHousehold}
-- Recorded by: ${canonicalRecorder}
-- Facts are fill-missing-only; conflicts keep the current value.
-- Archived guidance is a labelled observation and never a maturity override.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

${apply ? `
select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
        'cellarmanager-v01-metadata|${canonicalHousehold}',
        0
    )
);` : ""}

do $identity_guard$
begin
    if not exists (
        select 1
        from public.household_members member
        where member.household_id = ${sqlLiteral(canonicalHousehold)}::uuid
          and member.user_id = ${sqlLiteral(canonicalRecorder)}::uuid
          and member.role = 'owner'
    ) then
        raise exception 'Recorded-by user is not an owner of the target household';
    end if;
end;
$identity_guard$;

${apply ? `select wine.id from public.wines wine where wine.household_id = ${sqlLiteral(canonicalHousehold)}::uuid for update;` : ""}

create temporary table _v01_metadata on commit drop as
select *
from jsonb_to_recordset(${jsonPayload}::jsonb) as proposed(
    wine_id uuid,
    country text,
    area text,
    classification text,
    vineyard text,
    grape_composition jsonb,
    sweetness_category text,
    alcohol_percent numeric,
    certifications jsonb,
    observation_id uuid,
    observation_date date,
    observation_note text
);

create temporary table _v01_inventory_before on commit drop as
select jsonb_build_object(
    'wines', (select count(*) from public.wines where household_id = ${sqlLiteral(canonicalHousehold)}::uuid),
    'cellars', (select count(*) from public.cellars where household_id = ${sqlLiteral(canonicalHousehold)}::uuid),
    'locations', (select count(*) from public.locations where household_id = ${sqlLiteral(canonicalHousehold)}::uuid),
    'holdings', (select count(*) from public.holdings where household_id = ${sqlLiteral(canonicalHousehold)}::uuid),
    'bottles', (select coalesce(sum(quantity), 0) from public.holdings where household_id = ${sqlLiteral(canonicalHousehold)}::uuid)
) as counts;

create temporary table _v01_target_state on commit drop as
select
    proposed.*,
    target.id as target_wine_id,
    target.country as target_country,
    target.area as target_area,
    target.classification as target_classification,
    target.vineyard as target_vineyard,
    target.grape_composition as target_grape_composition,
    target.sweetness_category as target_sweetness_category,
    target.alcohol_percent as target_alcohol_percent,
    target.certifications as target_certifications,
    case
        when proposed.observation_id is null then 'not-proposed'
        when target.id is null then 'missing-wine'
        when existing_observation.id is null then 'new'
        when existing_observation.household_id = ${sqlLiteral(canonicalHousehold)}::uuid
         and existing_observation.wine_id = proposed.wine_id
         and existing_observation.recorded_by = ${sqlLiteral(canonicalRecorder)}::uuid
         and existing_observation.visibility = 'household'
         and existing_observation.observation_type = 'other'
         and existing_observation.observed_on = proposed.observation_date
         and existing_observation.note = proposed.observation_note
            then 'existing-identical'
        else 'conflict'
    end as observation_status,
    case
        when existing_observation.id is null then null
        else jsonb_build_object(
            'household_id', existing_observation.household_id,
            'wine_id', existing_observation.wine_id,
            'recorded_by', existing_observation.recorded_by,
            'visibility', existing_observation.visibility,
            'observation_type', existing_observation.observation_type,
            'observed_on', existing_observation.observed_on,
            'note', existing_observation.note
        )
    end as existing_observation
from _v01_metadata proposed
left join public.wines target
  on target.id = proposed.wine_id
 and target.household_id = ${sqlLiteral(canonicalHousehold)}::uuid
left join public.household_wine_observations existing_observation
  on existing_observation.id = proposed.observation_id;

create temporary table _v01_field_outcomes on commit drop as
select
    state.wine_id,
    outcome.field,
    case
        when state.target_wine_id is null then 'missing-wine'
        when outcome.proposed is null then 'not-proposed'
        when outcome.missing then 'fill'
        when outcome.proposed = outcome.current then 'identical'
        else 'conflict'
    end as status
from _v01_target_state state
cross join lateral (
    values
        ('country', to_jsonb(state.country), to_jsonb(state.target_country), state.target_country is null),
        ('area', to_jsonb(state.area), to_jsonb(state.target_area), state.target_area is null),
        ('classification', to_jsonb(state.classification), to_jsonb(state.target_classification), state.target_classification is null),
        ('vineyard', to_jsonb(state.vineyard), to_jsonb(state.target_vineyard), state.target_vineyard is null),
        ('grape_composition', state.grape_composition, state.target_grape_composition, state.target_grape_composition = '[]'::jsonb),
        ('sweetness_category', to_jsonb(state.sweetness_category), to_jsonb(state.target_sweetness_category), state.target_sweetness_category is null),
        ('alcohol_percent', to_jsonb(state.alcohol_percent), to_jsonb(state.target_alcohol_percent), state.target_alcohol_percent is null),
        ('certifications', state.certifications, state.target_certifications, state.target_certifications = '[]'::jsonb)
) as outcome(field, proposed, current, missing);

create temporary table _v01_preview_fingerprint on commit drop as
select md5(coalesce(string_agg(
    state.wine_id::text || ':' ||
    jsonb_build_object(
        'target_wine_id', state.target_wine_id,
        'country', state.target_country,
        'area', state.target_area,
        'classification', state.target_classification,
        'vineyard', state.target_vineyard,
        'grape_composition', state.target_grape_composition,
        'sweetness_category', state.target_sweetness_category,
        'alcohol_percent', state.target_alcohol_percent,
        'certifications', state.target_certifications,
        'observation', state.existing_observation
    )::text,
    '|' order by state.wine_id
), '')) as fingerprint
from _v01_target_state state;

select jsonb_pretty(jsonb_build_object(
    'mode', ${sqlLiteral(mode)},
    'source_sha256', ${sqlLiteral(plan.report.source.archive_source_sha256)},
    'plan_sha256', ${sqlLiteral(plan.plan_sha256)},
    'preview_fingerprint', (select fingerprint from _v01_preview_fingerprint),
    'inventory_before', (select counts from _v01_inventory_before),
    'proposed_wines', (select count(*) from _v01_metadata),
    'matched_wines', (select count(*) from _v01_target_state where target_wine_id is not null),
    'missing_wines', (select count(*) from _v01_target_state where target_wine_id is null),
    'fact_outcomes', (
        select jsonb_object_agg(field, statuses order by field)
        from (
            select field, jsonb_object_agg(status, amount order by status) as statuses
            from (
                select field, status, count(*) as amount
                from _v01_field_outcomes
                where status <> 'not-proposed'
                group by field, status
            ) counts
            group by field
        ) fields
    ),
    'observation_outcomes', (
        select jsonb_object_agg(observation_status, amount order by observation_status)
        from (
            select observation_status, count(*) as amount
            from _v01_target_state
            where observation_status <> 'not-proposed'
            group by observation_status
        ) observations
    )
)) as restoration_preview;
${applySql}
${finish}
`
}
