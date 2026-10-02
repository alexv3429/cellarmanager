import { matchesSearch } from "./searchFilters"
import { cleanWineText } from "./wineCatalog"
import type { ActivityFilterValue, ActivityStatusFilter } from "./activityView"
import type { LegacyInventoryHistoryRow } from "./inventoryHistory"

export interface LegacyActivityRow extends LegacyInventoryHistoryRow {
  archive_source_sha256: string
  catalog_wine_id: string | null
  producer: string | null
  cuvee: string | null
  vintage: number | null
  color: string | null
  format_ml: number | null
}

interface LegacyActivityBase {
  id: string
  occurredAt: string
}

export interface LegacyOpeningGroup extends LegacyActivityBase {
  kind: "opening"
  entryCount: number
  quantity: number
  wineCount: number
}

export interface LegacyDrink extends LegacyActivityBase {
  kind: "drink"
  catalogWineId: string | null
  wineLabel: string
  vintage: number | null
  color: string | null
  formatMl: number | null
  quantity: number
  sourceLocation: string | null
}

export type LegacyActivityItem = LegacyOpeningGroup | LegacyDrink

function label(producer: string | null, cuvee: string | null): string {
  const name = producer ? cleanWineText(producer) : ""
  const wine = cuvee ? cleanWineText(cuvee) : ""
  return [name, wine].filter(Boolean).join(" — ") || "Unknown wine"
}

export function buildLegacyActivity(
  rows: readonly LegacyActivityRow[],
  householdId: string,
): LegacyActivityItem[] {
  const openingGroups = new Map<string, LegacyOpeningGroup & { wineIds: Set<string> }>()
  const drinks: LegacyDrink[] = []

  for (const row of rows) {
    if (row.household_id !== householdId) continue
    if (row.event_type === "REMOVE") {
      if (row.remove_reason !== "DRANK") continue
      drinks.push({
        kind: "drink",
        id: `legacy-v01:${row.source_record_id}`,
        occurredAt: row.occurred_at,
        catalogWineId: row.catalog_wine_id,
        wineLabel: label(row.producer, row.cuvee),
        vintage: row.vintage,
        color: row.color,
        formatMl: row.format_ml,
        quantity: row.quantity,
        sourceLocation: row.source_from_location,
      })
      continue
    }

    // An opening balance is one historical snapshot, never hundreds of ADDs.
    // Keep separate archives and days separate if another archive is restored.
    const key = `${row.archive_source_sha256}:${row.occurred_at.slice(0, 10)}`
    let group = openingGroups.get(key)
    if (!group) {
      group = {
        kind: "opening",
        id: `legacy-opening:${key}`,
        occurredAt: row.occurred_at,
        entryCount: 0,
        quantity: 0,
        wineCount: 0,
        wineIds: new Set<string>(),
      }
      openingGroups.set(key, group)
    }
    group.entryCount += 1
    group.quantity += row.quantity
    group.wineIds.add(row.wine_id)
    if (row.occurred_at > group.occurredAt) group.occurredAt = row.occurred_at
  }

  return [
    ...drinks,
    ...[...openingGroups.values()].map(({ wineIds, ...group }) => ({
      ...group,
      wineCount: wineIds.size,
    })),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))
}

export function filterLegacyActivity(
  items: readonly LegacyActivityItem[],
  filters: { operationType: ActivityFilterValue; search: string; status: ActivityStatusFilter },
): LegacyActivityItem[] {
  if (filters.status !== "ALL" && filters.status !== "ARCHIVED") return []
  return items.filter((item) => {
    if (filters.operationType !== "ALL" &&
      !(item.kind === "drink" && filters.operationType === "REMOVE")) return false
    return matchesSearch(item.kind === "opening"
      ? ["opening stock", "stock initial", "previous cellar", "ancienne cave", item.quantity, item.wineCount]
      : [item.wineLabel, item.vintage, item.color, item.sourceLocation, "drank", "bu"],
    filters.search)
  })
}
