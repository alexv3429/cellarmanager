import { describe, expect, it } from "vitest"

import type { CsvMappedSourceRow } from "./csvColumnMapping"
import { cleanCsvMappedRow } from "./csvCleaning"
import {
  applyCsvWineSelections,
  getCsvImportStorageOptions,
  resolveCsvImportIssues,
} from "./csvImportResolution"
import {
  buildCsvImportPreview,
  summarizeCsvImportPreview,
} from "./csvImportPreview"
import type {
  CsvStorageCellar,
  CsvStorageLocation,
} from "./csvStorageReconciliation"
import { matchCsvWines } from "./csvWineMatching"
import type { WineCatalogEntry } from "./wineCatalog"

const householdId = "household-1"

const cellars: CsvStorageCellar[] = [
  {
    household_id: householdId,
    id: "cellar-main",
    is_active: 1,
    name: "Main Cellar",
  },
  {
    household_id: householdId,
    id: "cellar-archived",
    is_active: 0,
    name: "Archived Cellar",
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
    bottle_count: 0,
    capacity: null,
    cellar_id: "cellar-archived",
    code: "Z1",
    household_id: householdId,
    id: "location-archived-cellar",
    is_active: 1,
  },
  {
    bottle_count: 0,
    capacity: null,
    cellar_id: "cellar-main",
    code: "A2",
    household_id: householdId,
    id: "location-archived",
    is_active: 0,
  },
  {
    bottle_count: 0,
    capacity: null,
    cellar_id: "cellar-other",
    code: "X1",
    household_id: "household-2",
    id: "location-other-household",
    is_active: 1,
  },
]

const duplicateWines: WineCatalogEntry[] = [
  {
    appellation: "Morgon",
    area: "Beaujolais",
    color: "red",
    cuvee: "Ambiguous",
    format_ml: 750,
    household_id: householdId,
    id: "wine-a",
    producer: "Domaine Test",
    vintage: 2020,
  },
  {
    appellation: "Fleurie",
    area: "Beaujolais",
    color: "red",
    cuvee: "Ambiguous",
    format_ml: 750,
    household_id: householdId,
    id: "wine-b",
    producer: "Domaine Test",
    vintage: 2020,
  },
]

function cleanedRow(
  overrides: CsvMappedSourceRow["fields"],
  recordNumber: number,
) {
  return cleanCsvMappedRow({
    fields: {
      cellar: "",
      color: "red",
      cuvee: "Ambiguous",
      formatMl: "750",
      location: "",
      producer: "Domaine Test",
      quantity: "1",
      vintage: "2020",
      ...overrides,
    },
    recordNumber,
    sourceLineEnd: recordNumber,
    sourceLineStart: recordNumber,
    unmapped: [],
  })
}

describe("CSV import issue resolution", () => {
  it("offers only active destinations in the active household", () => {
    expect(
      getCsvImportStorageOptions(
        cellars,
        locations,
        householdId,
      ).map(({ cellar, location }) => [
        cellar.id,
        location.id,
      ]),
    ).toEqual([["cellar-main", "location-a1"]])
  })

  it("accepts only an exact candidate from an ambiguous wine match", () => {
    const rows = [cleanedRow({}, 2)]
    const matches = matchCsvWines(
      rows,
      duplicateWines,
      householdId,
    )

    expect(
      applyCsvWineSelections(matches, { 2: "wine-b" })[0],
    ).toMatchObject({
      candidates: [{ id: "wine-b" }],
      classification: "existing",
    })
    expect(
      applyCsvWineSelections(matches, { 2: "not-a-candidate" })[0],
    ).toMatchObject({
      candidates: [{ id: "wine-b" }, { id: "wine-a" }],
      classification: "ambiguous",
    })
  })

  it("resolves wine and storage together into a ready second preview", () => {
    const rows = [cleanedRow({ quantity: "3" }, 2)]
    const wineMatches = matchCsvWines(
      rows,
      duplicateWines,
      householdId,
    )
    const resolved = resolveCsvImportIssues({
      cellars,
      householdId,
      locations,
      rows,
      selections: {
        locationIdByRecord: { 2: "location-a1" },
        wineIdByRecord: { 2: "wine-a" },
      },
      wineMatches,
    })
    const preview = buildCsvImportPreview(
      resolved.wineMatches,
      resolved.storageResults,
    )

    expect(preview[0]).toMatchObject({
      existingWine: { id: "wine-a" },
      status: "warning",
      storage: {
        cellar: { id: "cellar-main" },
        importBottleCount: 3,
        location: { id: "location-a1" },
        projectedBottleCount: 11,
      },
      wineAction: "reuse",
    })
    expect(summarizeCsvImportPreview(preview)).toMatchObject({
      blockedRowCount: 0,
      readyBottleCount: 3,
      warningLocationCount: 1,
    })
  })

  it("blocks the second preview again when a chosen location becomes archived", () => {
    const rows = [cleanedRow({ cuvee: "New" }, 2)]
    const wineMatches = matchCsvWines(
      rows,
      duplicateWines,
      householdId,
    )
    const selections = {
      locationIdByRecord: { 2: "location-a1" },
      wineIdByRecord: {},
    }
    const initiallyResolved = resolveCsvImportIssues({
      cellars,
      householdId,
      locations,
      rows,
      selections,
      wineMatches,
    })
    const afterArchive = resolveCsvImportIssues({
      cellars,
      householdId,
      locations: locations.map((location) =>
        location.id === "location-a1"
          ? { ...location, is_active: 0 }
          : location,
      ),
      rows,
      selections,
      wineMatches,
    })

    expect(
      summarizeCsvImportPreview(
        buildCsvImportPreview(
          initiallyResolved.wineMatches,
          initiallyResolved.storageResults,
        ),
      ).blockedRowCount,
    ).toBe(0)
    expect(
      summarizeCsvImportPreview(
        buildCsvImportPreview(
          afterArchive.wineMatches,
          afterArchive.storageResults,
        ),
      ).blockedRowCount,
    ).toBe(1)
  })

  it("blocks the second preview again when a selected wine is no longer a candidate", () => {
    const rows = [cleanedRow({}, 2)]
    const wineMatches = matchCsvWines(
      rows,
      duplicateWines,
      householdId,
    )
    const selected = applyCsvWineSelections(wineMatches, {
      2: "wine-a",
    })
    const changedMatches = matchCsvWines(
      rows,
      [
        duplicateWines[1] as WineCatalogEntry,
        {
          ...(duplicateWines[1] as WineCatalogEntry),
          appellation: "Chiroubles",
          id: "wine-c",
        },
      ],
      householdId,
    )

    expect(selected[0]).toMatchObject({
      candidates: [{ id: "wine-a" }],
      classification: "existing",
    })
    expect(
      applyCsvWineSelections(changedMatches, { 2: "wine-a" })[0],
    ).toMatchObject({
      classification: "ambiguous",
    })
  })

  it("recalculates aggregate capacity after multiple manual assignments", () => {
    const rows = [
      cleanedRow({ cuvee: "New", quantity: "1" }, 2),
      cleanedRow({ cuvee: "Newer", quantity: "2" }, 3),
    ]
    const resolved = resolveCsvImportIssues({
      cellars,
      householdId,
      locations,
      rows,
      selections: {
        locationIdByRecord: {
          2: "location-a1",
          3: "location-a1",
        },
        wineIdByRecord: {},
      },
      wineMatches: matchCsvWines(
        rows,
        duplicateWines,
        householdId,
      ),
    })

    expect(resolved.storageResults).toEqual([
      expect.objectContaining({
        importBottleCount: 3,
        projectedBottleCount: 11,
        status: "ready",
      }),
      expect.objectContaining({
        importBottleCount: 3,
        projectedBottleCount: 11,
        status: "ready",
      }),
    ])
  })

  it.each([
    "location-archived",
    "location-archived-cellar",
    "location-other-household",
    "missing-location",
  ])("rejects unsafe destination selection %s", (locationId) => {
    const rows = [cleanedRow({ cuvee: "New" }, 2)]
    const resolved = resolveCsvImportIssues({
      cellars,
      householdId,
      locations,
      rows,
      selections: {
        locationIdByRecord: { 2: locationId },
        wineIdByRecord: {},
      },
      wineMatches: matchCsvWines(
        rows,
        duplicateWines,
        householdId,
      ),
    })

    expect(resolved.storageResults[0]).toMatchObject({
      issues: [
        expect.objectContaining({
          code: "INVALID_LOCATION_SELECTION",
        }),
      ],
      location: null,
      status: "unresolved",
    })
  })
})
