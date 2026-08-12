import {
  CSV_IMPORT_FIELD_DEFINITIONS,
  type CsvImportField,
  type CsvMappedSourceRow,
} from "./csvColumnMapping"
import { cleanWineText } from "./wineCatalog"

export type CsvCleaningIssueCode =
  | "INVALID_BOTTLE_FORMAT"
  | "INVALID_QUANTITY"
  | "INVALID_VINTAGE"
  | "MISSING_REQUIRED_VALUE"

export interface CsvCleaningIssue {
  code: CsvCleaningIssueCode
  field: CsvImportField
  message: string
  recordNumber: number
  sourceLineEnd: number
  sourceLineStart: number
  sourceValue: string | null
}

export interface CsvCleaningChange {
  field: CsvImportField
  normalizedValue: string
  sourceValue: string
}

export interface CsvCleanedFields {
  appellation: string | null
  area: string | null
  cellar: string | null
  color: string | null
  cuvee: string | null
  formatMl: number | null
  location: string | null
  producer: string | null
  quantity: number | null
  vintage: number | null
}

export interface CsvCleanedSourceRow {
  changes: CsvCleaningChange[]
  fields: CsvCleanedFields
  issues: CsvCleaningIssue[]
  recordNumber: number
  sourceLineEnd: number
  sourceLineStart: number
  sourceRow: CsvMappedSourceRow
}

export interface CsvCleaningSummary {
  changedValueCount: number
  invalidRowCount: number
  issueCount: number
  readyRowCount: number
  totalRowCount: number
}

const fieldLabels = new Map(
  CSV_IMPORT_FIELD_DEFINITIONS.map((definition) => [
    definition.field,
    definition.label,
  ]),
)

const fieldOrder = new Map(
  CSV_IMPORT_FIELD_DEFINITIONS.map((definition, index) => [
    definition.field,
    index,
  ]),
)

const nvKeys = new Set([
  "n v",
  "non millesime",
  "non vintage",
  "nv",
  "sans millesime",
])

const POSTGRES_INTEGER_MAX = 2_147_483_647

function normalizedTokenKey(value: string): string {
  return cleanWineText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
}

function normalizedDisplayValue(
  field: CsvImportField,
  value: string | number | null,
): string {
  if (value === null) {
    return field === "vintage" ? "NV" : "Empty"
  }

  if (field === "formatMl") {
    return `${value} ml`
  }

  return String(value)
}

function parseScaledMetricValue(
  sourceNumber: string,
  scale: number,
): number | null {
  const normalizedNumber = sourceNumber.replace(",", ".")
  const [wholePart = "", fractionalPart = ""] =
    normalizedNumber.split(".")
  const denominator = 10 ** fractionalPart.length
  const numerator = Number(`${wholePart}${fractionalPart}`)

  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator <= 0
  ) {
    return null
  }

  const scaledNumerator = numerator * scale

  if (
    !Number.isSafeInteger(scaledNumerator) ||
    scaledNumerator % denominator !== 0
  ) {
    return null
  }

  const millilitres = scaledNumerator / denominator

  return Number.isSafeInteger(millilitres) &&
    millilitres > 0 &&
    millilitres <= POSTGRES_INTEGER_MAX
    ? millilitres
    : null
}

export function parseCsvBottleFormat(
  value: string,
): number | null {
  const cleaned = cleanWineText(value).toLowerCase()
  const match = /^(\d+(?:[.,]\d+)?)\s*(ml|millilit(?:er|ers|re|res)|cl|centilit(?:er|ers|re|res)|l|lit(?:er|ers|re|res))?$/u.exec(
    cleaned,
  )

  if (!match) {
    return null
  }

  const sourceNumber = match[1] ?? ""
  const unit = match[2] ?? "ml"
  const scale = unit.startsWith("centilit") || unit === "cl"
    ? 10
    : unit === "l" || unit.startsWith("lit")
      ? 1_000
      : 1

  return parseScaledMetricValue(sourceNumber, scale)
}

export function parseCsvQuantity(
  value: string,
): number | null {
  const cleaned = cleanWineText(value)

  if (!/^\d+$/u.test(cleaned)) {
    return null
  }

  const quantity = Number(cleaned)

  return Number.isSafeInteger(quantity) && quantity > 0
    && quantity <= POSTGRES_INTEGER_MAX
    ? quantity
    : null
}

function addIssue(
  row: CsvMappedSourceRow,
  issues: CsvCleaningIssue[],
  code: CsvCleaningIssueCode,
  field: CsvImportField,
  message: string,
  sourceValue: string | undefined,
) {
  issues.push({
    code,
    field,
    message,
    recordNumber: row.recordNumber,
    sourceLineEnd: row.sourceLineEnd,
    sourceLineStart: row.sourceLineStart,
    sourceValue: sourceValue ?? null,
  })
}

function recordChange(
  changes: CsvCleaningChange[],
  field: CsvImportField,
  sourceValue: string | undefined,
  normalizedValue: string | number | null,
) {
  if (sourceValue === undefined) {
    return
  }

  const displayValue = normalizedDisplayValue(
    field,
    normalizedValue,
  )

  if (sourceValue !== displayValue) {
    changes.push({
      field,
      normalizedValue: displayValue,
      sourceValue,
    })
  }
}

function cleanTextField(
  row: CsvMappedSourceRow,
  field: CsvImportField,
  issues: CsvCleaningIssue[],
  changes: CsvCleaningChange[],
  options: {
    lowercase?: boolean
    required?: boolean
  } = {},
): string | null {
  const sourceValue = row.fields[field]
  const cleaned = cleanWineText(sourceValue ?? "")
  const normalized = options.lowercase
    ? cleaned.toLowerCase()
    : cleaned

  if (normalized.length === 0) {
    if (options.required) {
      addIssue(
        row,
        issues,
        "MISSING_REQUIRED_VALUE",
        field,
        `${fieldLabels.get(field) ?? field} is required`,
        sourceValue,
      )

      return null
    }

    recordChange(changes, field, sourceValue, null)
    return null
  }

  recordChange(changes, field, sourceValue, normalized)
  return normalized
}

function cleanVintage(
  row: CsvMappedSourceRow,
  issues: CsvCleaningIssue[],
  changes: CsvCleaningChange[],
): number | null {
  const sourceValue = row.fields.vintage
  const cleaned = cleanWineText(sourceValue ?? "")

  if (
    cleaned.length === 0 ||
    nvKeys.has(normalizedTokenKey(cleaned))
  ) {
    recordChange(changes, "vintage", sourceValue, null)
    return null
  }

  if (!/^\d{4}$/u.test(cleaned)) {
    addIssue(
      row,
      issues,
      "INVALID_VINTAGE",
      "vintage",
      "Vintage must be a four-digit year or NV",
      sourceValue,
    )
    return null
  }

  const vintage = Number(cleaned)

  if (vintage < 1800 || vintage > 2200) {
    addIssue(
      row,
      issues,
      "INVALID_VINTAGE",
      "vintage",
      "Vintage must be between 1800 and 2200 or NV",
      sourceValue,
    )
    return null
  }

  recordChange(changes, "vintage", sourceValue, vintage)
  return vintage
}

function cleanBottleFormat(
  row: CsvMappedSourceRow,
  issues: CsvCleaningIssue[],
  changes: CsvCleaningChange[],
): number | null {
  const sourceValue = row.fields.formatMl
  const formatMl = parseCsvBottleFormat(sourceValue ?? "")

  if (formatMl === null) {
    addIssue(
      row,
      issues,
      sourceValue === undefined || cleanWineText(sourceValue).length === 0
        ? "MISSING_REQUIRED_VALUE"
        : "INVALID_BOTTLE_FORMAT",
      "formatMl",
      sourceValue === undefined || cleanWineText(sourceValue).length === 0
        ? "Bottle format is required"
        : "Bottle format must be a supported positive metric volume such as 750 ml, 75 cl, or 0.75 l",
      sourceValue,
    )
    return null
  }

  recordChange(changes, "formatMl", sourceValue, formatMl)
  return formatMl
}

function cleanQuantity(
  row: CsvMappedSourceRow,
  issues: CsvCleaningIssue[],
  changes: CsvCleaningChange[],
): number | null {
  const sourceValue = row.fields.quantity
  const quantity = parseCsvQuantity(sourceValue ?? "")

  if (quantity === null) {
    addIssue(
      row,
      issues,
      sourceValue === undefined || cleanWineText(sourceValue).length === 0
        ? "MISSING_REQUIRED_VALUE"
        : "INVALID_QUANTITY",
      "quantity",
      sourceValue === undefined || cleanWineText(sourceValue).length === 0
        ? "Quantity is required"
        : "Quantity must be a supported positive whole number",
      sourceValue,
    )
    return null
  }

  recordChange(changes, "quantity", sourceValue, quantity)
  return quantity
}

export function cleanCsvMappedRow(
  row: CsvMappedSourceRow,
): CsvCleanedSourceRow {
  const issues: CsvCleaningIssue[] = []
  const changes: CsvCleaningChange[] = []

  const fields: CsvCleanedFields = {
    appellation: cleanTextField(
      row,
      "appellation",
      issues,
      changes,
    ),
    area: cleanTextField(row, "area", issues, changes),
    cellar: cleanTextField(
      row,
      "cellar",
      issues,
      changes,
    ),
    color: cleanTextField(row, "color", issues, changes, {
      lowercase: true,
      required: true,
    }),
    cuvee: cleanTextField(row, "cuvee", issues, changes, {
      required: true,
    }),
    formatMl: cleanBottleFormat(row, issues, changes),
    location: cleanTextField(
      row,
      "location",
      issues,
      changes,
    ),
    producer: cleanTextField(
      row,
      "producer",
      issues,
      changes,
      { required: true },
    ),
    quantity: cleanQuantity(row, issues, changes),
    vintage: cleanVintage(row, issues, changes),
  }

  issues.sort(
    (left, right) =>
      (fieldOrder.get(left.field) ?? 0) -
      (fieldOrder.get(right.field) ?? 0),
  )

  changes.sort(
    (left, right) =>
      (fieldOrder.get(left.field) ?? 0) -
      (fieldOrder.get(right.field) ?? 0),
  )

  return {
    changes,
    fields,
    issues,
    recordNumber: row.recordNumber,
    sourceLineEnd: row.sourceLineEnd,
    sourceLineStart: row.sourceLineStart,
    sourceRow: row,
  }
}

export function summarizeCsvCleaning(
  rows: CsvCleanedSourceRow[],
): CsvCleaningSummary {
  return rows.reduce<CsvCleaningSummary>(
    (summary, row) => ({
      changedValueCount:
        summary.changedValueCount + row.changes.length,
      invalidRowCount:
        summary.invalidRowCount +
        (row.issues.length > 0 ? 1 : 0),
      issueCount: summary.issueCount + row.issues.length,
      readyRowCount:
        summary.readyRowCount +
        (row.issues.length === 0 ? 1 : 0),
      totalRowCount: summary.totalRowCount + 1,
    }),
    {
      changedValueCount: 0,
      invalidRowCount: 0,
      issueCount: 0,
      readyRowCount: 0,
      totalRowCount: 0,
    },
  )
}
