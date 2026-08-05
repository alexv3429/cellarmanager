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

type SqlParameter = string | number | null

type ExecuteSql = (
  sql: string,
  parameters: SqlParameter[],
) => Promise<unknown>

interface QueueDependencies {
  execute: ExecuteSql
  createOperationId: () => string
  now: () => Date
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

export function createInventoryOperationQueue(
  dependencies: QueueDependencies,
) {
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

    const operationId =
      dependencies.createOperationId()

    const createdAtClient =
      dependencies.now().toISOString()

    await dependencies.execute(
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

  return {
    queueMove(input: QueueMoveInput): Promise<string> {
      return queueOperation({
        ...input,
        operationType: "MOVE",
      })
    },

    queueConsume(
      input: QueueConsumeInput,
    ): Promise<string> {
      return queueOperation({
        ...input,
        operationType: "CONSUME",
        destinationLocationId: null,
      })
    },
  }
}

const inventoryOperationQueue =
  createInventoryOperationQueue({
    execute: (sql, parameters) =>
      powerSyncDatabase.execute(sql, parameters),
    createOperationId: () => crypto.randomUUID(),
    now: () => new Date(),
  })

export const queueMove =
  inventoryOperationQueue.queueMove

export const queueConsume =
  inventoryOperationQueue.queueConsume
