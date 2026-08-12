import type { CsvCleanedSourceRow } from "./csvCleaning"
import {
  findMatchingWines,
  getWineIdentityKey,
  type WineCatalogEntry,
} from "./wineCatalog"

export type CsvWineMatchClassification =
  | "ambiguous"
  | "existing"
  | "invalid"
  | "new"

export interface CsvWineMatchResult {
  candidates: WineCatalogEntry[]
  classification: CsvWineMatchClassification
  row: CsvCleanedSourceRow
}

export interface CsvWineMatchingSummary {
  ambiguousRowCount: number
  existingRowCount: number
  invalidRowCount: number
  newRowCount: number
  totalRowCount: number
}

function compareNullableText(
  left: string | null,
  right: string | null,
): number {
  return (left ?? "").localeCompare(right ?? "")
}

function compareCandidates(
  left: WineCatalogEntry,
  right: WineCatalogEntry,
): number {
  return (
    compareNullableText(left.appellation, right.appellation) ||
    compareNullableText(left.area, right.area) ||
    left.id.localeCompare(right.id)
  )
}

function cleanedRowIdentityKey(
  row: CsvCleanedSourceRow,
): string | null {
  const {
    color,
    cuvee,
    formatMl,
    producer,
    vintage,
  } = row.fields

  if (
    row.issues.length > 0 ||
    color === null ||
    cuvee === null ||
    formatMl === null ||
    producer === null
  ) {
    return null
  }

  return getWineIdentityKey(
    producer,
    cuvee,
    vintage,
    color,
    formatMl,
  )
}

function classifyCsvWine(
  row: CsvCleanedSourceRow,
  candidates: WineCatalogEntry[],
): CsvWineMatchResult {
  if (cleanedRowIdentityKey(row) === null) {
    return {
      candidates: [],
      classification: "invalid",
      row,
    }
  }

  return {
    candidates,
    classification:
      candidates.length === 0
        ? "new"
        : candidates.length === 1
          ? "existing"
          : "ambiguous",
    row,
  }
}

export function matchCsvWine(
  row: CsvCleanedSourceRow,
  wines: WineCatalogEntry[],
  householdId: string,
): CsvWineMatchResult {
  const identityKey = cleanedRowIdentityKey(row)

  if (identityKey === null) {
    return classifyCsvWine(row, [])
  }

  const { color, cuvee, formatMl, producer, vintage } =
    row.fields
  const candidates = findMatchingWines(
    wines,
    householdId,
    producer as string,
    cuvee as string,
    vintage,
    color as string,
    formatMl as number,
  ).sort(compareCandidates)

  return classifyCsvWine(row, candidates)
}

export function matchCsvWines(
  rows: CsvCleanedSourceRow[],
  wines: WineCatalogEntry[],
  householdId: string,
): CsvWineMatchResult[] {
  const candidatesByIdentity = new Map<
    string,
    WineCatalogEntry[]
  >()

  for (const wine of wines) {
    if (wine.household_id !== householdId) {
      continue
    }

    const identityKey = getWineIdentityKey(
      wine.producer,
      wine.cuvee,
      wine.vintage,
      wine.color,
      wine.format_ml,
    )

    if (identityKey === null) {
      continue
    }

    const candidates =
      candidatesByIdentity.get(identityKey) ?? []
    candidates.push(wine)
    candidatesByIdentity.set(identityKey, candidates)
  }

  for (const candidates of candidatesByIdentity.values()) {
    candidates.sort(compareCandidates)
  }

  return rows.map((row) => {
    const identityKey = cleanedRowIdentityKey(row)
    const candidates =
      identityKey === null
        ? []
        : candidatesByIdentity.get(identityKey) ?? []

    return classifyCsvWine(row, candidates)
  })
}

export function summarizeCsvWineMatching(
  results: CsvWineMatchResult[],
): CsvWineMatchingSummary {
  return results.reduce<CsvWineMatchingSummary>(
    (summary, result) => ({
      ambiguousRowCount:
        summary.ambiguousRowCount +
        (result.classification === "ambiguous" ? 1 : 0),
      existingRowCount:
        summary.existingRowCount +
        (result.classification === "existing" ? 1 : 0),
      invalidRowCount:
        summary.invalidRowCount +
        (result.classification === "invalid" ? 1 : 0),
      newRowCount:
        summary.newRowCount +
        (result.classification === "new" ? 1 : 0),
      totalRowCount: summary.totalRowCount + 1,
    }),
    {
      ambiguousRowCount: 0,
      existingRowCount: 0,
      invalidRowCount: 0,
      newRowCount: 0,
      totalRowCount: 0,
    },
  )
}
