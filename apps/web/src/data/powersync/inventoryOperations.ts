import { cleanWineText } from "../wineCatalog"
import { powerSyncDatabase } from "./database"

interface QueueInventoryOperationInput {
  householdId: string
  deviceId: string
  userId: string
  wineId: string
  quantity: number
}

export interface QueueAddInput
  extends QueueInventoryOperationInput {
  destinationLocationId: string
  wineProducer?: string
  wineCuvee?: string
  wineVintage?: number | null
  wineColor?: string
  wineAppellation?: string | null
  wineArea?: string | null
  wineFormatMl?: number
}

export interface QueueMoveInput
  extends QueueInventoryOperationInput {
  sourceLocationId: string
  destinationLocationId: string
}

export type RemoveReason =
  | "DRANK"
  | "GIFTED"
  | "BROKEN"
  | "LOST"
  | "OTHER"

export interface QueueRemoveInput
  extends QueueInventoryOperationInput {
  sourceLocationId: string
  removeReason: RemoveReason
}

interface QueueOperationInput
  extends QueueInventoryOperationInput {
  operationType: "ADD" | "MOVE" | "REMOVE"
  sourceLocationId: string | null
  destinationLocationId: string | null
  removeReason: RemoveReason | null
  wineProducer: string | null
  wineCuvee: string | null
  wineVintage: number | null
  wineColor: string | null
  wineAppellation: string | null
  wineArea: string | null
  wineFormatMl: number | null
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

function cleanOptionalWineText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const cleaned = cleanWineText(value)
  return cleaned.length > 0 ? cleaned : null
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

function validateWineVintage(
  vintage: number | null,
): void {
  if (
    vintage !== null &&
    (
      !Number.isInteger(vintage) ||
      vintage < 1800 ||
      vintage > 2200
    )
  ) {
    throw new Error(
      "Wine vintage must be null or an integer between 1800 and 2200",
    )
  }
}

function validateWineFormatMl(
  formatMl: number | null,
): void {
  if (
    formatMl === null ||
    !Number.isInteger(formatMl) ||
    formatMl <= 0
  ) {
    throw new Error(
      "Wine format must be a positive whole number of millilitres",
    )
  }
}

function validateOperationShape(
  input: QueueOperationInput,
): void {
  if (input.operationType === "ADD") {
    if (input.sourceLocationId !== null) {
      throw new Error(
        "An ADD operation must not define a source",
      )
    }

    if (input.destinationLocationId === null) {
      throw new Error(
        "An ADD operation requires a destination",
      )
    }

    if (input.removeReason !== null) {
      throw new Error(
        "An ADD operation must not define a remove reason",
      )
    }

    const hasWineIdentity =
      input.wineProducer !== null ||
      input.wineCuvee !== null ||
      input.wineColor !== null ||
      input.wineFormatMl !== null ||
      input.wineAppellation !== null ||
      input.wineArea !== null

    if (hasWineIdentity) {
      if (
        input.wineProducer === null ||
        cleanWineText(input.wineProducer).length === 0
      ) {
        throw new Error(
          "A new-wine ADD requires a producer",
        )
      }

      if (
        input.wineCuvee === null ||
        cleanWineText(input.wineCuvee).length === 0
      ) {
        throw new Error(
          "A new-wine ADD requires a cuvée",
        )
      }

      if (
        input.wineColor === null ||
        cleanWineText(input.wineColor).length === 0
      ) {
        throw new Error(
          "A new-wine ADD requires a color",
        )
      }

      validateWineVintage(input.wineVintage)
      validateWineFormatMl(input.wineFormatMl)
    }

    return
  }

  if (
    input.wineProducer !== null ||
    input.wineCuvee !== null ||
    input.wineVintage !== null ||
    input.wineColor !== null ||
    input.wineAppellation !== null ||
    input.wineArea !== null ||
    input.wineFormatMl !== null
  ) {
    throw new Error(
      `${input.operationType} must not define wine creation details`,
    )
  }

  if (input.operationType === "MOVE") {
    if (input.sourceLocationId === null) {
      throw new Error(
        "A MOVE operation requires a source",
      )
    }

    if (input.destinationLocationId === null) {
      throw new Error(
        "A MOVE operation requires a destination",
      )
    }

    if (
      input.sourceLocationId ===
      input.destinationLocationId
    ) {
      throw new Error(
        "Source and destination locations must differ",
      )
    }

    if (input.removeReason !== null) {
      throw new Error(
        "A MOVE operation must not define a remove reason",
      )
    }

    return
  }

  if (input.sourceLocationId === null) {
    throw new Error(
      "A REMOVE operation requires a source",
    )
  }

  if (input.destinationLocationId !== null) {
    throw new Error(
      "A REMOVE operation must not define a destination",
    )
  }

  if (input.removeReason === null) {
    throw new Error(
      "A REMOVE operation requires a reason",
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
    validateOperationShape(input)

    const operationId =
      dependencies.createOperationId()

    const createdAtClient =
      dependencies.now().toISOString()

    if (
      input.operationType === "ADD" &&
      input.wineProducer !== null &&
      input.wineCuvee !== null
    ) {
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
            remove_reason,
            wine_producer,
            wine_cuvee,
            wine_vintage,
            wine_color,
            wine_appellation,
            wine_area,
            wine_format_ml,
            status,
            created_at_client
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
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
          input.removeReason,
          input.wineProducer,
          input.wineCuvee,
          input.wineVintage,
          input.wineColor,
          input.wineAppellation,
          input.wineArea,
          input.wineFormatMl,
          createdAtClient,
        ],
      )

      return operationId
    }

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
          remove_reason,
          status,
          created_at_client
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
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
        input.removeReason,
        createdAtClient,
      ],
    )

    return operationId
  }

  return {
    async queueAdd(input: QueueAddInput): Promise<string> {
      const hasProducer =
        input.wineProducer !== undefined
      const hasCuvee =
        input.wineCuvee !== undefined
      const hasVintage =
        input.wineVintage !== undefined
      const hasColor =
        input.wineColor !== undefined
      const hasFormat =
        input.wineFormatMl !== undefined
      const hasOptionalMetadata =
        input.wineAppellation !== undefined ||
        input.wineArea !== undefined

      const hasAnyIdentity =
        hasProducer ||
        hasCuvee ||
        hasVintage ||
        hasColor ||
        hasFormat ||
        hasOptionalMetadata

      if (
        hasAnyIdentity &&
        !(
          hasProducer &&
          hasCuvee &&
          hasVintage &&
          hasColor &&
          hasFormat
        )
      ) {
        throw new Error(
          "New-wine ADD details must include producer, cuvée, vintage/NV, color, and format together",
        )
      }

      return queueOperation({
        ...input,
        operationType: "ADD",
        sourceLocationId: null,
        removeReason: null,
        wineProducer: hasProducer
          ? cleanWineText(input.wineProducer ?? "")
          : null,
        wineCuvee: hasCuvee
          ? cleanWineText(input.wineCuvee ?? "")
          : null,
        wineVintage: hasVintage
          ? input.wineVintage ?? null
          : null,
        wineColor: hasColor
          ? cleanWineText(
              input.wineColor ?? "",
            ).toLowerCase()
          : null,
        wineAppellation: hasAnyIdentity
          ? cleanOptionalWineText(
              input.wineAppellation,
            )
          : null,
        wineArea: hasAnyIdentity
          ? cleanOptionalWineText(input.wineArea)
          : null,
        wineFormatMl: hasFormat
          ? input.wineFormatMl ?? null
          : null,
      })
    },

    queueMove(input: QueueMoveInput): Promise<string> {
      return queueOperation({
        ...input,
        operationType: "MOVE",
        removeReason: null,
        wineProducer: null,
        wineCuvee: null,
        wineVintage: null,
        wineColor: null,
        wineAppellation: null,
        wineArea: null,
        wineFormatMl: null,
      })
    },

    queueRemove(
      input: QueueRemoveInput,
    ): Promise<string> {
      return queueOperation({
        ...input,
        operationType: "REMOVE",
        destinationLocationId: null,
        wineProducer: null,
        wineCuvee: null,
        wineVintage: null,
        wineColor: null,
        wineAppellation: null,
        wineArea: null,
        wineFormatMl: null,
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

export const queueAdd =
  inventoryOperationQueue.queueAdd

export const queueMove =
  inventoryOperationQueue.queueMove

export const queueRemove =
  inventoryOperationQueue.queueRemove
