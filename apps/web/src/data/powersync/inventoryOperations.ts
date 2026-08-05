import { powerSyncDatabase } from "./database"

export interface QueueMoveInput {
  householdId: string
  deviceId: string
  userId: string
  wineId: string
  sourceLocationId: string
  destinationLocationId: string
  quantity: number
}

export async function queueMove(
  input: QueueMoveInput,
): Promise<string> {
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity <= 0
  ) {
    throw new Error("Move quantity must be a positive integer")
  }

  if (
    input.sourceLocationId ===
    input.destinationLocationId
  ) {
    throw new Error(
      "Source and destination locations must differ",
    )
  }

  const operationId = crypto.randomUUID()
  const createdAtClient = new Date().toISOString()

  await powerSyncDatabase.execute(
    `
      insert into inventory_operations (
        id,
        household_id,
        device_id,
        user_id,
        operation_type,
        wine_id,
        source_location_id,
        destination_location_id,
        quantity,
        status,
        created_at_client
      )
      values (?, ?, ?, ?, 'MOVE', ?, ?, ?, ?, 'PENDING', ?)
    `,
    [
      operationId,
      input.householdId,
      input.deviceId,
      input.userId,
      input.wineId,
      input.sourceLocationId,
      input.destinationLocationId,
      input.quantity,
      createdAtClient,
    ],
  )

  return operationId
}
