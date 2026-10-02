import { readFile } from "node:fs/promises"
import path from "node:path"

import { canonicalUuid, sha256, uuidV5, verifyArchive } from "./restore_metadata_lib.mjs"

const EVENT_NAMESPACE = "cab632da-491e-58c9-abd4-48ca9721b673"
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u

async function readRows(exportsDir, manifest, table) {
  const entry = manifest[table]
  if (!entry?.export_file) throw new Error(`Archive is missing ${table}`)
  return (await readFile(path.join(exportsDir, entry.export_file), "utf8"))
    .split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

function optionalUuid(value) {
  return value === null || value === undefined || value === ""
    ? null : canonicalUuid(value)
}

function location(value) {
  if (value === null || value === undefined) return null
  const cleaned = String(value).trim().replace(/\s+/gu, " ")
  if (cleaned.length > 120 || cleaned.includes("\0")) throw new Error("Invalid legacy location")
  return cleaned || null
}

function timestamp(value) {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("Invalid legacy timestamp")
  }
  return value
}

function signedQuantity(value, sign) {
  if (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > 100000
      || Math.sign(value) !== sign) {
    throw new Error("Invalid legacy quantity")
  }
  return Math.abs(value)
}

export function normalizeLegacyMovements({ movements, sourceWineIds, householdId, sourceSha256 }) {
  const household = canonicalUuid(householdId)
  if (!/^[0-9a-f]{64}$/u.test(sourceSha256)) throw new Error("Invalid source SHA-256")
  const knownWines = new Set(sourceWineIds.map(canonicalUuid))
  const rows = []
  const blockers = []
  const excluded = { enrich: 0, update: 0 }
  const seen = new Set()

  for (const movement of movements) {
    let sourceRecordId
    try {
      sourceRecordId = canonicalUuid(movement.id)
      if (seen.has(sourceRecordId)) throw new Error("Duplicate source movement ID")
      seen.add(sourceRecordId)

      if (movement.action === "enrich" || movement.action === "update") {
        if (movement.quantity_delta !== 0) throw new Error("Non-stock action changes quantity")
        excluded[movement.action] += 1
        continue
      }
      if (movement.action !== "import" && movement.action !== "remove") {
        throw new Error("Unsupported movement action")
      }

      const wineId = canonicalUuid(movement.wine_id)
      if (!knownWines.has(wineId)) throw new Error("Movement wine absent from source archive")
      const opening = movement.action === "import"
      const fromCellar = optionalUuid(movement.from_cellar_id)
      const toCellar = optionalUuid(movement.to_cellar_id)
      const fromLocation = location(movement.from_location)
      const toLocation = location(movement.to_location)
      if (opening && (fromCellar || fromLocation || !toCellar)) {
        throw new Error("Opening balance has unexpected locations")
      }
      if (!opening && (!fromCellar || toCellar || toLocation
          || String(movement.note ?? "").trim().toLowerCase() !== "drunk")) {
        throw new Error("Removal is not a confirmed drink")
      }

      rows.push({
        id: uuidV5(EVENT_NAMESPACE, `${household}|${sourceRecordId}`),
        household_id: household,
        wine_id: wineId,
        archive_source_sha256: sourceSha256,
        source_record_id: sourceRecordId,
        source_holding_id: optionalUuid(movement.holding_id),
        event_type: opening ? "OPENING_BALANCE" : "REMOVE",
        quantity: signedQuantity(movement.quantity_delta, opening ? 1 : -1),
        remove_reason: opening ? null : "DRANK",
        occurred_at: timestamp(movement.occurred_at),
        recorded_at: timestamp(movement.recorded_at),
        source_from_cellar_id: fromCellar,
        source_from_location: fromLocation,
        source_to_cellar_id: toCellar,
        source_to_location: toLocation,
      })
    } catch (error) {
      blockers.push({ source_record_id: sourceRecordId ?? null, reason: error.message })
    }
  }

  rows.sort((a, b) => a.source_record_id.localeCompare(b.source_record_id))
  const openingRows = rows.filter((row) => row.event_type === "OPENING_BALANCE")
  const removalRows = rows.filter((row) => row.event_type === "REMOVE")
  const report = {
    source_movement_count: movements.length,
    opening_balance_count: openingRows.length,
    opening_balance_bottles: openingRows.reduce((sum, row) => sum + row.quantity, 0),
    confirmed_drink_count: removalRows.length,
    confirmed_drink_bottles: removalRows.reduce((sum, row) => sum + row.quantity, 0),
    excluded_nonstock_count: excluded.enrich + excluded.update,
    excluded_actions: excluded,
    blockers,
  }
  return {
    household_id: household,
    source_sha256: sourceSha256,
    rows,
    report,
    plan_sha256: sha256(JSON.stringify({ household, sourceSha256, rows, report })),
  }
}

export async function buildLegacyMovementsPlan({ archiveDir, expectedSourceSha256, householdId }) {
  const { exportsDir, manifest } = await verifyArchive(archiveDir, expectedSourceSha256)
  const [movements, wines] = await Promise.all([
    readRows(exportsDir, manifest, "movements"),
    readRows(exportsDir, manifest, "wines"),
  ])
  return normalizeLegacyMovements({
    movements,
    sourceWineIds: wines.map((wine) => wine.id),
    householdId,
    sourceSha256: expectedSourceSha256,
  })
}
