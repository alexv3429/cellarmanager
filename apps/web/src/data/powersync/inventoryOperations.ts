import { powerSyncDatabase } from "./database"

interface QueueInventoryOperationInput {
  householdId: string
  deviceId: string
  userId: string
  wineId: string
  sourceLocationId: string
  quantity: number
}

export interface QueueMoveInput
  extends QueueInventoryOperationInput {
  destinationLocationId: string
}

export type QueueConsumeInput =
  QueueInventoryOperationInput

interface QueueOperationInput
  extends QueueInventoryOperationInput {
  operationType: "MOVE" | "CONSUME"
  destinationLocationId: string | null
}

function validatePositiveQuantity(
  quantity: number,
): void {
  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    throw new Error(
      "Operation quantity must be a positive integer",
    )
  }
}

async function queueOperation(
  input: QueueOperationInput,
): Promise<string> {
  validatePositiveQuantity(input.quantity)

  if (
    input.operationType === "MOVE" &&
    input.destinationLocationId === null
  ) {
    throw new Error(
      "A MOVE operation requires a destination",
    )
  }

  if (
    input.destinationLocationId !== null &&
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
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `,
    [
      operationId,
      input.householdId,
      input.deviceId,
      input.userId,
      input.operationType,
      input.wineId,
      input.sourceLocationId,
      input.destinationLocationId,
      input.quantity,
      createdAtClient,
    ],
  )

  return operationId
}

export function queueMove(
  input: QueueMoveInput,
): Promise<string> {
  return queueOperation({
    ...input,
    operationType: "MOVE",
  })
}

export function queueConsume(
  input: QueueConsumeInput,
): Promise<string> {
  return queueOperation({
    ...input,
    operationType: "CONSUME",
    destinationLocationId: null,
  })
}
