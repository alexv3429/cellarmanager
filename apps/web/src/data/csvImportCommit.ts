import type { CsvImportPreviewRow } from "./csvImportPreview"
import { getWineIdentityKey } from "./wineCatalog"

export const CSV_IMPORT_COMMIT_ROW_LIMIT = 100_000
export const CSV_IMPORT_PENDING_STORAGE_PREFIX =
  "cellarmanager.csv_import_pending.v1."

export interface CsvImportCommitRow {
  destinationLocationId: string
  operationId: string
  quantity: number
  recordNumber: number
  requestedWineId: string
  wineAction: "create" | "reuse"
  wineAppellation: string | null
  wineArea: string | null
  wineColor: string
  wineCuvee: string
  wineFormatMl: number
  wineProducer: string
  wineVintage: number | null
}

export interface CsvImportCommitPlan {
  createdAtClient: string
  deviceId: string
  householdId: string
  importId: string
  rows: CsvImportCommitRow[]
  sourceKey: string
}

export interface CsvImportCommitResult {
  createdWineCount: number
  importId: string
  importedBottleCount: number
  importedRowCount: number
  reusedWineCount: number
}

interface CsvImportCommitDependencies {
  createUuid: () => string
  now: () => Date
}

interface CsvImportCommitStorage {
  getItem: (key: string) => string | null
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
}

interface RpcError {
  message: string
}

interface CsvImportRpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown
    error: RpcError | null
  }>
}

interface CsvImportCommitRpcRow {
  created_wine_count: unknown
  import_id: unknown
  imported_bottle_count: unknown
  imported_row_count: unknown
  reused_wine_count: unknown
}

async function getDefaultRpcClient(): Promise<CsvImportRpcClient> {
  const { supabase } = await import("./supabase")

  return supabase
}

function requireNonEmptyString(
  value: string | null | undefined,
  message: string,
): string {
  if (!value || value.trim().length === 0) {
    throw new Error(message)
  }

  return value
}

function requirePositiveInteger(
  value: number | null | undefined,
  message: string,
): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new Error(message)
  }

  return value as number
}

function previewSourceValue(row: CsvImportPreviewRow) {
  return {
    currentBottleCount: row.storage?.currentBottleCount ?? null,
    destinationLocationId: row.storage?.location?.id ?? null,
    existingWineId: row.existingWine?.id ?? null,
    issues: row.issues.map((issue) => ({
      category: issue.category,
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
    })),
    projectedBottleCount:
      row.storage?.projectedBottleCount ?? null,
    quantity: row.row.fields.quantity,
    recordNumber: row.row.recordNumber,
    status: row.status,
    wine: {
      appellation: row.row.fields.appellation,
      area: row.row.fields.area,
      color: row.row.fields.color,
      cuvee: row.row.fields.cuvee,
      formatMl: row.row.fields.formatMl,
      producer: row.row.fields.producer,
      vintage: row.row.fields.vintage,
    },
    wineAction: row.wineAction,
  }
}

export function getCsvImportCommitSourceKey(
  previewRows: CsvImportPreviewRow[],
): string {
  return JSON.stringify(previewRows.map(previewSourceValue))
}

export function createCsvImportCommitPlan(
  {
    deviceId,
    householdId,
    previewRows,
  }: {
    deviceId: string
    householdId: string
    previewRows: CsvImportPreviewRow[]
  },
  dependencies: CsvImportCommitDependencies = {
    createUuid: () => crypto.randomUUID(),
    now: () => new Date(),
  },
): CsvImportCommitPlan {
  requireNonEmptyString(
    householdId,
    "An active household is required before import",
  )
  requireNonEmptyString(
    deviceId,
    "A registered device is required before import",
  )

  if (previewRows.length === 0) {
    throw new Error("The import preview has no rows")
  }

  if (previewRows.length > CSV_IMPORT_COMMIT_ROW_LIMIT) {
    throw new Error(
      `The import cannot contain more than ${CSV_IMPORT_COMMIT_ROW_LIMIT.toLocaleString()} rows`,
    )
  }

  const importId = dependencies.createUuid()
  const operationIds = new Set<string>()
  const recordNumbers = new Set<number>()
  const requestedWineIdByIdentity = new Map<string, string>()

  const rows = previewRows.map((previewRow) => {
    const { fields } = previewRow.row
    const recordNumber = previewRow.row.recordNumber

    if (previewRow.status === "blocked") {
      throw new Error(
        `Source record ${recordNumber} is still blocked`,
      )
    }

    if (recordNumbers.has(recordNumber)) {
      throw new Error(
        `Source record ${recordNumber} appears more than once`,
      )
    }
    recordNumbers.add(recordNumber)

    const producer = requireNonEmptyString(
      fields.producer,
      `Source record ${recordNumber} has no producer`,
    )
    const cuvee = requireNonEmptyString(
      fields.cuvee,
      `Source record ${recordNumber} has no cuvée`,
    )
    const color = requireNonEmptyString(
      fields.color,
      `Source record ${recordNumber} has no color`,
    )
    const formatMl = requirePositiveInteger(
      fields.formatMl,
      `Source record ${recordNumber} has no valid bottle format`,
    )
    const quantity = requirePositiveInteger(
      fields.quantity,
      `Source record ${recordNumber} has no valid quantity`,
    )
    const destinationLocationId = requireNonEmptyString(
      previewRow.storage?.location?.id,
      `Source record ${recordNumber} has no destination`,
    )
    const identityKey = getWineIdentityKey(
      producer,
      cuvee,
      fields.vintage,
      color,
      formatMl,
    )

    if (!identityKey) {
      throw new Error(
        `Source record ${recordNumber} has no valid wine identity`,
      )
    }

    let requestedWineId: string

    if (previewRow.wineAction === "reuse") {
      const existingWine = previewRow.existingWine

      if (
        !existingWine ||
        existingWine.household_id !== householdId ||
        getWineIdentityKey(
          existingWine.producer,
          existingWine.cuvee,
          existingWine.vintage,
          existingWine.color,
          existingWine.format_ml,
        ) !== identityKey
      ) {
        throw new Error(
          `Source record ${recordNumber} has an invalid existing-wine decision`,
        )
      }

      requestedWineId = existingWine.id
    } else if (previewRow.wineAction === "create") {
      const sharedWineId =
        requestedWineIdByIdentity.get(identityKey)

      requestedWineId = sharedWineId ?? dependencies.createUuid()
      requestedWineIdByIdentity.set(
        identityKey,
        requestedWineId,
      )
    } else {
      throw new Error(
        `Source record ${recordNumber} has no wine decision`,
      )
    }

    const operationId = dependencies.createUuid()

    if (operationIds.has(operationId)) {
      throw new Error("Generated duplicate inventory operation IDs")
    }
    operationIds.add(operationId)

    return {
      destinationLocationId,
      operationId,
      quantity,
      recordNumber,
      requestedWineId,
      wineAction: previewRow.wineAction,
      wineAppellation: fields.appellation,
      wineArea: fields.area,
      wineColor: color,
      wineCuvee: cuvee,
      wineFormatMl: formatMl,
      wineProducer: producer,
      wineVintage: fields.vintage,
    }
  })

  return {
    createdAtClient: dependencies.now().toISOString(),
    deviceId,
    householdId,
    importId,
    rows,
    sourceKey: getCsvImportCommitSourceKey(previewRows),
  }
}

function pendingStorageKey(householdId: string): string {
  return `${CSV_IMPORT_PENDING_STORAGE_PREFIX}${householdId}`
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string"
}

function isPendingCommitRow(
  value: unknown,
): value is CsvImportCommitRow {
  if (!value || typeof value !== "object") {
    return false
  }

  const row = value as Record<string, unknown>

  return (
    typeof row.destinationLocationId === "string" &&
    typeof row.operationId === "string" &&
    Number.isInteger(row.quantity) &&
    (row.quantity as number) > 0 &&
    Number.isInteger(row.recordNumber) &&
    (row.recordNumber as number) > 0 &&
    typeof row.requestedWineId === "string" &&
    (row.wineAction === "create" ||
      row.wineAction === "reuse") &&
    isNullableString(row.wineAppellation) &&
    isNullableString(row.wineArea) &&
    typeof row.wineColor === "string" &&
    typeof row.wineCuvee === "string" &&
    Number.isInteger(row.wineFormatMl) &&
    (row.wineFormatMl as number) > 0 &&
    typeof row.wineProducer === "string" &&
    (row.wineVintage === null ||
      Number.isInteger(row.wineVintage))
  )
}

function isPendingCommitPlan(
  value: unknown,
  householdId: string,
): value is CsvImportCommitPlan {
  if (!value || typeof value !== "object") {
    return false
  }

  const plan = value as Record<string, unknown>

  return (
    typeof plan.createdAtClient === "string" &&
    typeof plan.deviceId === "string" &&
    plan.householdId === householdId &&
    typeof plan.importId === "string" &&
    Array.isArray(plan.rows) &&
    plan.rows.length > 0 &&
    plan.rows.length <= CSV_IMPORT_COMMIT_ROW_LIMIT &&
    plan.rows.every(isPendingCommitRow) &&
    typeof plan.sourceKey === "string"
  )
}

export function savePendingCsvImportPlan(
  storage: CsvImportCommitStorage,
  plan: CsvImportCommitPlan,
): void {
  storage.setItem(
    pendingStorageKey(plan.householdId),
    JSON.stringify(plan),
  )
}

export function readPendingCsvImportPlan(
  storage: CsvImportCommitStorage,
  householdId: string,
): CsvImportCommitPlan | null {
  try {
    const raw = storage.getItem(pendingStorageKey(householdId))

    if (!raw) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)
    return isPendingCommitPlan(parsed, householdId)
      ? parsed
      : null
  } catch {
    return null
  }
}

export function clearPendingCsvImportPlan(
  storage: CsvImportCommitStorage,
  householdId: string,
): void {
  try {
    storage.removeItem(pendingStorageKey(householdId))
  } catch {
    // Receipt cleanup is best-effort after the server outcome is known. A
    // stale saved plan will be rechecked and cleared on the next visit.
  }
}

export function clearAllPendingCsvImportPlans(
  storage: Storage,
): void {
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)

      if (key?.startsWith(CSV_IMPORT_PENDING_STORAGE_PREFIX)) {
        storage.removeItem(key)
      }
    }
  } catch {
    // Sign-out continues even if this browser blocks local storage access.
  }
}

function requireResultInteger(
  value: unknown,
  field: string,
): number {
  const numberValue =
    typeof value === "string" ? Number(value) : value

  if (
    typeof numberValue !== "number" ||
    !Number.isSafeInteger(numberValue) ||
    numberValue < 0
  ) {
    throw new Error(
      `Import response has an invalid ${field}`,
    )
  }

  return numberValue
}

function parseCommitResult(data: unknown): CsvImportCommitResult {
  const row = Array.isArray(data) ? data[0] : data

  if (!row || typeof row !== "object") {
    throw new Error("Import response is missing its receipt")
  }

  const result = row as CsvImportCommitRpcRow

  return {
    createdWineCount: requireResultInteger(
      result.created_wine_count,
      "created wine count",
    ),
    importId: requireNonEmptyString(
      typeof result.import_id === "string"
        ? result.import_id
        : null,
      "Import response has no receipt ID",
    ),
    importedBottleCount: requireResultInteger(
      result.imported_bottle_count,
      "bottle count",
    ),
    importedRowCount: requireResultInteger(
      result.imported_row_count,
      "row count",
    ),
    reusedWineCount: requireResultInteger(
      result.reused_wine_count,
      "reused wine count",
    ),
  }
}

export async function commitCsvImport(
  plan: CsvImportCommitPlan,
  rpcClient?: CsvImportRpcClient,
): Promise<CsvImportCommitResult> {
  const client = rpcClient ?? (await getDefaultRpcClient())
  const { data, error } = await client.rpc(
    "commit_csv_import",
    {
      p_created_at_client: plan.createdAtClient,
      p_device_id: plan.deviceId,
      p_household_id: plan.householdId,
      p_import_id: plan.importId,
      p_rows: plan.rows.map((row) => ({
        destination_location_id: row.destinationLocationId,
        operation_id: row.operationId,
        quantity: row.quantity,
        record_number: row.recordNumber,
        requested_wine_id: row.requestedWineId,
        wine_action: row.wineAction,
        wine_appellation: row.wineAppellation,
        wine_area: row.wineArea,
        wine_color: row.wineColor,
        wine_cuvee: row.wineCuvee,
        wine_format_ml: row.wineFormatMl,
        wine_producer: row.wineProducer,
        wine_vintage: row.wineVintage,
      })),
    },
  )

  if (error) {
    throw new Error(`CSV import failed: ${error.message}`)
  }

  const result = parseCommitResult(data)

  if (result.importId !== plan.importId) {
    throw new Error("Import response receipt does not match the request")
  }

  return result
}

export async function getCsvImportReceipt(
  {
    householdId,
    importId,
  }: {
    householdId: string
    importId: string
  },
  rpcClient?: CsvImportRpcClient,
): Promise<CsvImportCommitResult | null> {
  const client = rpcClient ?? (await getDefaultRpcClient())
  const { data, error } = await client.rpc(
    "get_csv_import_receipt",
    {
      p_household_id: householdId,
      p_import_id: importId,
    },
  )

  if (error) {
    throw new Error(
      `Unable to verify the CSV import receipt: ${error.message}`,
    )
  }

  if (
    data === null ||
    (Array.isArray(data) && data.length === 0)
  ) {
    return null
  }

  return parseCommitResult(data)
}
