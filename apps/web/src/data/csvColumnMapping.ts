import type { CsvSourceRecord } from "./csvIngestion"

export const CSV_IMPORT_FIELDS = [
  "producer",
  "cuvee",
  "vintage",
  "color",
  "appellation",
  "area",
  "formatMl",
  "cellar",
  "location",
  "quantity",
] as const

export type CsvImportField =
  (typeof CSV_IMPORT_FIELDS)[number]

export type CsvColumnMapping = Array<
  CsvImportField | null
>

export interface CsvImportFieldDefinition {
  description: string
  field: CsvImportField
  label: string
  required: boolean
}

export interface CsvMappingIssue {
  field: CsvImportField
  message: string
  sourceColumnIndexes: number[]
  type: "DUPLICATE_FIELD" | "MISSING_REQUIRED_FIELD"
}

export interface CsvMappedSourceValue {
  sourceColumnIndex: number
  sourceHeader: string
  value: string
}

export interface CsvMappedSourceRow {
  fields: Partial<Record<CsvImportField, string>>
  recordNumber: number
  sourceLineEnd: number
  sourceLineStart: number
  unmapped: CsvMappedSourceValue[]
}

export const CSV_IMPORT_FIELD_DEFINITIONS: readonly CsvImportFieldDefinition[] = [
  {
    description: "Wine estate, domaine, winery, or producer",
    field: "producer",
    label: "Producer",
    required: true,
  },
  {
    description: "Cuvée or wine name",
    field: "cuvee",
    label: "Cuvée",
    required: true,
  },
  {
    description: "Four-digit year or an NV value",
    field: "vintage",
    label: "Vintage",
    required: false,
  },
  {
    description: "Wine color or type",
    field: "color",
    label: "Color",
    required: true,
  },
  {
    description: "Appellation or designation",
    field: "appellation",
    label: "Appellation",
    required: false,
  },
  {
    description: "Region or broader wine area",
    field: "area",
    label: "Area",
    required: false,
  },
  {
    description: "Bottle volume such as 750 ml or 75 cl",
    field: "formatMl",
    label: "Bottle format",
    required: true,
  },
  {
    description: "Cellar or storage area name",
    field: "cellar",
    label: "Cellar",
    required: false,
  },
  {
    description: "Physical position inside the cellar",
    field: "location",
    label: "Location",
    required: false,
  },
  {
    description: "Number of bottles at this location",
    field: "quantity",
    label: "Quantity",
    required: true,
  },
]

const aliases: Record<CsvImportField, readonly string[]> = {
  appellation: ["appellation", "designation", "aoc"],
  area: ["area", "region", "wine region", "zone"],
  cellar: [
    "cellar",
    "cellar name",
    "cave",
    "storage",
    "storage area",
  ],
  color: ["color", "colour", "couleur", "wine color"],
  cuvee: [
    "cuvee",
    "wine",
    "wine name",
    "name",
    "nom du vin",
  ],
  formatMl: [
    "format",
    "format ml",
    "bottle format",
    "bottle size",
    "volume",
    "volume ml",
  ],
  location: [
    "location",
    "location code",
    "emplacement",
    "position",
    "rack",
    "shelf",
  ],
  producer: [
    "producer",
    "producteur",
    "domaine",
    "estate",
    "winery",
  ],
  quantity: [
    "quantity",
    "quantite",
    "qty",
    "bottles",
    "bottle count",
    "stock",
  ],
  vintage: [
    "vintage",
    "millesime",
    "year",
    "annee",
  ],
}

export function normalizeCsvHeader(
  header: string,
): string {
  return header
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
}

export function suggestCsvColumnMapping(
  headers: string[],
): CsvColumnMapping {
  const assignedFields = new Set<CsvImportField>()

  return headers.map((header) => {
    const normalizedHeader = normalizeCsvHeader(header)
    const match = CSV_IMPORT_FIELDS.find(
      (field) =>
        !assignedFields.has(field) &&
        aliases[field].includes(normalizedHeader),
    )

    if (match) {
      assignedFields.add(match)
      return match
    }

    return null
  })
}

export function validateCsvColumnMapping(
  mapping: CsvColumnMapping,
): CsvMappingIssue[] {
  const columnIndexesByField = new Map<
    CsvImportField,
    number[]
  >()

  mapping.forEach((field, columnIndex) => {
    if (!field) {
      return
    }

    const columnIndexes =
      columnIndexesByField.get(field) ?? []
    columnIndexes.push(columnIndex)
    columnIndexesByField.set(field, columnIndexes)
  })

  return CSV_IMPORT_FIELD_DEFINITIONS.flatMap(
    (definition): CsvMappingIssue[] => {
      const sourceColumnIndexes =
        columnIndexesByField.get(definition.field) ?? []

      if (sourceColumnIndexes.length > 1) {
        return [
          {
            field: definition.field,
            message: `${definition.label} is assigned to more than one source column`,
            sourceColumnIndexes,
            type: "DUPLICATE_FIELD",
          },
        ]
      }

      if (
        definition.required &&
        sourceColumnIndexes.length === 0
      ) {
        return [
          {
            field: definition.field,
            message: `${definition.label} must be mapped`,
            sourceColumnIndexes,
            type: "MISSING_REQUIRED_FIELD",
          },
        ]
      }

      return []
    },
  )
}

export function mapCsvSourceRow(
  headers: string[],
  row: CsvSourceRecord,
  mapping: CsvColumnMapping,
): CsvMappedSourceRow {
  const fields: Partial<Record<CsvImportField, string>> = {}
  const unmapped: CsvMappedSourceValue[] = []

  headers.forEach((sourceHeader, sourceColumnIndex) => {
    const value = row.values[sourceColumnIndex] ?? ""
    const field = mapping[sourceColumnIndex]

    if (field) {
      fields[field] = value
    } else {
      unmapped.push({
        sourceColumnIndex,
        sourceHeader,
        value,
      })
    }
  })

  return {
    fields,
    recordNumber: row.recordNumber,
    sourceLineEnd: row.sourceLineEnd,
    sourceLineStart: row.sourceLineStart,
    unmapped,
  }
}
