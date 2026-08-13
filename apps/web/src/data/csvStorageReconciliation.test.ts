import { describe, expect, it } from "vitest"

import type { CsvMappedSourceRow } from "./csvColumnMapping"
import { cleanCsvMappedRow } from "./csvCleaning"
import {
  reconcileCsvStorage,
  summarizeCsvStorageReconciliation,
  type CsvStorageCellar,
  type CsvStorageLocation,
} from "./csvStorageReconciliation"

const cellars: CsvStorageCellar[] = [
  {
    household_id: "household-1",
    id: "cellar-main",
    is_active: 1,
    name: "Main Cellar",
  },
  {
    household_id: "household-1",
    id: "cellar-archived",
    is_active: 0,
    name: "Old Cellar",
  },
  {
    household_id: "household-2",
    id: "cellar-private",
    is_active: 1,
    name: "Private Cellar",
  },
]

const locations: CsvStorageLocation[] = [
  {
    bottle_count: 5,
    capacity: 10,
    cellar_id: "cellar-main",
    code: "A1",
    household_id: "household-1",
    id: "location-a1",
    is_active: 1,
  },
  {
    bottle_count: 2,
    capacity: null,
    cellar_id: "cellar-main",
    code: "A2",
    household_id: "household-1",
    id: "location-a2",
    is_active: 1,
  },
  {
    bottle_count: 0,
    capacity: 6,
    cellar_id: "cellar-main",
    code: "A0",
    household_id: "household-1",
    id: "location-archived",
    is_active: 0,
  },
]

function cleanedRow(
  fields: CsvMappedSourceRow["fields"],
  recordNumber = 2,
) {
  return cleanCsvMappedRow({
    fields: {
      color: "red",
      cuvee: "Cuvée",
      formatMl: "750",
      producer: "Domaine",
      quantity: "1",
      ...fields,
    },
    recordNumber,
    sourceLineEnd: recordNumber,
    sourceLineStart: recordNumber,
    unmapped: [],
  })
}

describe("CSV storage and quantity reconciliation", () => {
  it("matches an active location by normalized cellar and code", () => {
    const [result] = reconcileCsvStorage(
      [
        cleanedRow({
          cellar: " main   cellar ",
          location: " a1 ",
          quantity: "2",
        }),
      ],
      cellars,
      locations,
      "household-1",
    )

    expect(result).toMatchObject({
      currentBottleCount: 5,
      importBottleCount: 2,
      projectedBottleCount: 7,
      quantity: 2,
      status: "ready",
    })
    expect(result?.cellar?.id).toBe("cellar-main")
    expect(result?.location?.id).toBe("location-a1")
    expect(result?.issues).toEqual([])
  })

  it("keeps missing cellar and location assignments explicit", () => {
    const results = reconcileCsvStorage(
      [
        cleanedRow({}, 2),
        cleanedRow({ location: "A1" }, 3),
        cleanedRow({ cellar: "Main Cellar" }, 4),
      ],
      cellars,
      locations,
      "household-1",
    )

    expect(
      results.map((result) => result.issues[0]?.code),
    ).toEqual([
      "MISSING_STORAGE",
      "MISSING_CELLAR",
      "MISSING_LOCATION",
    ])
    expect(
      results.every((result) => result.status === "unresolved"),
    ).toBe(true)
  })

  it("does not assign storage to an invalid cleaned row", () => {
    const [result] = reconcileCsvStorage(
      [
        cleanedRow({
          cellar: "Main Cellar",
          location: "A1",
          quantity: "0",
        }),
      ],
      cellars,
      locations,
      "household-1",
    )

    expect(result).toMatchObject({
      cellar: null,
      currentBottleCount: null,
      importBottleCount: null,
      location: null,
      projectedBottleCount: null,
      quantity: null,
      status: "invalid",
    })
    expect(result?.issues[0]?.code).toBe("INVALID_SOURCE_ROW")
  })

  it("distinguishes unknown and archived storage", () => {
    const results = reconcileCsvStorage(
      [
        cleanedRow(
          { cellar: "Missing", location: "A1" },
          2,
        ),
        cleanedRow(
          { cellar: "Old Cellar", location: "A1" },
          3,
        ),
        cleanedRow(
          { cellar: "Main Cellar", location: "Missing" },
          4,
        ),
        cleanedRow(
          { cellar: "Main Cellar", location: "A0" },
          5,
        ),
      ],
      cellars,
      locations,
      "household-1",
    )

    expect(
      results.map((result) => result.issues[0]?.code),
    ).toEqual([
      "UNKNOWN_CELLAR",
      "ARCHIVED_CELLAR",
      "UNKNOWN_LOCATION",
      "ARCHIVED_LOCATION",
    ])
  })

  it("never matches storage from another household", () => {
    const [result] = reconcileCsvStorage(
      [
        cleanedRow({
          cellar: "Private Cellar",
          location: "A1",
        }),
      ],
      cellars,
      locations,
      "household-1",
    )

    expect(result?.issues[0]?.code).toBe("UNKNOWN_CELLAR")
    expect(result?.location).toBeNull()
  })

  it("surfaces ambiguous active storage instead of choosing", () => {
    const duplicateCellars: CsvStorageCellar[] = [
      ...cellars,
      {
        household_id: "household-1",
        id: "cellar-main-duplicate",
        is_active: 1,
        name: " main cellar ",
      },
    ]
    const duplicateLocations: CsvStorageLocation[] = [
      ...locations,
      {
        ...locations[0] as CsvStorageLocation,
        id: "location-a1-duplicate",
      },
    ]

    const [ambiguousCellar] = reconcileCsvStorage(
      [
        cleanedRow({
          cellar: "Main Cellar",
          location: "A1",
        }),
      ],
      duplicateCellars,
      locations,
      "household-1",
    )
    const [ambiguousLocation] = reconcileCsvStorage(
      [
        cleanedRow({
          cellar: "Main Cellar",
          location: "A1",
        }),
      ],
      cellars,
      duplicateLocations,
      "household-1",
    )

    expect(ambiguousCellar?.issues[0]?.code).toBe(
      "AMBIGUOUS_CELLAR",
    )
    expect(ambiguousLocation?.issues[0]?.code).toBe(
      "AMBIGUOUS_LOCATION",
    )
  })

  it("aggregates imported quantity before checking capacity", () => {
    const results = reconcileCsvStorage(
      [
        cleanedRow(
          {
            cellar: "Main Cellar",
            location: "A1",
            quantity: "3",
          },
          2,
        ),
        cleanedRow(
          {
            cellar: "Main Cellar",
            location: "A1",
            quantity: "4",
          },
          3,
        ),
      ],
      cellars,
      locations,
      "household-1",
    )

    expect(
      results.map((result) => ({
        importBottleCount: result.importBottleCount,
        projectedBottleCount: result.projectedBottleCount,
        status: result.status,
        warning: result.issues[0]?.code,
      })),
    ).toEqual([
      {
        importBottleCount: 7,
        projectedBottleCount: 12,
        status: "ready",
        warning: "LOCATION_CAPACITY_EXCEEDED",
      },
      {
        importBottleCount: 7,
        projectedBottleCount: 12,
        status: "ready",
        warning: "LOCATION_CAPACITY_EXCEEDED",
      },
    ])
  })

  it("allows an exact capacity or an unconfigured capacity", () => {
    const results = reconcileCsvStorage(
      [
        cleanedRow({
          cellar: "Main Cellar",
          location: "A1",
          quantity: "5",
        }),
        cleanedRow(
          {
            cellar: "Main Cellar",
            location: "A2",
            quantity: "200",
          },
          3,
        ),
      ],
      cellars,
      locations,
      "household-1",
    )

    expect(results[0]?.projectedBottleCount).toBe(10)
    expect(results[0]?.issues).toEqual([])
    expect(results[1]?.projectedBottleCount).toBe(202)
    expect(results[1]?.issues).toEqual([])
  })

  it("summarizes assigned quantities and warning locations", () => {
    const results = reconcileCsvStorage(
      [
        cleanedRow(
          {
            cellar: "Main Cellar",
            location: "A1",
            quantity: "6",
          },
          2,
        ),
        cleanedRow(
          {
            cellar: "Main Cellar",
            location: "A1",
            quantity: "1",
          },
          3,
        ),
        cleanedRow({ quantity: "2" }, 4),
      ],
      cellars,
      locations,
      "household-1",
    )

    expect(
      summarizeCsvStorageReconciliation(results),
    ).toEqual({
      assignedBottleCount: 7,
      capacityWarningLocationCount: 1,
      readyRowCount: 2,
      totalBottleCount: 9,
      totalRowCount: 3,
      unresolvedRowCount: 1,
    })
  })
})
