import type { CsvColumnMapping, CsvImportField } from "./csvColumnMapping"
import type { CsvPreparedRow, CsvRowCorrections } from "./csvImportPreparation"

export interface CsvColumnSplit {
  sourceColumnIndex: number
  firstField: CsvImportField
  secondField: CsvImportField
  separator: string
}

export interface CsvSplitGroup {
  key: string
  sourceValue: string
  context: string
  rows: CsvPreparedRow[]
}

export function isCsvSplitConfigured(split: CsvColumnSplit | null, columnCount: number): split is CsvColumnSplit {
  return split !== null && Number.isInteger(split.sourceColumnIndex) &&
    split.sourceColumnIndex >= 0 && split.sourceColumnIndex < columnCount && split.firstField !== split.secondField
}

export function suggestCsvColumnSplit(value: string, separator: string) {
  // A literal text split, never an identity guess. Blank separator means manual.
  const parts = separator === " - "
    ? value.split(/\s+[-–—]\s+/u)
    : separator ? value.split(separator) : []
  if (parts.length === 2 && parts.every((part) => part.trim())) {
    return { first: parts[0].trim(), second: parts[1].trim(), suggested: true }
  }
  return { first: value.trim(), second: "", suggested: false }
}

export function groupCsvColumnSplit(rows: CsvPreparedRow[], mapping: CsvColumnMapping,
  split: CsvColumnSplit, corrections: CsvRowCorrections): CsvSplitGroup[] {
  if (!isCsvSplitConfigured(split, mapping.length)) return []
  const targets = [split.firstField, split.secondField]
  const groups = new Map<string, CsvSplitGroup>()
  for (const row of rows) {
    const id = row.cleaned.recordNumber
    if (row.excluded || targets.some((field) => Object.hasOwn(corrections[id] ?? {}, field))) continue
    // Only the field mapped directly from this combined source may be replaced.
    // Separately supplied values are never overwritten. Defaults are fallbacks,
    // not source data, so a reviewed split can supply the missing real value.
    if (targets.some((field) => mapping[split.sourceColumnIndex] !== field && row.original.fields[field]?.trim())) continue
    const sourceValue = row.sourceValues[split.sourceColumnIndex] ?? ""
    const context = ["appellation", "area", "color"].filter((field) => !targets.includes(field as CsvImportField))
      .map((field) => row.cleaned.sourceRow.fields[field as CsvImportField] ?? "")
    const key = JSON.stringify([sourceValue, ...context, sourceValue.trim() ? null : id])
    const group = groups.get(key) ?? { key, sourceValue, context: context.filter(Boolean).join(" · "), rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length)
}

export function createCsvSplitCorrections(group: CsvSplitGroup, mapping: CsvColumnMapping,
  split: CsvColumnSplit, corrections: CsvRowCorrections, first: string, second: string): CsvRowCorrections {
  if (!isCsvSplitConfigured(split, mapping.length) || !first.trim() || !second.trim()) {
    throw new Error("Choose two different fields and enter both values before applying this split.")
  }
  const eligible = groupCsvColumnSplit(group.rows, mapping, split, corrections).flatMap((item) => item.rows)
  return Object.fromEntries(eligible.map((row) => [row.cleaned.recordNumber, {
    ...corrections[row.cleaned.recordNumber], [split.firstField]: first.trim(), [split.secondField]: second.trim(),
  }]))
}
