import type {
  CsvStorageCellar,
  CsvStorageLocation,
  CsvStorageLocationSelections,
  CsvStorageReconciliationResult,
} from "./csvStorageReconciliation"
import { reconcileCsvStorage } from "./csvStorageReconciliation"
import type { CsvCleanedSourceRow } from "./csvCleaning"
import type { CsvWineMatchResult } from "./csvWineMatching"

export type CsvWineSelections = Readonly<
  Record<number, string | undefined>
>

export interface CsvImportResolutionSelections {
  locationIdByRecord: CsvStorageLocationSelections
  wineIdByRecord: CsvWineSelections
}

export interface CsvResolvedImportIssues {
  storageResults: CsvStorageReconciliationResult[]
  wineMatches: CsvWineMatchResult[]
}

export interface CsvImportStorageOption {
  cellar: CsvStorageCellar
  location: CsvStorageLocation
}

function isActive(value: boolean | number | null | undefined): boolean {
  return value !== false && value !== 0
}

export function getCsvImportStorageOptions(
  cellars: CsvStorageCellar[],
  locations: CsvStorageLocation[],
  householdId: string,
): CsvImportStorageOption[] {
  const activeCellarsById = new Map(
    cellars
      .filter(
        (cellar) =>
          cellar.household_id === householdId &&
          isActive(cellar.is_active),
      )
      .map((cellar) => [cellar.id, cellar]),
  )

  return locations
    .flatMap((location) => {
      const cellar = activeCellarsById.get(location.cellar_id)

      return location.household_id === householdId &&
        isActive(location.is_active) &&
        cellar
        ? [{ cellar, location }]
        : []
    })
    .sort(
      (left, right) =>
        left.cellar.name.localeCompare(right.cellar.name) ||
        left.location.code.localeCompare(right.location.code) ||
        left.location.id.localeCompare(right.location.id),
    )
}

export function applyCsvWineSelections(
  wineMatches: CsvWineMatchResult[],
  wineIdByRecord: CsvWineSelections,
): CsvWineMatchResult[] {
  return wineMatches.map((match) => {
    if (match.classification !== "ambiguous") {
      return match
    }

    const selectedWineId =
      wineIdByRecord[match.row.recordNumber]
    const selectedWine = match.candidates.find(
      (candidate) => candidate.id === selectedWineId,
    )

    return selectedWine
      ? {
          candidates: [selectedWine],
          classification: "existing",
          row: match.row,
        }
      : match
  })
}

export function resolveCsvImportIssues({
  cellars,
  householdId,
  locations,
  rows,
  selections,
  wineMatches,
}: {
  cellars: CsvStorageCellar[]
  householdId: string
  locations: CsvStorageLocation[]
  rows: CsvCleanedSourceRow[]
  selections: CsvImportResolutionSelections
  wineMatches: CsvWineMatchResult[]
}): CsvResolvedImportIssues {
  return {
    storageResults: reconcileCsvStorage(
      rows,
      cellars,
      locations,
      householdId,
      selections.locationIdByRecord,
    ),
    wineMatches: applyCsvWineSelections(
      wineMatches,
      selections.wineIdByRecord,
    ),
  }
}
