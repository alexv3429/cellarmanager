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
    const source = mapCsvSourceRow(document.header!.values, row, mapping, defaults)
    return {
      original: source,
      cleaned: cleanCsvMappedRow({ ...source, fields: { ...source.fields, ...corrections[row.recordNumber] } }, options),
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
