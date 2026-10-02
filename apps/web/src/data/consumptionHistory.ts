import { getInsightsPeriodRange, type InsightsPeriod } from "./inventoryInsights"

export interface ConsumptionOperationRow {
  id: string
  household_id: string
  wine_id: string
  catalog_wine_id: string | null
  producer: string | null
  cuvee: string | null
  vintage: number | null
  operation_type: string
  quantity: number
  remove_reason: string | null
  status: string
  created_at_client: string
  received_at_server: string | null
  source_cellar_name: string | null
  source_code: string | null
}

export interface ConsumptionLegacyRow {
  source_record_id: string
  household_id: string
  archive_source_sha256: string
  wine_id: string
  catalog_wine_id: string | null
  producer: string | null
  cuvee: string | null
  vintage: number | null
  event_type: string
  quantity: number
  remove_reason: string | null
  occurred_at: string
  source_from_location: string | null
}

export interface ConsumptionEntry {
  id: string
  wineId: string
  catalogWineId: string | null
  producer: string | null
  cuvee: string | null
  vintage: number | null
  quantity: number
  occurredAt: string
  location: string | null
  source: "modern" | "imported"
}

export interface ConsumptionHistory {
  entries: ConsumptionEntry[]
  bottles: number
  wines: number
  archiveAmbiguous: boolean
}

function validQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function inPeriod(value: string, start: number, end: number): boolean {
  const at = Date.parse(value)
  return Number.isFinite(at) && at >= start && at < end
}

export function buildConsumptionHistory(
  operations: readonly ConsumptionOperationRow[],
  legacy: readonly ConsumptionLegacyRow[],
  householdId: string,
  period: InsightsPeriod | "all",
  now: Date,
): ConsumptionHistory {
  const { start, end } = period === "all"
    ? { start: Number.NEGATIVE_INFINITY, end: now.getTime() + 1 }
    : getInsightsPeriodRange(period, now)
  const ownLegacy = legacy.filter((row) => row.household_id === householdId)
  const archiveIds = new Set(ownLegacy.map((row) => row.archive_source_sha256))
  const archiveAmbiguous = archiveIds.size > 1
  const entries: ConsumptionEntry[] = []

  for (const row of operations) {
    if (
      row.household_id !== householdId ||
      row.operation_type !== "REMOVE" ||
      row.remove_reason !== "DRANK" ||
      row.status !== "ACCEPTED" ||
      !row.received_at_server ||
      !validQuantity(row.quantity) ||
      !inPeriod(row.created_at_client, start, end)
    ) continue
    entries.push({
      id: `operation:${row.id}`,
      wineId: row.wine_id,
      catalogWineId: row.catalog_wine_id,
      producer: row.producer,
      cuvee: row.cuvee,
      vintage: row.vintage,
      quantity: row.quantity,
      occurredAt: row.created_at_client,
      location: [row.source_cellar_name, row.source_code].filter(Boolean).join(" / ") || null,
      source: "modern",
    })
  }

  if (!archiveAmbiguous) {
    for (const row of ownLegacy) {
      if (
        row.event_type !== "REMOVE" ||
        row.remove_reason !== "DRANK" ||
        !validQuantity(row.quantity) ||
        !inPeriod(row.occurred_at, start, end)
      ) continue
      entries.push({
        id: `legacy:${row.archive_source_sha256}:${row.source_record_id}`,
        wineId: row.wine_id,
        catalogWineId: row.catalog_wine_id,
        producer: row.producer,
        cuvee: row.cuvee,
        vintage: row.vintage,
        quantity: row.quantity,
        occurredAt: row.occurred_at,
        location: row.source_from_location,
        source: "imported",
      })
    }
  }

  entries.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id))
  return {
    entries,
    bottles: entries.reduce((sum, entry) => sum + entry.quantity, 0),
    wines: new Set(entries.map((entry) => entry.catalogWineId ?? entry.wineId)).size,
    archiveAmbiguous,
  }
}
