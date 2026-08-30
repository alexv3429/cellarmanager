import {
  normalizeCsvHeader,
} from "./csvColumnMapping"
import type { CsvIngestionDocument } from "./csvIngestion"
import {
  parseWineFacts,
  type SweetnessCategory,
} from "./wineFacts"
import type { WineCatalogEntry } from "./wineCatalog"

export const CELLARMANAGER_CSV_VERSION = "1"

export const CELLARMANAGER_CSV_HEADERS = [
  "Producer",
  "Cuvée",
  "Vintage",
  "Color",
  "Appellation",
  "Area",
  "Bottle format",
  "Cellar",
  "Location",
  "Quantity",
  "Country",
  "Classification",
  "Vineyard",
  "Grape composition (JSON)",
  "Sweetness",
  "Alcohol (%)",
  "Certifications (JSON)",
  "Reference type",
  "Reference ID",
  "CellarManager wine ID",
  "CellarManager CSV version",
] as const

export interface CsvExportWine extends WineCatalogEntry {
  country: string | null
  classification: string | null
  vineyard: string | null
  grape_composition: unknown
  sweetness_category: SweetnessCategory | null
  alcohol_percent: number | string | null
  certifications: unknown
  wine_reference_id: string | null
  wine_reference_type: string | null
}

export interface CsvExportHolding {
  wine_id: string
  location_id: string
  quantity: number
  producer: string
  cuvee: string
  vintage: number | null
  color: string
  appellation: string | null
  area: string | null
  format_ml: number
}

export interface CsvExportLocation {
  id: string
  cellar_name: string
  code: string
}

export interface CsvExportRecord {
  wine: CsvExportWine
  cellar: string | null
  location: string | null
  quantity: number
}

export interface CsvExportSnapshot {
  bottleCount: number
  csv: string
  positionCount: number
  rowCount: number
  wineCount: number
  zeroStockWineCount: number
}

export type PortableCellarValue = string | number | null

export interface PortableCellarTable {
  headers: readonly string[]
  rows: PortableCellarValue[][]
}

export interface CellarManagerCsvVersionInspection {
  detected: boolean
  issue: string | null
  version: string | null
}

const VERSION_HEADER = normalizeCsvHeader(
  "CellarManager CSV version",
)

export function inspectCellarManagerCsvVersion(
  document: CsvIngestionDocument,
): CellarManagerCsvVersionInspection {
  const versionColumnIndex =
    document.header?.values.findIndex(
      (header) => normalizeCsvHeader(header) === VERSION_HEADER,
    ) ?? -1

  if (versionColumnIndex < 0) {
    return { detected: false, issue: null, version: null }
  }

  const versions = new Set(
    document.rows.map((row) =>
      (row.values[versionColumnIndex] ?? "").trim(),
    ),
  )

  if (versions.size !== 1 || versions.has("")) {
    return {
      detected: true,
      issue:
        "This CellarManager CSV has missing or inconsistent format-version metadata. Export it again before importing.",
      version: null,
    }
  }

  const version = [...versions][0] ?? ""

  if (version !== CELLARMANAGER_CSV_VERSION) {
    return {
      detected: true,
      issue: `This file uses a newer CellarManager CSV format (version ${version}). Update CellarManager before importing it.`,
      version,
    }
  }

  return { detected: true, issue: null, version }
}

function emptyExportWine(
  holding: CsvExportHolding,
): CsvExportWine {
  return {
    alcohol_percent: null,
    appellation: holding.appellation,
    area: holding.area,
    certifications: [],
    classification: null,
    color: holding.color,
    country: null,
    cuvee: holding.cuvee,
    format_ml: holding.format_ml,
    grape_composition: [],
    household_id: "",
    id: holding.wine_id,
    producer: holding.producer,
    sweetness_category: null,
    vineyard: null,
    vintage: holding.vintage,
    wine_reference_id: null,
    wine_reference_type: null,
  }
}

function compareRecords(
  left: CsvExportRecord,
  right: CsvExportRecord,
): number {
  return (
    left.wine.producer.localeCompare(right.wine.producer) ||
    left.wine.cuvee.localeCompare(right.wine.cuvee) ||
    (left.wine.vintage ?? Number.NEGATIVE_INFINITY) -
      (right.wine.vintage ?? Number.NEGATIVE_INFINITY) ||
    left.wine.color.localeCompare(right.wine.color) ||
    (left.cellar ?? "").localeCompare(right.cellar ?? "") ||
    (left.location ?? "").localeCompare(right.location ?? "") ||
    left.wine.id.localeCompare(right.wine.id)
  )
}

export function createCsvExportRecords(
  wines: CsvExportWine[],
  holdings: CsvExportHolding[],
  locations: CsvExportLocation[],
  includeZeroStockWines: boolean,
): CsvExportRecord[] {
  const winesById = new Map(
    wines.map((wine) => [wine.id, wine]),
  )
  const locationsById = new Map(
    locations.map((location) => [location.id, location]),
  )
  const wineIdsInStock = new Set<string>()
  const records: CsvExportRecord[] = []

  for (const holding of holdings) {
    if (!Number.isInteger(holding.quantity) || holding.quantity <= 0) {
      continue
    }

    const wine = winesById.get(holding.wine_id) ??
      emptyExportWine(holding)
    const storage = locationsById.get(holding.location_id)
    wineIdsInStock.add(holding.wine_id)
    records.push({
      cellar: storage?.cellar_name ?? null,
      location: storage?.code ?? null,
      quantity: holding.quantity,
      wine,
    })
  }

  if (includeZeroStockWines) {
    for (const wine of wines) {
      if (wineIdsInStock.has(wine.id)) continue
      records.push({
        cellar: null,
        location: null,
        quantity: 0,
        wine,
      })
    }
  }

  return records.sort(compareRecords)
}

function formulaSafeValue(value: string): string {
  return /^\s*[=+\-@]/u.test(value)
    ? `\t${value}`
    : value
}

function csvCell(value: string | number | null): string {
  const text = formulaSafeValue(
    value === null ? "" : String(value),
  )

  return `"${text.replaceAll('"', '""')}"`
}

function csvLine(values: readonly (string | number | null)[]): string {
  return values.map(csvCell).join(",")
}

function recordValues(
  record: CsvExportRecord,
): PortableCellarValue[] {
  const { wine } = record
  const facts = parseWineFacts(wine)

  return [
    wine.producer,
    wine.cuvee,
    wine.vintage ?? "NV",
    wine.color,
    wine.appellation,
    wine.area,
    `${wine.format_ml} ml`,
    record.cellar,
    record.location,
    record.quantity,
    facts.country,
    facts.classification,
    facts.vineyard,
    JSON.stringify(facts.grapeComposition),
    facts.sweetnessCategory,
    facts.alcoholPercent,
    JSON.stringify(facts.certifications),
    wine.wine_reference_type,
    wine.wine_reference_id,
    wine.id,
    CELLARMANAGER_CSV_VERSION,
  ]
}

export function createPortableCellarTable(
  records: CsvExportRecord[],
): PortableCellarTable {
  return {
    headers: CELLARMANAGER_CSV_HEADERS,
    rows: records.map(recordValues),
  }
}

export function buildPortableCsvExport(
  records: CsvExportRecord[],
): CsvExportSnapshot {
  const wineIds = new Set(records.map((record) => record.wine.id))
  const zeroStockWineCount = new Set(
    records
      .filter((record) => record.quantity === 0)
      .map((record) => record.wine.id),
  ).size
  const table = createPortableCellarTable(records)
  const lines = [
    csvLine(table.headers),
    ...table.rows.map(csvLine),
  ]

  return {
    bottleCount: records.reduce(
      (total, record) => total + record.quantity,
      0,
    ),
    csv: `\uFEFF${lines.join("\r\n")}\r\n`,
    positionCount: records.filter((record) => record.quantity > 0).length,
    rowCount: records.length,
    wineCount: wineIds.size,
    zeroStockWineCount,
  }
}

export function getCsvExportFilename(date = new Date()): string {
  return getPortableExportFilename("csv", date)
}

export function getPortableExportFilename(
  extension: "csv" | "xlsx",
  date = new Date(),
): string {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `cellarmanager-export-${year}-${month}-${day}.${extension}`
}
