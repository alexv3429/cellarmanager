import { describe, expect, it, vi } from "vitest"

import blockedValuesCsv from "./fixtures/csv-import/blocked-values.csv?raw"
import malformedStructureCsv from "./fixtures/csv-import/malformed-structure.csv?raw"
import messyResolvableCsv from "./fixtures/csv-import/messy-resolvable.csv?raw"
import {
  mapCsvSourceRow,
  suggestCsvColumnMapping,
  validateCsvColumnMapping,
} from "./csvColumnMapping"
import {
  cleanCsvMappedRow,
  summarizeCsvCleaning,
} from "./csvCleaning"
import {
  commitCsvImport,
  createCsvImportCommitPlan,
  getCsvImportCommitSourceKey,
} from "./csvImportCommit"
import { parseCsvText } from "./csvIngestion"
import {
  resolveCsvImportIssues,
} from "./csvImportResolution"
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

const householdId = "household-regression"

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
    bottle_count: 4,
    capacity: 10,
    cellar_id: "cellar-main",
    code: "A1",
    household_id: householdId,
    id: "location-a1",
    is_active: 1,
  },
  {
    bottle_count: 10,
    capacity: 12,
    cellar_id: "cellar-main",
    code: "A2",
    household_id: householdId,
    id: "location-a2",
    is_active: 1,
  },
]

const wines: WineCatalogEntry[] = [
  {
    appellation: "Morgon",
    area: "Beaujolais",
    color: "rouge",
    cuvee: "Cuvée Existante",
    format_ml: 750,
    household_id: householdId,
    id: "wine-existing",
    producer: "Domaine Existing",
    vintage: 2020,
  },
  {
    appellation: "Morgon",
    area: "Beaujolais",
    color: "red",
    cuvee: "Cuvée Double",
    format_ml: 750,
    household_id: householdId,
    id: "wine-ambiguous-a",
    producer: "Domaine Ambiguous",
    vintage: 2019,
  },
  {
    appellation: "Fleurie",
    area: "Beaujolais",
    color: "red",
    cuvee: "Cuvée Double",
    format_ml: 750,
    household_id: householdId,
    id: "wine-ambiguous-b",
    producer: "Domaine Ambiguous",
    vintage: 2019,
  },
  {
    appellation: "Morgon",
    area: "Beaujolais",
    color: "rouge",
    cuvee: "Cuvée Existante",
    format_ml: 750,
    household_id: "other-household",
    id: "wine-other-household",
    producer: "Domaine Existing",
    vintage: 2020,
  },
]

function prepareStructurallyValidFixture(text: string) {
  const document = parseCsvText(text)

  expect(document.issues).toEqual([])

  if (!document.header) {
    throw new Error("Regression fixture has no header")
  }

  const mapping = suggestCsvColumnMapping(
    document.header.values,
  )

  expect(validateCsvColumnMapping(mapping)).toEqual([])

  const mappedRows = document.rows.map((row) =>
    mapCsvSourceRow(
      document.header?.values ?? [],
      row,
      mapping,
    ),
  )
  const cleanedRows = mappedRows.map((row) =>
    cleanCsvMappedRow(row),
  )

  return {
    cleanedRows,
    document,
    mappedRows,
    mapping,
  }
}

describe("CSV import regression fixtures", () => {
  it("keeps a messy resolvable CSV stable through confirmation and the RPC boundary", async () => {
    const {
      cleanedRows,
      document,
      mappedRows,
      mapping,
    } = prepareStructurallyValidFixture(messyResolvableCsv)

    expect(document).toMatchObject({
      delimiter: ";",
      delimiterSource: "directive",
      truncated: false,
    })
    expect(mapping).toEqual([
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
      null,
    ])
    expect(
      mappedRows.map((row) => row.recordNumber),
    ).toEqual([2, 3, 4, 5])
    expect(mappedRows[3]).toMatchObject({
      sourceLineEnd: 7,
      sourceLineStart: 6,
      unmapped: [
        {
          sourceColumnIndex: 10,
          sourceHeader: "Commentaire",
          value: "même vin, autre rangement\nnote conservée",
        },
      ],
    })
    expect(summarizeCsvCleaning(cleanedRows)).toMatchObject({
      invalidRowCount: 0,
      issueCount: 0,
      readyRowCount: 4,
      totalRowCount: 4,
    })
    expect(cleanedRows.map((row) => row.fields)).toEqual([
      expect.objectContaining({
        color: "rouge",
        formatMl: 750,
        producer: "Domaine Existing",
        quantity: 2,
        vintage: 2020,
      }),
      expect.objectContaining({
        cellar: null,
        formatMl: 750,
        location: null,
        quantity: 1,
      }),
      expect.objectContaining({
        color: "white",
        formatMl: 750,
        producer: "New Estate",
        quantity: 3,
        vintage: null,
      }),
      expect.objectContaining({
        color: "white",
        formatMl: 750,
        producer: "New Estate",
        quantity: 2,
        vintage: null,
      }),
    ])

    const wineMatches = matchCsvWines(
      cleanedRows,
      wines,
      householdId,
    )
    const initialStorage = reconcileCsvStorage(
      cleanedRows,
      cellars,
      locations,
      householdId,
    )
    const initialPreview = buildCsvImportPreview(
      wineMatches,
      initialStorage,
    )

    expect(
      wineMatches.map((match) => match.classification),
    ).toEqual(["existing", "ambiguous", "new", "new"])
    expect(
      initialStorage.map((result) => result.status),
    ).toEqual(["ready", "unresolved", "ready", "unresolved"])
    expect(summarizeCsvImportPreview(initialPreview)).toEqual({
      blockedBottleCount: 3,
      blockedRowCount: 2,
      destinationCount: 2,
      existingWineCount: 1,
      newWineCount: 1,
      readyBottleCount: 5,
      readyRowCount: 2,
      totalBottleCount: 8,
      totalRowCount: 4,
      warningLocationCount: 1,
    })

    const resolved = resolveCsvImportIssues({
      cellars,
      householdId,
      locations,
      rows: cleanedRows,
      selections: {
        locationIdByRecord: {
          3: "location-a1",
          5: "location-a2",
        },
        wineIdByRecord: { 3: "wine-ambiguous-b" },
      },
      wineMatches,
    })
    const finalPreview = buildCsvImportPreview(
      resolved.wineMatches,
      resolved.storageResults,
    )

    expect(
      finalPreview.map((row) => row.status),
    ).toEqual(["ready", "ready", "warning", "warning"])
    expect(summarizeCsvImportPreview(finalPreview)).toEqual({
      blockedBottleCount: 0,
      blockedRowCount: 0,
      destinationCount: 2,
      existingWineCount: 2,
      newWineCount: 1,
      readyBottleCount: 8,
      readyRowCount: 4,
      totalBottleCount: 8,
      totalRowCount: 4,
      warningLocationCount: 1,
    })

    const generatedIds = [
      "import-regression",
      "operation-2",
      "operation-3",
      "wine-new",
      "operation-4",
      "operation-5",
    ]
    let generatedIdIndex = 0
    const plan = createCsvImportCommitPlan(
      {
        deviceId: "device-regression",
        householdId,
        previewRows: finalPreview,
      },
      {
        createUuid: () =>
          generatedIds[generatedIdIndex++] ?? "unexpected-id",
        now: () => new Date("2026-08-14T12:00:00.000Z"),
      },
    )

    expect(plan.sourceKey).toBe(
      getCsvImportCommitSourceKey(finalPreview),
    )
    expect(
      plan.rows.map((row) => ({
        destinationLocationId: row.destinationLocationId,
        operationId: row.operationId,
        quantity: row.quantity,
        recordNumber: row.recordNumber,
        requestedWineId: row.requestedWineId,
        wineAction: row.wineAction,
      })),
    ).toEqual([
      {
        destinationLocationId: "location-a1",
        operationId: "operation-2",
        quantity: 2,
        recordNumber: 2,
        requestedWineId: "wine-existing",
        wineAction: "reuse",
      },
      {
        destinationLocationId: "location-a1",
        operationId: "operation-3",
        quantity: 1,
        recordNumber: 3,
        requestedWineId: "wine-ambiguous-b",
        wineAction: "reuse",
      },
      {
        destinationLocationId: "location-a2",
        operationId: "operation-4",
        quantity: 3,
        recordNumber: 4,
        requestedWineId: "wine-new",
        wineAction: "create",
      },
      {
        destinationLocationId: "location-a2",
        operationId: "operation-5",
        quantity: 2,
        recordNumber: 5,
        requestedWineId: "wine-new",
        wineAction: "create",
      },
    ])

    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          created_wine_count: 1,
          import_id: "import-regression",
          imported_bottle_count: 8,
          imported_row_count: 4,
          reused_wine_count: 2,
        },
      ],
      error: null,
    })

    await expect(
      commitCsvImport(plan, { rpc }),
    ).resolves.toEqual({
      createdWineCount: 1,
      importId: "import-regression",
      importedBottleCount: 8,
      importedRowCount: 4,
      reusedWineCount: 2,
    })
    expect(rpc).toHaveBeenCalledWith(
      "commit_csv_import",
      expect.objectContaining({
        p_device_id: "device-regression",
        p_household_id: householdId,
        p_import_id: "import-regression",
        p_rows: [
          expect.objectContaining({
            operation_id: "operation-2",
            record_number: 2,
            requested_wine_id: "wine-existing",
            wine_action: "reuse",
          }),
          expect.objectContaining({
            operation_id: "operation-3",
            record_number: 3,
            requested_wine_id: "wine-ambiguous-b",
            wine_action: "reuse",
          }),
          expect.objectContaining({
            operation_id: "operation-4",
            record_number: 4,
            requested_wine_id: "wine-new",
            wine_action: "create",
          }),
          expect.objectContaining({
            operation_id: "operation-5",
            record_number: 5,
            requested_wine_id: "wine-new",
            wine_action: "create",
          }),
        ],
      }),
    )
  })

  it("keeps validly structured but unsafe values blocked before commit", () => {
    const { cleanedRows } =
      prepareStructurallyValidFixture(blockedValuesCsv)

    expect(summarizeCsvCleaning(cleanedRows)).toMatchObject({
      invalidRowCount: 1,
      issueCount: 3,
      readyRowCount: 1,
      totalRowCount: 2,
    })
    expect(
      cleanedRows[0]?.issues.map((issue) => issue.code),
    ).toEqual([
      "INVALID_VINTAGE",
      "INVALID_BOTTLE_FORMAT",
      "INVALID_QUANTITY",
    ])

    const wineMatches = matchCsvWines(
      cleanedRows,
      wines,
      householdId,
    )
    const storageResults = reconcileCsvStorage(
      cleanedRows,
      cellars,
      locations,
      householdId,
    )
    const preview = buildCsvImportPreview(
      wineMatches,
      storageResults,
    )

    expect(preview.map((row) => row.status)).toEqual([
      "blocked",
      "blocked",
    ])
    expect(
      preview.map((row) =>
        row.issues.map((issue) => issue.code),
      ),
    ).toEqual([
      ["INVALID_WINE"],
      ["AMBIGUOUS_WINE", "MISSING_STORAGE"],
    ])
    expect(summarizeCsvImportPreview(preview)).toMatchObject({
      blockedBottleCount: 1,
      blockedRowCount: 2,
      readyBottleCount: 0,
      readyRowCount: 0,
      totalBottleCount: 1,
      totalRowCount: 2,
    })
    expect(() =>
      createCsvImportCommitPlan(
        {
          deviceId: "device-regression",
          householdId,
          previewRows: preview,
        },
        {
          createUuid: () => "blocked-import",
          now: () => new Date("2026-08-14T12:00:00.000Z"),
        },
      ),
    ).toThrow("Source record 2 is still blocked")
  })

  it("rejects structural corruption before mapping", () => {
    const document = parseCsvText(malformedStructureCsv)

    expect(document).toMatchObject({
      delimiter: ",",
      delimiterSource: "detected",
      truncated: false,
    })
    expect(
      document.issues.map((issue) => ({
        code: issue.code,
        recordNumber: issue.recordNumber,
        severity: issue.severity,
        sourceLineNumber: issue.sourceLineNumber,
      })),
    ).toEqual([
      {
        code: "UNEXPECTED_CHARACTER_AFTER_QUOTE",
        recordNumber: 2,
        severity: "error",
        sourceLineNumber: 2,
      },
      {
        code: "COLUMN_COUNT_MISMATCH",
        recordNumber: 3,
        severity: "error",
        sourceLineNumber: 3,
      },
    ])
  })
})
