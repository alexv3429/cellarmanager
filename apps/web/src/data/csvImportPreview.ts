import type { CsvCleanedSourceRow } from "./csvCleaning"
import type {
  CsvStorageIssueCode,
  CsvStorageReconciliationResult,
} from "./csvStorageReconciliation"
import type { CsvWineMatchResult } from "./csvWineMatching"
import {
  getWineIdentityKey,
  type WineCatalogEntry,
} from "./wineCatalog"

export type CsvImportPreviewIssueCode =
  | CsvStorageIssueCode
  | "AMBIGUOUS_WINE"
  | "INCOMPLETE_PREVIEW_DATA"
  | "INVALID_WINE"

export interface CsvImportPreviewIssue {
  category: "preview" | "storage" | "wine"
  code: CsvImportPreviewIssueCode
  message: string
  severity: "error" | "warning"
}

export type CsvImportPreviewStatus =
  | "blocked"
  | "ready"
  | "warning"

export type CsvImportWineAction =
  | "create"
  | "reuse"
  | "unresolved"

export interface CsvImportPreviewRow {
  existingWine: WineCatalogEntry | null
  issues: CsvImportPreviewIssue[]
  row: CsvCleanedSourceRow
  status: CsvImportPreviewStatus
  storage: CsvStorageReconciliationResult | null
  wineAction: CsvImportWineAction
  wineMatch: CsvWineMatchResult | null
}

export interface CsvImportPreviewSummary {
  blockedBottleCount: number
  blockedRowCount: number
  destinationCount: number
  existingWineCount: number
  newWineCount: number
  readyBottleCount: number
  readyRowCount: number
  totalBottleCount: number
  totalRowCount: number
  warningLocationCount: number
}

function issue(
  category: CsvImportPreviewIssue["category"],
  code: CsvImportPreviewIssueCode,
  message: string,
  severity: CsvImportPreviewIssue["severity"] = "error",
): CsvImportPreviewIssue {
  return { category, code, message, severity }
}

function classifyWine(
  match: CsvWineMatchResult | null,
): {
  existingWine: WineCatalogEntry | null
  issues: CsvImportPreviewIssue[]
  wineAction: CsvImportWineAction
} {
  if (match === null) {
    return {
      existingWine: null,
      issues: [
        issue(
          "preview",
          "INCOMPLETE_PREVIEW_DATA",
          "Wine matching is missing for this source row",
        ),
      ],
      wineAction: "unresolved",
    }
  }

  switch (match.classification) {
    case "ambiguous":
      return {
        existingWine: null,
        issues: [
          issue(
            "wine",
            "AMBIGUOUS_WINE",
            `Choose one of ${match.candidates.length} matching catalog references before import`,
          ),
        ],
        wineAction: "unresolved",
      }
    case "existing": {
      const existingWine = match.candidates[0] ?? null

      return existingWine
        ? {
            existingWine,
            issues: [],
            wineAction: "reuse",
          }
        : {
            existingWine: null,
            issues: [
              issue(
                "preview",
                "INCOMPLETE_PREVIEW_DATA",
                "The existing-wine match has no catalog reference",
              ),
            ],
            wineAction: "unresolved",
          }
    }
    case "invalid":
      return {
        existingWine: null,
        issues: [
          issue(
            "wine",
            "INVALID_WINE",
            "Resolve the source-row validation issues before import",
          ),
        ],
        wineAction: "unresolved",
      }
    case "new":
      return {
        existingWine: null,
        issues: [],
        wineAction: "create",
      }
  }
}

function buildPreviewRow(
  row: CsvCleanedSourceRow,
  wineMatch: CsvWineMatchResult | null,
  storage: CsvStorageReconciliationResult | null,
): CsvImportPreviewRow {
  const wine = classifyWine(wineMatch)
  const issues = [...wine.issues]

  if (storage === null) {
    issues.push(
      issue(
        "preview",
        "INCOMPLETE_PREVIEW_DATA",
        "Storage reconciliation is missing for this source row",
      ),
    )
  } else {
    for (const storageIssue of storage.issues) {
      if (
        storageIssue.code === "INVALID_SOURCE_ROW" &&
        wineMatch?.classification === "invalid"
      ) {
        continue
      }

      issues.push({
        category: "storage",
        ...storageIssue,
      })
    }

    if (
      storage.status !== "ready" &&
      !storage.issues.some(
        (storageIssue) => storageIssue.severity === "error",
      )
    ) {
      issues.push(
        issue(
          "preview",
          "INCOMPLETE_PREVIEW_DATA",
          "Storage is not ready for this source row",
        ),
      )
    }
  }

  const status = issues.some(
    (previewIssue) => previewIssue.severity === "error",
  )
    ? "blocked"
    : issues.some(
          (previewIssue) => previewIssue.severity === "warning",
        )
      ? "warning"
      : "ready"

  return {
    existingWine: wine.existingWine,
    issues,
    row,
    status,
    storage,
    wineAction: wine.wineAction,
    wineMatch,
  }
}

export function buildCsvImportPreview(
  wineMatches: CsvWineMatchResult[],
  storageResults: CsvStorageReconciliationResult[],
): CsvImportPreviewRow[] {
  const wineMatchesByRecord = new Map(
    wineMatches.map((match) => [match.row.recordNumber, match]),
  )
  const storageByRecord = new Map(
    storageResults.map((result) => [result.row.recordNumber, result]),
  )
  const orderedRecordNumbers = [
    ...wineMatches.map((match) => match.row.recordNumber),
    ...storageResults
      .map((result) => result.row.recordNumber)
      .filter(
        (recordNumber) =>
          !wineMatchesByRecord.has(recordNumber),
      ),
  ]

  return orderedRecordNumbers.map((recordNumber) => {
    const wineMatch =
      wineMatchesByRecord.get(recordNumber) ?? null
    const storage = storageByRecord.get(recordNumber) ?? null
    const row = wineMatch?.row ?? storage?.row

    if (!row) {
      throw new Error(
        `Import preview source record ${recordNumber} is missing`,
      )
    }

    return buildPreviewRow(row, wineMatch, storage)
  })
}

export function summarizeCsvImportPreview(
  rows: CsvImportPreviewRow[],
): CsvImportPreviewSummary {
  const destinationIds = new Set<string>()
  const existingWineIds = new Set<string>()
  const newWineIdentityKeys = new Set<string>()
  const warningLocationIds = new Set<string>()

  for (const previewRow of rows) {
    if (previewRow.storage?.location) {
      destinationIds.add(previewRow.storage.location.id)
    }

    if (previewRow.existingWine) {
      existingWineIds.add(previewRow.existingWine.id)
    }

    if (previewRow.wineAction === "create") {
      const { color, cuvee, formatMl, producer, vintage } =
        previewRow.row.fields
      const identityKey =
        producer && cuvee && color && formatMl
          ? getWineIdentityKey(
              producer,
              cuvee,
              vintage,
              color,
              formatMl,
            )
          : null

      if (identityKey) {
        newWineIdentityKeys.add(identityKey)
      }
    }

    if (
      previewRow.storage?.location &&
      previewRow.issues.some(
        (previewIssue) =>
          previewIssue.code === "LOCATION_CAPACITY_EXCEEDED",
      )
    ) {
      warningLocationIds.add(previewRow.storage.location.id)
    }
  }

  return rows.reduce<CsvImportPreviewSummary>(
    (summary, previewRow) => {
      const quantity = previewRow.row.fields.quantity ?? 0
      const isBlocked = previewRow.status === "blocked"

      return {
        blockedBottleCount:
          summary.blockedBottleCount +
          (isBlocked ? quantity : 0),
        blockedRowCount:
          summary.blockedRowCount + (isBlocked ? 1 : 0),
        destinationCount: destinationIds.size,
        existingWineCount: existingWineIds.size,
        newWineCount: newWineIdentityKeys.size,
        readyBottleCount:
          summary.readyBottleCount +
          (isBlocked ? 0 : quantity),
        readyRowCount:
          summary.readyRowCount + (isBlocked ? 0 : 1),
        totalBottleCount:
          summary.totalBottleCount + quantity,
        totalRowCount: summary.totalRowCount + 1,
        warningLocationCount: warningLocationIds.size,
      }
    },
    {
      blockedBottleCount: 0,
      blockedRowCount: 0,
      destinationCount: 0,
      existingWineCount: 0,
      newWineCount: 0,
      readyBottleCount: 0,
      readyRowCount: 0,
      totalBottleCount: 0,
      totalRowCount: 0,
      warningLocationCount: 0,
    },
  )
}
