export type InsightsPeriod = "30d" | "12m"

export interface InsightsOperationRow {
  household_id: string
  operation_type: "ADD" | "MOVE" | "REMOVE"
  quantity: number
  remove_reason: string | null
  status: string
  created_at_client: string
  received_at_server: string | null
}

export interface InsightsLegacyRow {
  household_id: string
  archive_source_sha256: string
  event_type: "OPENING_BALANCE" | "REMOVE"
  quantity: number
  remove_reason: string | null
  occurred_at: string
}

export interface InsightsBucket {
  start: string
  end: string
  added: number
  removed: number
  consumed: number
  closingStock: number | null
}

export interface InventoryInsights {
  currentStock: number
  added: number
  removed: number
  consumed: number
  net: number
  buckets: InsightsBucket[]
  stockHistoryAvailable: boolean
}

interface Movement {
  at: number
  added: number
  removed: number
  consumed: number
}

function validQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function validDate(value: string): number | null {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function makeBuckets(period: InsightsPeriod, now: Date): InsightsBucket[] {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  if (period === "12m") {
    return Array.from({ length: 12 }, (_, index) => ({
      start: new Date(Date.UTC(year, month - 11 + index, 1)).toISOString(),
      end: new Date(Date.UTC(year, month - 10 + index, 1)).toISOString(),
      added: 0, removed: 0, consumed: 0, closingStock: null,
    }))
  }
  const today = Date.UTC(year, month, now.getUTCDate())
  return Array.from({ length: 6 }, (_, index) => ({
    start: new Date(today - (29 - index * 5) * 86_400_000).toISOString(),
    end: new Date(today - (24 - index * 5) * 86_400_000).toISOString(),
    added: 0, removed: 0, consumed: 0, closingStock: null,
  }))
}

export function buildInventoryInsights(
  operations: readonly InsightsOperationRow[],
  legacy: readonly InsightsLegacyRow[],
  householdId: string,
  currentStock: number,
  period: InsightsPeriod,
  now: Date,
): InventoryInsights {
  const buckets = makeBuckets(period, now)
  const nowTime = now.getTime()
  const movements: Movement[] = []
  let completeModernHistory = true

  for (const row of operations) {
    if (row.household_id !== householdId || row.status !== "ACCEPTED") continue
    if (row.operation_type === "MOVE") continue
    const at = validDate(row.created_at_client)
    if (!row.received_at_server || at === null || at > nowTime || !validQuantity(row.quantity)) {
      completeModernHistory = false
      continue
    }
    movements.push({
      at,
      added: row.operation_type === "ADD" ? row.quantity : 0,
      removed: row.operation_type === "REMOVE" ? row.quantity : 0,
      consumed: row.operation_type === "REMOVE" && row.remove_reason === "DRANK" ? row.quantity : 0,
    })
  }

  const ownLegacy = legacy.filter((row) => row.household_id === householdId)
  const legacyArchiveIds = new Set(ownLegacy.map((row) => row.archive_source_sha256))
  const openingRows = ownLegacy.filter((row) => row.event_type === "OPENING_BALANCE")
  const openingDays = new Set(openingRows.map((row) => row.occurred_at.slice(0, 10)))
  const openingTimes = openingRows.map((row) => validDate(row.occurred_at))
  const openingAt = openingTimes.length > 0 && openingTimes.every((time) => time !== null)
    ? Math.max(...openingTimes as number[])
    : null
  const openingStock = openingRows.reduce((sum, row) => sum + row.quantity, 0)
  let completeLegacyHistory = legacyArchiveIds.size === 1 &&
    ownLegacy.every((row) => validQuantity(row.quantity) && validDate(row.occurred_at) !== null &&
      Date.parse(row.occurred_at) <= nowTime)
  for (const row of ownLegacy) {
    if (row.event_type !== "REMOVE") continue
    const at = validDate(row.occurred_at)
    if (legacyArchiveIds.size !== 1 || at === null || at > nowTime || !validQuantity(row.quantity)) {
      completeLegacyHistory = false
      continue
    }
    movements.push({ at, added: 0, removed: row.quantity, consumed: row.remove_reason === "DRANK" ? row.quantity : 0 })
  }

  const startsAt = Date.parse(buckets[0].start)
  const endsAt = Math.min(nowTime + 1, Date.parse(buckets[buckets.length - 1].end))
  let added = 0
  let removed = 0
  let consumed = 0
  for (const movement of movements) {
    if (movement.at < startsAt || movement.at >= endsAt) continue
    const bucket = buckets.find((item) => movement.at >= Date.parse(item.start) && movement.at < Date.parse(item.end))
    if (!bucket) continue
    bucket.added += movement.added
    bucket.removed += movement.removed
    bucket.consumed += movement.consumed
    added += movement.added
    removed += movement.removed
    consumed += movement.consumed
  }

  const stockHistoryAvailable =
    Number.isSafeInteger(currentStock) &&
    currentStock >= 0 &&
    legacyArchiveIds.size === 1 &&
    openingDays.size === 1 &&
    openingAt !== null &&
    openingAt <= startsAt &&
    openingRows.every((row) => validQuantity(row.quantity)) &&
    completeModernHistory &&
    completeLegacyHistory &&
    movements.every((movement) => movement.at > openingAt) &&
    openingStock + movements.reduce((sum, movement) => sum + movement.added - movement.removed, 0) === currentStock

  if (stockHistoryAvailable) {
    for (const bucket of buckets) {
      const end = Math.min(nowTime + 1, Date.parse(bucket.end))
      bucket.closingStock = openingStock + movements
        .filter((movement) => movement.at < end)
        .reduce((sum, movement) => sum + movement.added - movement.removed, 0)
    }
  }

  return { currentStock, added, removed, consumed, net: added - removed, buckets, stockHistoryAvailable }
}
