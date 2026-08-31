import readXlsxFile from "read-excel-file/universal"
import writeXlsxFile from "write-excel-file/universal"
import { describe, expect, it } from "vitest"

import {
  createCsvExportRecords,
  type CsvExportHolding,
  type CsvExportLocation,
  type CsvExportWine,
} from "./csvExport"
import {
  buildPortableXlsxExport,
  parseXlsxWorkbook,
} from "./xlsxTransfer"
import type { MaturityOverviewItem } from "./wineMaturity"

const sourceWine: CsvExportWine = {
  alcohol_percent: 13.5,
  appellation: "Puligny-Montrachet",
  area: "Burgundy",
  certifications: ["Organic", "HVE"],
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
}

const sourceHolding: CsvExportHolding = {
  appellation: sourceWine.appellation,
  area: sourceWine.area,
  color: sourceWine.color,
  cuvee: sourceWine.cuvee,
  format_ml: sourceWine.format_ml,
  location_id: "location-a",
  producer: sourceWine.producer,
  quantity: 2,
  vintage: sourceWine.vintage,
  wine_id: sourceWine.id,
}

const sourceLocations: CsvExportLocation[] = [
  {
    cellar_name: "Aging cellar",
    code: "A1",
    id: "location-a",
  },
]

const sourceMaturity: MaturityOverviewItem = {
  assessmentReason: null,
  bestEndYear: 2032,
  bestStartYear: 2028,
  calculatedAt: "2026-08-30T08:15:00Z",
  confidence: 0.82,
  confidenceLabel: "High",
  demandStatus: null,
  drinkByYear: 2035,
  feedbackVerdict: null,
  firstTrialYear: 2027,
  headline: "Hold",
  isOverride: false,
  isPersonalized: false,
  moveMessage: null,
  moveNeeded: false,
  personalYearShift: 0,
  profileLayers: ["place", "vintage"],
  profileWarnings: [],
  projectionId: "projection-a",
  specificity: "place-vintage",
  state: "hold",
  stateLabel: "Hold",
  storagePurpose: "aging",
  urgency: "low",
  urgencyScore: 1,
  wineId: sourceWine.id,
}

describe("Excel cellar transfer", () => {
  it("creates a readable cellar sheet and a complete technical sheet", async () => {
    const records = createCsvExportRecords(
      [sourceWine],
      [sourceHolding],
      sourceLocations,
      false,
    )
    const blob = await buildPortableXlsxExport(records)
    const sheets = await readXlsxFile(await blob.arrayBuffer())

    expect(sheets.map((sheet) => sheet.sheet)).toEqual([
      "Cellar",
      "CellarManager data",
    ])
    expect(sheets[0]?.data[0]).toContain("Grape composition")
    expect(sheets[0]?.data[1]).toContain("Chardonnay (100%)")
    expect(sheets[0]?.data[1]).toContain("Organic, HVE")
    expect(sheets[1]?.data[0]).toContain(
      "CellarManager CSV version",
    )
    expect(sheets[1]?.data[1]?.at(-1)).toBe("1")
  })

  it("adds one current drinking-window snapshot per wine when connected", async () => {
    const records = createCsvExportRecords(
      [sourceWine],
      [
        sourceHolding,
        { ...sourceHolding, location_id: "location-b", quantity: 1 },
      ],
      [
        ...sourceLocations,
        { cellar_name: "Service cellar", code: "S1", id: "location-b" },
      ],
      false,
    )
    const blob = await buildPortableXlsxExport(records, [sourceMaturity])
    const sheets = await readXlsxFile(await blob.arrayBuffer())
    const maturitySheet = sheets.find(
      (sheet) => sheet.sheet === "Drinking windows",
    )

    expect(sheets.map((sheet) => sheet.sheet)).toEqual([
      "Cellar",
      "Drinking windows",
      "CellarManager data",
    ])
    expect(maturitySheet?.data).toHaveLength(2)
    expect(maturitySheet?.data[0]).toContain("Drink by")
    expect(maturitySheet?.data[1]).toEqual([
      "Domaine Test",
      "Les Referts",
      2020,
      "white",
      "Puligny-Montrachet",
      "Hold",
      2027,
      2028,
      2032,
      2035,
      "CellarManager estimate",
      "High",
      "2026-08-30",
    ])
  })

  it("labels a personal drinking window without treating it as model confidence", async () => {
    const records = createCsvExportRecords(
      [sourceWine],
      [sourceHolding],
      sourceLocations,
      false,
    )
    const blob = await buildPortableXlsxExport(records, [
      {
        ...sourceMaturity,
        confidenceLabel: null,
        isOverride: true,
      },
    ])
    const sheets = await readXlsxFile(await blob.arrayBuffer())
    const row = sheets.find(
      (sheet) => sheet.sheet === "Drinking windows",
    )?.data[1]

    expect(row).toContain("Personal window")
    expect(row?.[11]).toBeNull()
  })

  it("labels privately calibrated guidance without treating it as a manual window", async () => {
    const records = createCsvExportRecords(
      [sourceWine],
      [sourceHolding],
      sourceLocations,
      false,
    )
    const blob = await buildPortableXlsxExport(records, [
      {
        ...sourceMaturity,
        drinkByYear: 2033,
        isPersonalized: true,
        personalYearShift: -2,
      },
    ])
    const sheets = await readXlsxFile(await blob.arrayBuffer())
    const row = sheets.find(
      (sheet) => sheet.sheet === "Drinking windows",
    )?.data[1]

    expect(row).toContain("Personal timing (2 years younger)")
    expect(row).not.toContain("Personal window")
  })

  it("chooses the worksheet with recognized cellar columns", async () => {
    const blob = await writeXlsxFile([
      {
        data: [["Notes"], ["Not the import table"]],
        sheet: "Read me",
      },
      {
        data: [
          ["Producer", "Cuvée", "Color", "Quantity"],
          ["Domaine Test", "House wine", "red", 3],
        ],
        sheet: "Inventory 2026",
      },
    ]).toBlob()
    const document = await parseXlsxWorkbook(
      await blob.arrayBuffer(),
    )

    expect(document.header?.values).toEqual([
      "Producer",
      "Cuvée",
      "Color",
      "Quantity",
    ])
    expect(document.rows[0]?.values).toEqual([
      "Domaine Test",
      "House wine",
      "red",
      "3",
    ])
  })

  it("rejects a newer technical format without guessing", async () => {
    const blob = await writeXlsxFile([
      {
        data: [
          ["Producer", "Cuvée", "Color", "Quantity"],
          ["Domaine Test", "House wine", "red", 3],
        ],
        sheet: "Cellar",
      },
      {
        data: [
          ["Producer", "CellarManager CSV version"],
          ["Domaine Test", 2],
        ],
        sheet: "CellarManager data",
      },
    ]).toBlob()

    await expect(
      parseXlsxWorkbook(await blob.arrayBuffer()),
    ).rejects.toThrow("newer CellarManager CSV format")
  })
})
