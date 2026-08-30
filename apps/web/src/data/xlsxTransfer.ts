import readXlsxFile, {
  type CellValue as ReadCellValue,
  type Sheet as ReadSheet,
  type SheetData as ReadSheetData,
} from "read-excel-file/universal"
import writeXlsxFile, {
  type CellObject,
  type SheetData as WriteSheetData,
} from "write-excel-file/universal"

import {
  createPortableCellarTable,
  inspectCellarManagerCsvVersion,
  type CsvExportRecord,
  type PortableCellarTable,
  type PortableCellarValue,
} from "./csvExport"
import { suggestCsvColumnMapping } from "./csvColumnMapping"
import {
  parseCsvText,
  type CsvIngestionDocument,
} from "./csvIngestion"
import {
  maturityAssessmentReasonLabel,
  type MaturityOverviewItem,
} from "./wineMaturity"

export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const MAX_IMPORT_COLUMNS = 256
const MAX_IMPORT_ROWS = 100_001
const TECHNICAL_SHEET_NAME = "CellarManager data"

const FRIENDLY_HEADERS = [
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
  "Grape composition",
  "Sweetness",
  "Alcohol (%)",
  "Certifications",
] as const

const MATURITY_HEADERS = [
  "Producer",
  "Cuvée",
  "Vintage",
  "Color",
  "Appellation",
  "Status",
  "First trial",
  "Best period starts",
  "Best period ends",
  "Drink by",
  "Guidance source",
  "Confidence",
  "Calculated at",
] as const

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function readCellText(value: ReadCellValue | null): string {
  if (value === null) return ""
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  return String(value)
}

function sheetCsvText(data: ReadSheetData): string {
  if (data.length === 0) {
    throw new Error("The Excel workbook does not contain any rows.")
  }

  if (data.length > MAX_IMPORT_ROWS) {
    throw new Error(
      `The Excel worksheet exceeds the ${MAX_IMPORT_ROWS.toLocaleString()}-row import limit.`,
    )
  }

  const columnCount = data.reduce(
    (count, row) => Math.max(count, row.length),
    0,
  )

  if (columnCount > MAX_IMPORT_COLUMNS) {
    throw new Error(
      `The Excel worksheet exceeds the ${MAX_IMPORT_COLUMNS}-column import limit.`,
    )
  }

  return `${data
    .map((row) =>
      Array.from({ length: columnCount }, (_, index) =>
        csvCell(readCellText(row[index] ?? null)),
      ).join(","),
    )
    .join("\n")}\n`
}

function sheetMappingScore(sheet: ReadSheet): number {
  const headers = (sheet.data[0] ?? []).map(readCellText)
  return suggestCsvColumnMapping(headers).filter(Boolean).length
}

function selectImportSheet(sheets: ReadSheet[]): ReadSheet | null {
  const namedCellarSheet = sheets.find(
    (sheet) => sheet.sheet.toLocaleLowerCase() === "cellar",
  )

  if (namedCellarSheet) return namedCellarSheet

  return [...sheets].sort(
    (left, right) =>
      sheetMappingScore(right) - sheetMappingScore(left),
  )[0] ?? null
}

export async function parseXlsxWorkbook(
  bytes: ArrayBuffer,
): Promise<CsvIngestionDocument> {
  let sheets: ReadSheet[]

  try {
    sheets = await readXlsxFile(bytes)
  } catch {
    throw new Error(
      "Unable to read this Excel workbook. Use an unencrypted .xlsx file.",
    )
  }

  const technicalSheet = sheets.find(
    (sheet) => sheet.sheet === TECHNICAL_SHEET_NAME,
  )

  if (technicalSheet) {
    const technicalDocument = parseCsvText(
      sheetCsvText(technicalSheet.data),
      { delimiter: "," },
    )
    const versionInspection =
      inspectCellarManagerCsvVersion(technicalDocument)

    if (versionInspection.issue) {
      throw new Error(versionInspection.issue)
    }
  }

  const worksheet = selectImportSheet(sheets)

  if (!worksheet) {
    throw new Error("The Excel workbook does not contain a worksheet with data.")
  }

  return parseCsvText(sheetCsvText(worksheet.data), {
    delimiter: ",",
  })
}

function columnWidth(
  header: string,
  values: PortableCellarValue[],
): number {
  const widestValue = values.reduce<number>(
    (width, value) =>
      Math.max(width, value === null ? 0 : String(value).length),
    header.length,
  )

  return Math.min(34, Math.max(11, widestValue + 2))
}

function parseJsonArray(value: PortableCellarValue): unknown[] {
  if (typeof value !== "string" || value.length === 0) return []

  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function grapeSummary(value: PortableCellarValue): string {
  return parseJsonArray(value)
    .flatMap((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("name" in entry) ||
        typeof entry.name !== "string"
      ) {
        return []
      }

      const percentage =
        "percentage" in entry &&
        typeof entry.percentage === "number"
          ? ` (${entry.percentage}%)`
          : ""
      return [`${entry.name}${percentage}`]
    })
    .join(", ")
}

function certificationSummary(value: PortableCellarValue): string {
  return parseJsonArray(value)
    .filter((entry): entry is string => typeof entry === "string")
    .join(", ")
}

function friendlyTable(table: PortableCellarTable): PortableCellarTable {
  return {
    headers: FRIENDLY_HEADERS,
    rows: table.rows.map((row) => [
      ...row.slice(0, 13),
      grapeSummary(row[13] ?? null),
      row[14] ?? null,
      row[15] ?? null,
      certificationSummary(row[16] ?? null),
    ]),
  }
}

function dateOnly(value: string | null): string | null {
  return value?.slice(0, 10) ?? null
}

function maturityTable(
  records: CsvExportRecord[],
  overview: MaturityOverviewItem[],
): PortableCellarTable {
  const maturityByWineId = new Map(
    overview.map((item) => [item.wineId, item]),
  )
  const recordsByWineId = new Map<string, CsvExportRecord>()

  for (const record of records) {
    if (!recordsByWineId.has(record.wine.id)) {
      recordsByWineId.set(record.wine.id, record)
    }
  }

  return {
    headers: MATURITY_HEADERS,
    rows: [...recordsByWineId.values()].map(({ wine }) => {
      const maturity = maturityByWineId.get(wine.id)
      const status = maturity?.stateLabel ??
        (maturity?.assessmentReason
          ? maturityAssessmentReasonLabel(maturity.assessmentReason)
          : "Not assessed")

      return [
        wine.producer,
        wine.cuvee,
        wine.vintage ?? "NV",
        wine.color,
        wine.appellation,
        status,
        maturity?.firstTrialYear ?? null,
        maturity?.bestStartYear ?? null,
        maturity?.bestEndYear ?? null,
        maturity?.drinkByYear ?? null,
        maturity?.isOverride
          ? "Personal window"
          : maturity?.state
            ? "CellarManager estimate"
            : null,
        maturity?.confidenceLabel ?? null,
        dateOnly(maturity?.calculatedAt ?? null),
      ]
    }),
  }
}

function headerCell(value: string): CellObject {
  return {
    alignVertical: "center",
    backgroundColor: "#6F2142",
    fontWeight: "bold",
    height: 24,
    textColor: "#FFFFFF",
    type: String,
    value,
  }
}

function sheetData(table: PortableCellarTable): WriteSheetData {
  return [table.headers.map(headerCell), ...table.rows]
}

function sheetColumns(table: PortableCellarTable) {
  return table.headers.map((header, index) => ({
    width: columnWidth(
      header,
      table.rows.map((row) => row[index] ?? null),
    ),
  }))
}

export async function buildPortableXlsxExport(
  records: CsvExportRecord[],
  maturityOverview: MaturityOverviewItem[] | null = null,
): Promise<Blob> {
  const technicalTable = createPortableCellarTable(records)
  const visibleTable = friendlyTable(technicalTable)
  const drinkingWindows = maturityOverview
    ? maturityTable(records, maturityOverview)
    : null

  return writeXlsxFile(
    [
      {
        columns: sheetColumns(visibleTable),
        data: sheetData(visibleTable),
        sheet: "Cellar",
        stickyRowsCount: 1,
      },
      ...(drinkingWindows
        ? [
            {
              columns: sheetColumns(drinkingWindows),
              data: sheetData(drinkingWindows),
              sheet: "Drinking windows",
              stickyRowsCount: 1,
            },
          ]
        : []),
      {
        columns: sheetColumns(technicalTable),
        data: sheetData(technicalTable),
        sheet: TECHNICAL_SHEET_NAME,
        stickyRowsCount: 1,
      },
    ],
    { fontFamily: "Aptos", fontSize: 11 },
  ).toBlob()
}
