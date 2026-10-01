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
  event_source: "ACCEPTED_OPERATION"
  source_record_id: string
  household_id: string
  wine_id: string
  event_type: "ADD" | "MOVE" | "REMOVE"
  quantity: number
  source_location_id: string | null
  destination_location_id: string | null
  remove_reason: string | null
  actor_user_id: string
  occurred_at: string
  occurred_at_precision: "INSTANT"
  recorded_at: string
  was_applied_to_stock: true
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
