// Local-first counterpart of public.inventory_reporting_events. Reporting may
// describe accepted operations, but holdings remain authoritative stock.
export interface InventoryHistoryOperationRow {
  id: string
  household_id: string
  user_id: string
  operation_type: "ADD" | "MOVE" | "REMOVE"
  wine_id: string
  source_location_id: string | null
  destination_location_id: string | null
  quantity: number
  remove_reason: string | null
  status: "ACCEPTED" | "PENDING" | "REJECTED"
  created_at_client: string
  received_at_server: string | null
}

export interface InventoryHistoryEvent {
  event_key: string
  event_source: "ACCEPTED_OPERATION" | "LEGACY_V01"
  source_record_id: string
  household_id: string
  wine_id: string
  event_type: "ADD" | "MOVE" | "REMOVE" | "OPENING_BALANCE"
  quantity: number
  source_location_id: string | null
  destination_location_id: string | null
  remove_reason: string | null
  actor_user_id: string | null
  occurred_at: string
  occurred_at_precision: "INSTANT"
  recorded_at: string
  was_applied_to_stock: boolean
  source_legacy_cellar_id?: string | null
  source_legacy_location?: string | null
  destination_legacy_cellar_id?: string | null
  destination_legacy_location?: string | null
}

export interface LegacyInventoryHistoryRow {
  household_id: string
  wine_id: string
  source_record_id: string
  event_type: "OPENING_BALANCE" | "REMOVE"
  quantity: number
  remove_reason: string | null
  occurred_at: string
  recorded_at: string
  source_from_cellar_id: string | null
  source_from_location: string | null
  source_to_cellar_id: string | null
  source_to_location: string | null
}

export function acceptedInventoryHistoryEvents(
  operations: readonly InventoryHistoryOperationRow[],
  householdId: string,
): InventoryHistoryEvent[] {
  return operations.flatMap((operation) => {
    if (
      operation.household_id !== householdId ||
      operation.status !== "ACCEPTED" ||
      !operation.received_at_server
    ) {
      return []
    }

    return [{
      event_key: `operation:${operation.id}`,
      event_source: "ACCEPTED_OPERATION" as const,
      source_record_id: operation.id,
      household_id: operation.household_id,
      wine_id: operation.wine_id,
      event_type: operation.operation_type,
      quantity: operation.quantity,
      source_location_id: operation.source_location_id,
      destination_location_id: operation.destination_location_id,
      remove_reason: operation.remove_reason,
      actor_user_id: operation.user_id,
      occurred_at: operation.created_at_client,
      occurred_at_precision: "INSTANT" as const,
      recorded_at: operation.received_at_server,
      was_applied_to_stock: true as const,
    }]
  })
}

export function isConfirmedConsumption(event: InventoryHistoryEvent): boolean {
  return event.event_type === "REMOVE" && event.remove_reason === "DRANK"
}

export function legacyInventoryHistoryEvents(
  rows: readonly LegacyInventoryHistoryRow[],
  householdId: string,
): InventoryHistoryEvent[] {
  return rows.filter((row) => row.household_id === householdId).map((row) => ({
    event_key: `legacy-v01:${row.source_record_id}`,
    event_source: "LEGACY_V01",
    source_record_id: row.source_record_id,
    household_id: row.household_id,
    wine_id: row.wine_id,
    event_type: row.event_type,
    quantity: row.quantity,
    source_location_id: null,
    destination_location_id: null,
    remove_reason: row.remove_reason,
    actor_user_id: null,
    occurred_at: row.occurred_at,
    occurred_at_precision: "INSTANT",
    recorded_at: row.recorded_at,
    was_applied_to_stock: false,
    source_legacy_cellar_id: row.source_from_cellar_id,
    source_legacy_location: row.source_from_location,
    destination_legacy_cellar_id: row.source_to_cellar_id,
    destination_legacy_location: row.source_to_location,
  }))
}
