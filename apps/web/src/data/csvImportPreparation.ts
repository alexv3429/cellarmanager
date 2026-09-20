import { cleanCsvMappedRow, type CsvCleaningOptions } from "./csvCleaning"
import {
  mapCsvSourceRow,
  type CsvColumnMapping,
  type CsvImportFieldDefaults,
} from "./csvColumnMapping"
import type { CsvIngestionDocument } from "./csvIngestion"

export type CsvRowCorrections = Record<number, CsvImportFieldDefaults>

// Preparation is an in-memory overlay. Original cells and stable record IDs
// remain available, while every included edit goes through normal validation.
export function prepareCsvImportRows({
  document, mapping, defaults = {}, corrections = {}, excluded = new Set<number>(), options = {},
}: {
  document: CsvIngestionDocument | null
  mapping: CsvColumnMapping
  defaults?: CsvImportFieldDefaults
  corrections?: CsvRowCorrections
  excluded?: ReadonlySet<number>
  options?: CsvCleaningOptions
}) {
  const allRows = document?.header ? document.rows.map((row) => {
    const source = mapCsvSourceRow(document.header!.values, row, mapping)
    const fields = { ...source.fields, ...corrections[row.recordNumber] }
    const defaultsApplied = Object.keys(defaults).filter((key) => {
      const field = key as keyof CsvImportFieldDefaults
      if (Object.hasOwn(corrections[row.recordNumber] ?? {}, field) || fields[field]?.trim() || !defaults[field]?.trim()) return false
      fields[field] = defaults[field]
      return true
    }) as Array<keyof CsvImportFieldDefaults>
    return {
      original: source,
      sourceValues: row.values,
      defaultsApplied,
      cleaned: cleanCsvMappedRow({ ...source, fields }, options),
      excluded: excluded.has(row.recordNumber),
    }
  }) : []
  return {
    allRows,
    includedRows: allRows.filter((row) => !row.excluded).map((row) => row.cleaned),
  }
}

export type CsvPreparedRow = ReturnType<typeof prepareCsvImportRows>["allRows"][number]

export function isZeroStockRow(row: CsvPreparedRow): boolean {
  // Blank, negative, malformed and missing quantities still need review.
  return /^0+$/u.test((row.cleaned.sourceRow.fields.quantity ?? "").trim())
}
