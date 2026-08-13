import { describe, expect, it } from "vitest"

import type { CsvMappedSourceRow } from "./csvColumnMapping"
import { cleanCsvMappedRow } from "./csvCleaning"
import {
  buildCsvImportPreview,
  summarizeCsvImportPreview,
} from "./csvImportPreview"
import {
  reconcileCsvStorage,
  type CsvStorageCellar,
  type CsvStorageLocation,
} from "./csvStorageReconciliation"
import { matchCsvWines } from "./csvWineMatching"
import type { WineCatalogEntry } from "./wineCatalog"

const householdId = "household-1"

const wines: WineCatalogEntry[] = [
  {
    appellation: "Morgon",
    area: "Beaujolais",
    color: "red",
    cuvee: "Existing",
    format_ml: 750,
    household_id: householdId,
    id: "wine-existing",
    producer: "Domaine Test",
    vintage: 2020,
  },
]

const cellars: CsvStorageCellar[] = [
  {
    household_id: householdId,
    id: "cellar-main",
    is_active: 1,
    name: "Main Cellar",
  },
]

const locations: CsvStorageLocation[] = [
  {
    bottle_count: 8,
    capacity: 10,
    cellar_id: "cellar-main",
    code: "A1",
    household_id: householdId,
    id: "location-a1",
    is_active: 1,
  },
  {
    bottle_count: 1,
    capacity: null,
    cellar_id: "cellar-main",
    code: "A2",
    household_id: householdId,
    id: "location-a2",
    is_active: 1,
  },
]

function cleanedRow(
  overrides: CsvMappedSourceRow["fields"],
  recordNumber: number,
) {
  return cleanCsvMappedRow({
    fields: {
      cellar: "Main Cellar",
      color: "red",
      cuvee: "New",
      formatMl: "750",
      location: "A2",
      producer: "Domaine Test",
      quantity: "1",
      vintage: "2021",
      ...overrides,
    },
    recordNumber,
    sourceLineEnd: recordNumber,
    sourceLineStart: recordNumber,
    unmapped: [
      {
        sourceColumnIndex: 10,
        sourceHeader: "Notes",
        value: "Keep this source context",
      },
    ],
  })
}

function previewFor(rows: ReturnType<typeof cleanedRow>[]) {
  return buildCsvImportPreview(
    matchCsvWines(rows, wines, householdId),
    reconcileCsvStorage(
      rows,
      cellars,
      locations,
      householdId,
    ),
  )
}

describe("CSV import preview", () => {
  it("combines an existing wine, destination, and quantity", () => {
    const [row] = previewFor([
      cleanedRow(
        {
          cuvee: "Existing",
          quantity: "2",
          vintage: "2020",
        },
        2,
      ),
    ])

    expect(row).toMatchObject({
      existingWine: { id: "wine-existing" },
      issues: [],
      status: "ready",
      storage: {
        cellar: { id: "cellar-main" },
        location: { id: "location-a2" },
        quantity: 2,
      },
      wineAction: "reuse",
    })
    expect(row?.row.sourceRow.unmapped).toEqual([
      expect.objectContaining({
        sourceHeader: "Notes",
        value: "Keep this source context",
      }),
    ])
  })

  it("shows a new wine as a planned catalog creation", () => {
    const [row] = previewFor([cleanedRow({}, 2)])

    expect(row).toMatchObject({
      existingWine: null,
      issues: [],
      status: "ready",
      wineAction: "create",
    })
  })

  it("keeps capacity overruns advisory", () => {
    const [row] = previewFor([
      cleanedRow(
        { location: "A1", quantity: "3" },
        2,
      ),
    ])

    expect(row?.status).toBe("warning")
    expect(row?.issues).toEqual([
      expect.objectContaining({
        category: "storage",
        code: "LOCATION_CAPACITY_EXCEEDED",
        severity: "warning",
      }),
    ])
  })

  it("combines wine and storage blockers without selecting a fallback", () => {
    const ambiguousCatalog: WineCatalogEntry[] = [
      ...wines,
      { ...wines[0] as WineCatalogEntry, id: "wine-duplicate" },
    ]
    const rows = [
      cleanedRow(
        {
          cuvee: "Existing",
          location: "Missing",
          vintage: "2020",
        },
        2,
      ),
    ]
    const [row] = buildCsvImportPreview(
      matchCsvWines(rows, ambiguousCatalog, householdId),
      reconcileCsvStorage(
        rows,
        cellars,
        locations,
        householdId,
      ),
    )

    expect(row).toMatchObject({
      existingWine: null,
      status: "blocked",
      storage: { location: null },
      wineAction: "unresolved",
    })
    expect(row?.issues.map((issue) => issue.code)).toEqual([
      "AMBIGUOUS_WINE",
      "UNKNOWN_LOCATION",
    ])
  })

  it("pairs results by source record even when storage order differs", () => {
    const rows = [
      cleanedRow({ quantity: "2" }, 2),
      cleanedRow({ quantity: "4" }, 3),
    ]
    const matches = matchCsvWines(rows, wines, householdId)
    const storage = reconcileCsvStorage(
      rows,
      cellars,
      locations,
      householdId,
    ).reverse()

    expect(
      buildCsvImportPreview(matches, storage).map((row) => ({
        quantity: row.storage?.quantity,
        recordNumber: row.row.recordNumber,
      })),
    ).toEqual([
      { quantity: 2, recordNumber: 2 },
      { quantity: 4, recordNumber: 3 },
    ])
  })

  it("blocks incomplete preview inputs instead of guessing", () => {
    const rows = [cleanedRow({}, 2), cleanedRow({}, 3)]
    const matches = matchCsvWines(rows, wines, householdId)
    const storage = reconcileCsvStorage(
      rows,
      cellars,
      locations,
      householdId,
    )
    const preview = buildCsvImportPreview(
      matches.slice(0, 1),
      storage.slice(1),
    )

    expect(preview).toHaveLength(2)
    expect(
      preview.map((row) => ({
        issue: row.issues[0]?.message,
        recordNumber: row.row.recordNumber,
        status: row.status,
      })),
    ).toEqual([
      {
        issue: "Storage reconciliation is missing for this source row",
        recordNumber: 2,
        status: "blocked",
      },
      {
        issue: "Wine matching is missing for this source row",
        recordNumber: 3,
        status: "blocked",
      },
    ])
  })

  it("summarizes distinct wines, destinations, blockers, and warnings", () => {
    const rows = [
      cleanedRow(
        {
          cuvee: "Existing",
          quantity: "2",
          vintage: "2020",
        },
        2,
      ),
      cleanedRow(
        { location: "A1", quantity: "3" },
        3,
      ),
      cleanedRow(
        { location: "Missing", quantity: "4" },
        4,
      ),
      cleanedRow(
        { location: "A1", quantity: "1" },
        5,
      ),
    ]

    expect(summarizeCsvImportPreview(previewFor(rows))).toEqual({
      blockedBottleCount: 4,
      blockedRowCount: 1,
      destinationCount: 2,
      existingWineCount: 1,
      newWineCount: 1,
      readyBottleCount: 6,
      readyRowCount: 3,
      totalBottleCount: 10,
      totalRowCount: 4,
      warningLocationCount: 1,
    })
  })
})
