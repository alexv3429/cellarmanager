import { describe, expect, it } from "vitest"

import {
  mapCsvSourceRow,
  suggestCsvColumnMapping,
} from "./csvColumnMapping"
import { cleanCsvMappedRow } from "./csvCleaning"
import {
  buildPortableCsvExport,
  createCsvExportRecords,
  getCsvExportFilename,
  inspectCellarManagerCsvVersion,
  type CsvExportHolding,
  type CsvExportLocation,
  type CsvExportWine,
} from "./csvExport"
import { parseCsvText } from "./csvIngestion"
import {
  buildPortableXlsxExport,
  parseXlsxWorkbook,
} from "./xlsxTransfer"

function wine(
  overrides: Partial<CsvExportWine> = {},
): CsvExportWine {
  return {
    alcohol_percent: 13.5,
    appellation: "Puligny-Montrachet",
    area: "Burgundy",
    certifications: ["Organic"],
    classification: "Premier Cru",
    color: "white",
    country: "France",
    cuvee: "Les Referts",
    format_ml: 750,
    grape_composition: [
      { name: "Chardonnay", percentage: 100 },
    ],
    household_id: "household-a",
    id: "wine-a",
    producer: "Domaine Test",
    sweetness_category: "bone-dry",
    vineyard: "Les Referts",
    vintage: 2020,
    wine_reference_id: "1000001",
    wine_reference_type: "LWIN7",
    ...overrides,
  }
}

const locations: CsvExportLocation[] = [
  {
    cellar_name: "Aging cellar",
    code: "A1",
    id: "location-a",
  },
  {
    cellar_name: "Service cellar",
    code: "S2",
    id: "location-b",
  },
]

function holding(
  overrides: Partial<CsvExportHolding> = {},
): CsvExportHolding {
  return {
    appellation: "Puligny-Montrachet",
    area: "Burgundy",
    color: "white",
    cuvee: "Les Referts",
    format_ml: 750,
    location_id: "location-a",
    producer: "Domaine Test",
    quantity: 2,
    vintage: 2020,
    wine_id: "wine-a",
    ...overrides,
  }
}

describe("portable CSV export", () => {
  it("exports one deterministic row per positive inventory position", () => {
    const records = createCsvExportRecords(
      [wine(), wine({ id: "wine-zero", cuvee: "Catalog only" })],
      [
        holding(),
        holding({ location_id: "location-b", quantity: 1 }),
        holding({ location_id: "location-b", quantity: 0 }),
      ],
      locations,
      false,
    )
    const snapshot = buildPortableCsvExport(records)
    const document = parseCsvText(snapshot.csv)

    expect(snapshot).toMatchObject({
      bottleCount: 3,
      positionCount: 2,
      rowCount: 2,
      wineCount: 1,
      zeroStockWineCount: 0,
    })
    expect(snapshot.csv.startsWith("\uFEFF")).toBe(true)
    expect(snapshot.csv.endsWith("\r\n")).toBe(true)
    expect(document.issues).toEqual([])
    expect(document.rows.map((row) => row.values.slice(7, 10))).toEqual([
      ["Aging cellar", "A1", "2"],
      ["Service cellar", "S2", "1"],
    ])
    expect(document.rows[0]?.values.slice(10, 17)).toEqual([
      "France",
      "Premier Cru",
      "Les Referts",
      '[{"name":"Chardonnay","percentage":100}]',
      "bone-dry",
      "13.5",
      '["Organic"]',
    ])
  })

  it("round-trips the core inventory fields through the guarded importer", () => {
    const sourceWine = wine({
      appellation: "Côte de Nuits, Villages",
      area: "Bourgogne",
      certifications: ["Organic", "HVE"],
      cuvee: 'Cuvée "Archive"',
      grape_composition: [
        { name: "Pinot Noir", percentage: null },
      ],
      producer: "=Domaine Test",
      vintage: null,
    })
    const records = createCsvExportRecords(
      [sourceWine],
      [
        holding({
          appellation: sourceWine.appellation,
          area: sourceWine.area,
          cuvee: sourceWine.cuvee,
          producer: sourceWine.producer,
          quantity: 4,
          vintage: null,
        }),
      ],
      locations,
      false,
    )
    const document = parseCsvText(
      buildPortableCsvExport(records).csv,
    )
    const headers = document.header?.values ?? []
    const mapping = suggestCsvColumnMapping(headers)
    const mapped = mapCsvSourceRow(
      headers,
      document.rows[0]!,
      mapping,
    )
    const cleaned = cleanCsvMappedRow(mapped)

    expect(mapping.slice(0, 10)).toEqual([
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
    ])
    expect(mapping.slice(10)).toEqual(Array(11).fill(null))
    expect(cleaned.issues).toEqual([])
    expect(cleaned.fields).toEqual({
      appellation: "Côte de Nuits, Villages",
      area: "Bourgogne",
      cellar: "Aging cellar",
      color: "white",
      cuvee: 'Cuvée "Archive"',
      formatMl: 750,
      location: "A1",
      producer: "=Domaine Test",
      quantity: 4,
      vintage: null,
    })
    expect(document.rows[0]?.values[0]).toBe("\t=Domaine Test")
  })

  it("adds explicit quantity-zero rows only for a full catalog archive", () => {
    const wines = [
      wine(),
      wine({ id: "wine-zero", cuvee: "Catalog only" }),
    ]
    const holdings = [holding()]

    const inventoryRecords = createCsvExportRecords(
      wines,
      holdings,
      locations,
      false,
    )
    const catalogRecords = createCsvExportRecords(
      wines,
      holdings,
      locations,
      true,
    )
    const snapshot = buildPortableCsvExport(catalogRecords)

    expect(inventoryRecords).toHaveLength(1)
    expect(catalogRecords).toHaveLength(2)
    expect(
      catalogRecords.find(
        (record) => record.wine.id === "wine-zero",
      ),
    ).toMatchObject({
      cellar: null,
      location: null,
      quantity: 0,
      wine: { id: "wine-zero" },
    })
    expect(snapshot).toMatchObject({
      bottleCount: 2,
      positionCount: 1,
      rowCount: 2,
      wineCount: 2,
      zeroStockWineCount: 1,
    })
  })

  it("uses a local calendar date in the portable filename", () => {
    expect(getCsvExportFilename(new Date(2026, 7, 30, 23, 59))).toBe(
      "cellarmanager-export-2026-08-30.csv",
    )
  })

  it("accepts the current internal format version", () => {
    const document = parseCsvText(
      buildPortableCsvExport(
        createCsvExportRecords(
          [wine()],
          [holding()],
          locations,
          false,
        ),
      ).csv,
    )

    expect(inspectCellarManagerCsvVersion(document)).toEqual({
      detected: true,
      issue: null,
      version: "1",
    })
  })

  it("leaves ordinary third-party CSV files unversioned", () => {
    const document = parseCsvText(
      "Producer,Cuvée,Color,Quantity\nExample,House red,red,2\n",
    )

    expect(inspectCellarManagerCsvVersion(document)).toEqual({
      detected: false,
      issue: null,
      version: null,
    })
  })

  it("rejects unknown or inconsistent CellarManager formats", () => {
    const newer = parseCsvText(
      "Producer,CellarManager CSV version\nExample,2\n",
    )
    const inconsistent = parseCsvText(
      "Producer,CellarManager CSV version\nExample,1\nAnother,2\n",
    )

    expect(inspectCellarManagerCsvVersion(newer)).toMatchObject({
      detected: true,
      version: "2",
    })
    expect(inspectCellarManagerCsvVersion(newer).issue).toContain(
      "newer CellarManager CSV format",
    )
    expect(inspectCellarManagerCsvVersion(inconsistent)).toMatchObject({
      detected: true,
      version: null,
    })
    expect(inspectCellarManagerCsvVersion(inconsistent).issue).toContain(
      "inconsistent format-version metadata",
    )
  })

  it("round-trips the default Excel export through the guarded importer", async () => {
    const sourceWine = wine({
      certifications: ["Organic", "HVE"],
      cuvee: "Excel cellar",
      producer: "Domaine Workbook",
      wine_reference_id: "1234567",
    })
    const records = createCsvExportRecords(
      [sourceWine],
      [
        holding({
          cuvee: sourceWine.cuvee,
          producer: sourceWine.producer,
          quantity: 5,
        }),
      ],
      locations,
      false,
    )
    const workbook = await buildPortableXlsxExport(records)
    const document = await parseXlsxWorkbook(
      await workbook.arrayBuffer(),
    )
    const headers = document.header?.values ?? []
    const mapping = suggestCsvColumnMapping(headers)
    const cleaned = cleanCsvMappedRow(
      mapCsvSourceRow(
        headers,
        document.rows[0]!,
        mapping,
      ),
    )

    expect(workbook.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    expect(mapping.slice(0, 10)).toEqual([
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
    ])
    expect(cleaned.issues).toEqual([])
    expect(cleaned.fields).toMatchObject({
      cellar: "Aging cellar",
      cuvee: "Excel cellar",
      location: "A1",
      producer: "Domaine Workbook",
      quantity: 5,
    })
  })
})
