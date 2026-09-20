import type { CsvPreparedRow, CsvRowCorrections } from "./csvImportPreparation"

export interface CsvCombinedNameGroup {
  key: string
  sourceName: string
  appellation: string
  area: string
  color: string
  rows: CsvPreparedRow[]
}

// Exact values only: similar spelling, another appellation or another color
// must not silently become the same wine. Vintages and stock stay per row.
export function groupCsvCombinedNames(rows: CsvPreparedRow[]): CsvCombinedNameGroup[] {
  const groups = new Map<string, CsvCombinedNameGroup>()
  for (const row of rows) {
    const fields = row.cleaned.sourceRow.fields
    if (row.excluded || fields.cuvee?.trim()) continue
    const sourceName = fields.producer ?? ""
    const appellation = fields.appellation ?? ""
    const area = fields.area ?? ""
    const color = fields.color ?? ""
    const key = JSON.stringify([sourceName, appellation, area, color,
      sourceName.trim() ? null : row.cleaned.recordNumber])
    const group = groups.get(key) ?? { key, sourceName, appellation, area, color, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length)
}

export function suggestCsvNameSplit(sourceName: string) {
  // This is a visible, unconfirmed text split, not a producer lookup.
  // Do not split unspaced hyphens inside names such as Jean-Marc.
  const parts = sourceName.split(/\s+[-–—]\s+/u).map((part) => part.trim())
  if (parts.length === 2 && parts.every(Boolean)) {
    return { producer: parts[0], cuvee: parts[1], suggested: true }
  }
  return { producer: sourceName.trim(), cuvee: "", suggested: false }
}

export function createCsvCombinedNameCorrections(
  group: CsvCombinedNameGroup,
  corrections: CsvRowCorrections,
  producer: string,
  cuvee: string,
): CsvRowCorrections {
  if (!producer.trim() || !cuvee.trim()) {
    throw new Error("Enter both the producer and the cuvée before applying this split.")
  }
  return Object.fromEntries(group.rows
    .filter((row) => !row.excluded && !row.cleaned.sourceRow.fields.cuvee?.trim())
    .map((row) => [row.cleaned.recordNumber, {
      ...corrections[row.cleaned.recordNumber], producer: producer.trim(), cuvee: cuvee.trim(),
    }]))
}
