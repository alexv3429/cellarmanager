import { matchesSearch } from "./searchFilters"
import {
  cleanWineText,
  formatWineVolume,
} from "./wineCatalog"

export type ActivityOperationType = "ADD" | "MOVE" | "REMOVE"
export type ActivityStatus = "ACCEPTED" | "PENDING" | "REJECTED"
export type ActivityFilterValue = "ALL" | ActivityOperationType
export type ActivityStatusFilter = "ALL" | ActivityStatus
export type ActivityStatusTone = "error" | "success" | "warning"

export interface InventoryActivityRow {
  catalog_wine_id: string | null
  color: string | null
  created_at_client: string
  destination_cellar_name: string | null
  destination_code: string | null
  device_name: string | null
  error_code: string | null
  error_message: string | null
  format_ml: number | null
  id: string
  operation_type: ActivityOperationType
  producer: string | null
  quantity: number
  received_at_server: string | null
  remove_reason: string | null
  source_cellar_name: string | null
  source_code: string | null
  status: ActivityStatus
  user_id: string
  vintage: number | null
  cuvee: string | null
  wine_id: string
}

export interface InventoryActivityItem
  extends InventoryActivityRow {
  actionLabel: string
  destinationLabel: string | null
  quantityLabel: string
  reasonLabel: string | null
  sourceLabel: string | null
  statusLabel: string
  statusTone: ActivityStatusTone
  wineLabel: string
  wineMeta: string
}

export interface ActivityFilters {
  operationType: ActivityFilterValue
  search: string
  status: ActivityStatusFilter
}

export interface ActivitySummary {
  acceptedCount: number
  pendingCount: number
  rejectedCount: number
  totalCount: number
}

const removeReasonLabels: Record<string, string> = {
  BROKEN: "Broken",
  DRANK: "Drank",
  GIFTED: "Gifted",
  LOST: "Lost",
  OTHER: "Other",
}

function locationLabel(
  cellarName: string | null,
  code: string | null,
): string | null {
  if (!cellarName && !code) {
    return null
  }

  if (!cellarName) {
    return code
  }

  if (!code) {
    return cellarName
  }

  return `${cellarName} / ${code}`
}

function statusPresentation(status: ActivityStatus): {
  label: string
  tone: ActivityStatusTone
} {
  switch (status) {
    case "ACCEPTED":
      return { label: "Synced", tone: "success" }
    case "PENDING":
      return { label: "Queued", tone: "warning" }
    case "REJECTED":
      return { label: "Rejected", tone: "error" }
  }
}

function operationLabel(operationType: ActivityOperationType): string {
  switch (operationType) {
    case "ADD":
      return "Added"
    case "MOVE":
      return "Moved"
    case "REMOVE":
      return "Removed"
  }
}

function wineLabel(
  producer: string | null,
  cuvee: string | null,
): string {
  const cleanedProducer = producer
    ? cleanWineText(producer)
    : ""
  const cleanedCuvee = cuvee ? cleanWineText(cuvee) : ""

  if (cleanedProducer && cleanedCuvee) {
    return `${cleanedProducer} — ${cleanedCuvee}`
  }

  return cleanedProducer || cleanedCuvee || "Unknown wine"
}

function wineMeta(row: InventoryActivityRow): string {
  return [
    row.vintage ?? "NV",
    row.color ? cleanWineText(row.color) : null,
    row.format_ml ? formatWineVolume(row.format_ml) : null,
  ]
    .filter((value): value is string | number => value !== null)
    .join(" · ")
}

export function buildInventoryActivity(
  rows: InventoryActivityRow[],
): InventoryActivityItem[] {
  return rows.map((row) => {
    const status = statusPresentation(row.status)

    return {
      ...row,
      actionLabel: operationLabel(row.operation_type),
      destinationLabel: locationLabel(
        row.destination_cellar_name,
        row.destination_code,
      ),
      quantityLabel: `${row.quantity} ${row.quantity === 1 ? "bottle" : "bottles"}`,
      reasonLabel: row.remove_reason
        ? removeReasonLabels[row.remove_reason] ?? row.remove_reason
        : null,
      sourceLabel: locationLabel(
        row.source_cellar_name,
        row.source_code,
      ),
      statusLabel: status.label,
      statusTone: status.tone,
      wineLabel: wineLabel(row.producer, row.cuvee),
      wineMeta: wineMeta(row),
    }
  })
}

export function filterInventoryActivity(
  items: InventoryActivityItem[],
  filters: ActivityFilters,
): InventoryActivityItem[] {
  return items.filter((item) => {
    if (
      filters.operationType !== "ALL" &&
      item.operation_type !== filters.operationType
    ) {
      return false
    }

    if (
      filters.status !== "ALL" &&
      item.status !== filters.status
    ) {
      return false
    }

    return matchesSearch(
      [
        item.wineLabel,
        item.wineMeta,
        item.sourceLabel,
        item.destinationLabel,
        item.reasonLabel,
        item.device_name,
        item.error_code,
        item.error_message,
      ],
      filters.search,
    )
  })
}

export function summarizeInventoryActivity(
  items: InventoryActivityItem[],
): ActivitySummary {
  return items.reduce<ActivitySummary>(
    (summary, item) => ({
      acceptedCount:
        summary.acceptedCount +
        (item.status === "ACCEPTED" ? 1 : 0),
      pendingCount:
        summary.pendingCount +
        (item.status === "PENDING" ? 1 : 0),
      rejectedCount:
        summary.rejectedCount +
        (item.status === "REJECTED" ? 1 : 0),
      totalCount: summary.totalCount + 1,
    }),
    {
      acceptedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      totalCount: 0,
    },
  )
}
