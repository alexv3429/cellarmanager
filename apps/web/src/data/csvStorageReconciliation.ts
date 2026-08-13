import type { CsvCleanedSourceRow } from "./csvCleaning"
import { cleanWineText } from "./wineCatalog"

type SyncedBoolean = boolean | number | null | undefined

export interface CsvStorageCellar {
  household_id: string
  id: string
  is_active: SyncedBoolean
  name: string
}

export interface CsvStorageLocation {
  bottle_count: number
  capacity: number | null
  cellar_id: string
  code: string
  household_id: string
  id: string
  is_active: SyncedBoolean
}

export type CsvStorageIssueCode =
  | "AMBIGUOUS_CELLAR"
  | "AMBIGUOUS_LOCATION"
  | "ARCHIVED_CELLAR"
  | "ARCHIVED_LOCATION"
  | "INVALID_SOURCE_ROW"
  | "INVALID_LOCATION_SELECTION"
  | "LOCATION_CAPACITY_EXCEEDED"
  | "MISSING_CELLAR"
  | "MISSING_LOCATION"
  | "MISSING_STORAGE"
  | "UNKNOWN_CELLAR"
  | "UNKNOWN_LOCATION"

export interface CsvStorageIssue {
  code: CsvStorageIssueCode
  message: string
  severity: "error" | "warning"
}

export type CsvStorageReconciliationStatus =
  | "invalid"
  | "ready"
  | "unresolved"

export interface CsvStorageReconciliationResult {
  cellar: CsvStorageCellar | null
  currentBottleCount: number | null
  importBottleCount: number | null
  issues: CsvStorageIssue[]
  location: CsvStorageLocation | null
  projectedBottleCount: number | null
  quantity: number | null
  row: CsvCleanedSourceRow
  status: CsvStorageReconciliationStatus
}

export interface CsvStorageReconciliationSummary {
  assignedBottleCount: number
  capacityWarningLocationCount: number
  readyRowCount: number
  totalBottleCount: number
  totalRowCount: number
  unresolvedRowCount: number
}

export type CsvStorageLocationSelections = Readonly<
  Record<number, string | undefined>
>

interface PreliminaryResult {
  cellar: CsvStorageCellar | null
  issues: CsvStorageIssue[]
  location: CsvStorageLocation | null
  quantity: number | null
  row: CsvCleanedSourceRow
  status: CsvStorageReconciliationStatus
}

function storageKey(value: string): string {
  return cleanWineText(value).toLowerCase()
}

function isActive(value: SyncedBoolean): boolean {
  return value !== false && value !== 0
}

function issue(
  code: CsvStorageIssueCode,
  message: string,
  severity: CsvStorageIssue["severity"] = "error",
): CsvStorageIssue {
  return { code, message, severity }
}

function classifyStorage(
  row: CsvCleanedSourceRow,
  cellars: CsvStorageCellar[],
  locations: CsvStorageLocation[],
  householdId: string,
  selectedLocationId?: string,
): PreliminaryResult {
  const quantity = row.fields.quantity

  if (row.issues.length > 0 || quantity === null) {
    return {
      cellar: null,
      issues: [
        issue(
          "INVALID_SOURCE_ROW",
          "Resolve the source-row validation issues before assigning storage",
        ),
      ],
      location: null,
      quantity,
      row,
      status: "invalid",
    }
  }

  if (selectedLocationId) {
    const location = locations.find(
      (candidate) =>
        candidate.id === selectedLocationId &&
        candidate.household_id === householdId &&
        isActive(candidate.is_active),
    )
    const cellar = location
      ? cellars.find(
          (candidate) =>
            candidate.id === location.cellar_id &&
            candidate.household_id === householdId &&
            isActive(candidate.is_active),
        ) ?? null
      : null

    if (location && cellar) {
      return {
        cellar,
        issues: [],
        location,
        quantity,
        row,
        status: "ready",
      }
    }

    return {
      cellar: null,
      issues: [
        issue(
          "INVALID_LOCATION_SELECTION",
          "The selected destination is no longer an active location in this household",
        ),
      ],
      location: null,
      quantity,
      row,
      status: "unresolved",
    }
  }

  const sourceCellar = row.fields.cellar
  const sourceLocation = row.fields.location

  if (sourceCellar === null && sourceLocation === null) {
    return {
      cellar: null,
      issues: [
        issue(
          "MISSING_STORAGE",
          "Choose a cellar and location before import",
        ),
      ],
      location: null,
      quantity,
      row,
      status: "unresolved",
    }
  }

  if (sourceCellar === null) {
    return {
      cellar: null,
      issues: [
        issue(
          "MISSING_CELLAR",
          "A location cannot be matched without its cellar",
        ),
      ],
      location: null,
      quantity,
      row,
      status: "unresolved",
    }
  }

  const cellarKey = storageKey(sourceCellar)
  const matchingCellars = cellars.filter(
    (cellar) =>
      cellar.household_id === householdId &&
      storageKey(cellar.name) === cellarKey,
  )
  const activeCellars = matchingCellars.filter((cellar) =>
    isActive(cellar.is_active),
  )

  if (activeCellars.length > 1) {
    return {
      cellar: null,
      issues: [
        issue(
          "AMBIGUOUS_CELLAR",
          `${activeCellars.length} active cellars match “${sourceCellar}”`,
        ),
      ],
      location: null,
      quantity,
      row,
      status: "unresolved",
    }
  }

  const cellar = activeCellars[0] ?? null

  if (cellar === null) {
    const matchingArchivedCellars = matchingCellars.filter(
      (candidate) => !isActive(candidate.is_active),
    )

    return {
      cellar: null,
      issues: [
        matchingArchivedCellars.length > 0
          ? issue(
              "ARCHIVED_CELLAR",
              `Cellar “${sourceCellar}” is archived`,
            )
          : issue(
              "UNKNOWN_CELLAR",
              `No cellar matches “${sourceCellar}”`,
            ),
      ],
      location: null,
      quantity,
      row,
      status: "unresolved",
    }
  }

  if (sourceLocation === null) {
    return {
      cellar,
      issues: [
        issue(
          "MISSING_LOCATION",
          `Choose a location inside ${cellar.name} before import`,
        ),
      ],
      location: null,
      quantity,
      row,
      status: "unresolved",
    }
  }

  const locationKey = storageKey(sourceLocation)
  const matchingLocations = locations.filter(
    (location) =>
      location.household_id === householdId &&
      location.cellar_id === cellar.id &&
      storageKey(location.code) === locationKey,
  )
  const activeLocations = matchingLocations.filter((location) =>
    isActive(location.is_active),
  )

  if (activeLocations.length > 1) {
    return {
      cellar,
      issues: [
        issue(
          "AMBIGUOUS_LOCATION",
          `${activeLocations.length} active locations in ${cellar.name} match “${sourceLocation}”`,
        ),
      ],
      location: null,
      quantity,
      row,
      status: "unresolved",
    }
  }

  const location = activeLocations[0] ?? null

  if (location === null) {
    const matchingArchivedLocations = matchingLocations.filter(
      (candidate) => !isActive(candidate.is_active),
    )

    return {
      cellar,
      issues: [
        matchingArchivedLocations.length > 0
          ? issue(
              "ARCHIVED_LOCATION",
              `Location ${cellar.name} / ${sourceLocation} is archived`,
            )
          : issue(
              "UNKNOWN_LOCATION",
              `No location in ${cellar.name} matches “${sourceLocation}”`,
            ),
      ],
      location: null,
      quantity,
      row,
      status: "unresolved",
    }
  }

  return {
    cellar,
    issues: [],
    location,
    quantity,
    row,
    status: "ready",
  }
}

export function reconcileCsvStorage(
  rows: CsvCleanedSourceRow[],
  cellars: CsvStorageCellar[],
  locations: CsvStorageLocation[],
  householdId: string,
  locationSelections: CsvStorageLocationSelections = {},
): CsvStorageReconciliationResult[] {
  const preliminaryResults = rows.map((row) =>
    classifyStorage(
      row,
      cellars,
      locations,
      householdId,
      locationSelections[row.recordNumber],
    ),
  )
  const importBottleCountByLocation = new Map<string, number>()

  for (const result of preliminaryResults) {
    if (result.location === null || result.quantity === null) {
      continue
    }

    importBottleCountByLocation.set(
      result.location.id,
      (importBottleCountByLocation.get(result.location.id) ?? 0) +
        result.quantity,
    )
  }

  return preliminaryResults.map((result) => {
    if (result.location === null) {
      return {
        ...result,
        currentBottleCount: null,
        importBottleCount: null,
        projectedBottleCount: null,
      }
    }

    const currentBottleCount = result.location.bottle_count
    const importBottleCount =
      importBottleCountByLocation.get(result.location.id) ?? 0
    const projectedBottleCount =
      currentBottleCount + importBottleCount
    const capacity = result.location.capacity
    const capacityIssue =
      capacity !== null && projectedBottleCount > capacity
        ? issue(
            "LOCATION_CAPACITY_EXCEEDED",
            `${result.cellar?.name ?? "Cellar"} / ${result.location.code} would hold ${projectedBottleCount} bottles after this CSV, above its configured capacity of ${capacity}`,
            "warning",
          )
        : null

    return {
      ...result,
      currentBottleCount,
      importBottleCount,
      issues: capacityIssue
        ? [...result.issues, capacityIssue]
        : result.issues,
      projectedBottleCount,
    }
  })
}

export function summarizeCsvStorageReconciliation(
  results: CsvStorageReconciliationResult[],
): CsvStorageReconciliationSummary {
  const capacityWarningLocationIds = new Set<string>()

  for (const result of results) {
    if (
      result.location !== null &&
      result.issues.some(
        (storageIssue) =>
          storageIssue.code ===
          "LOCATION_CAPACITY_EXCEEDED",
      )
    ) {
      capacityWarningLocationIds.add(result.location.id)
    }
  }

  return results.reduce<CsvStorageReconciliationSummary>(
    (summary, result) => ({
      assignedBottleCount:
        summary.assignedBottleCount +
        (result.location === null ? 0 : (result.quantity ?? 0)),
      capacityWarningLocationCount:
        capacityWarningLocationIds.size,
      readyRowCount:
        summary.readyRowCount +
        (result.status === "ready" ? 1 : 0),
      totalBottleCount:
        summary.totalBottleCount + (result.quantity ?? 0),
      totalRowCount: summary.totalRowCount + 1,
      unresolvedRowCount:
        summary.unresolvedRowCount +
        (result.status === "ready" ? 0 : 1),
    }),
    {
      assignedBottleCount: 0,
      capacityWarningLocationCount: 0,
      readyRowCount: 0,
      totalBottleCount: 0,
      totalRowCount: 0,
      unresolvedRowCount: 0,
    },
  )
}
