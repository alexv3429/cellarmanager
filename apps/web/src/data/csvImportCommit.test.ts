import { describe, expect, it, vi } from "vitest"

import type { CsvImportPreviewRow } from "./csvImportPreview"
import {
  clearPendingCsvImportPlan,
  commitCsvImport,
  createCsvImportCommitPlan,
  getCsvImportReceipt,
  getCsvImportCommitSourceKey,
  readPendingCsvImportPlan,
  savePendingCsvImportPlan,
} from "./csvImportCommit"

const householdId = "household-1"

function previewRow({
  action = "create",
  existingWineId = null,
  quantity = 2,
  recordNumber = 2,
  status = "ready",
}: {
  action?: "create" | "reuse"
  existingWineId?: string | null
  quantity?: number
  recordNumber?: number
  status?: CsvImportPreviewRow["status"]
} = {}): CsvImportPreviewRow {
  const existingWine = existingWineId
    ? {
        appellation: "Morgon",
        area: "Beaujolais",
        color: "red",
        cuvee: "Cuvée Test",
        format_ml: 750,
        household_id: householdId,
        id: existingWineId,
        producer: "Domaine Test",
        vintage: 2020,
      }
    : null

  return {
    existingWine,
    issues:
      status === "warning"
        ? [
            {
              category: "storage",
              code: "LOCATION_CAPACITY_EXCEEDED",
              message: "Capacity exceeded",
              severity: "warning",
            },
          ]
        : [],
    row: {
      changes: [],
      fields: {
        appellation: "Morgon",
        area: "Beaujolais",
        cellar: "Main",
        color: "red",
        cuvee: "Cuvée Test",
        formatMl: 750,
        location: "A1",
        producer: "Domaine Test",
        quantity,
        vintage: 2020,
      },
      issues: [],
      recordNumber,
      sourceLineEnd: recordNumber,
      sourceLineStart: recordNumber,
      sourceRow: {
        fields: {},
        recordNumber,
        sourceLineEnd: recordNumber,
        sourceLineStart: recordNumber,
        unmapped: [],
      },
    },
    status,
    storage: {
      cellar: {
        household_id: householdId,
        id: "cellar-1",
        is_active: 1,
        name: "Main",
      },
      currentBottleCount: 4,
      importBottleCount: quantity,
      issues: [],
      location: {
        bottle_count: 4,
        capacity: 20,
        cellar_id: "cellar-1",
        code: "A1",
        household_id: householdId,
        id: "location-1",
        is_active: 1,
      },
      projectedBottleCount: 4 + quantity,
      quantity,
      row: {} as never,
      status: "ready",
    },
    wineAction: action,
    wineMatch: null,
  }
}

function dependencies(ids: string[]) {
  let index = 0

  return {
    createUuid: () => ids[index++] ?? `id-${index}`,
    now: () => new Date("2026-08-14T10:00:00.000Z"),
  }
}

describe("CSV import commit plan", () => {
  it("shares one requested wine ID across repeated new-wine rows", () => {
    const plan = createCsvImportCommitPlan(
      {
        deviceId: "device-1",
        householdId,
        previewRows: [
          previewRow({ recordNumber: 2 }),
          previewRow({ quantity: 3, recordNumber: 3 }),
        ],
      },
      dependencies([
        "import-1",
        "wine-new",
        "operation-1",
        "operation-2",
      ]),
    )

    expect(plan).toMatchObject({
      createdAtClient: "2026-08-14T10:00:00.000Z",
      deviceId: "device-1",
      householdId,
      importId: "import-1",
    })
    expect(plan.rows).toEqual([
      expect.objectContaining({
        operationId: "operation-1",
        quantity: 2,
        requestedWineId: "wine-new",
        wineAction: "create",
      }),
      expect.objectContaining({
        operationId: "operation-2",
        quantity: 3,
        requestedWineId: "wine-new",
        wineAction: "create",
      }),
    ])
  })

  it("retains an explicitly selected existing wine", () => {
    const plan = createCsvImportCommitPlan(
      {
        deviceId: "device-1",
        householdId,
        previewRows: [
          previewRow({
            action: "reuse",
            existingWineId: "wine-existing",
          }),
        ],
      },
      dependencies(["import-1", "operation-1"]),
    )

    expect(plan.rows[0]).toMatchObject({
      requestedWineId: "wine-existing",
      wineAction: "reuse",
    })
  })

  it("allows advisory warning rows but rejects blockers", () => {
    expect(() =>
      createCsvImportCommitPlan(
        {
          deviceId: "device-1",
          householdId,
          previewRows: [previewRow({ status: "warning" })],
        },
        dependencies([
          "import-1",
          "wine-new",
          "operation-1",
        ]),
      ),
    ).not.toThrow()

    expect(() =>
      createCsvImportCommitPlan(
        {
          deviceId: "device-1",
          householdId,
          previewRows: [previewRow({ status: "blocked" })],
        },
        dependencies(["import-1"]),
      ),
    ).toThrow("Source record 2 is still blocked")
  })

  it("rejects empty previews and duplicate source records", () => {
    expect(() =>
      createCsvImportCommitPlan(
        {
          deviceId: "device-1",
          householdId,
          previewRows: [],
        },
        dependencies(["import-1"]),
      ),
    ).toThrow("preview has no rows")

    expect(() =>
      createCsvImportCommitPlan(
        {
          deviceId: "device-1",
          householdId,
          previewRows: [previewRow(), previewRow()],
        },
        dependencies(["import-1", "wine-new", "operation-1"]),
      ),
    ).toThrow("Source record 2 appears more than once")
  })

  it("changes the confirmation key when the live preview changes", () => {
    const initial = [previewRow()]
    const changed = [previewRow({ quantity: 3 })]

    expect(getCsvImportCommitSourceKey(initial)).not.toBe(
      getCsvImportCommitSourceKey(changed),
    )
  })

  it("persists and clears only an uncertain household plan", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key)
      },
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }
    const plan = createCsvImportCommitPlan(
      {
        deviceId: "device-1",
        householdId,
        previewRows: [previewRow()],
      },
      dependencies([
        "import-1",
        "wine-new",
        "operation-1",
      ]),
    )

    savePendingCsvImportPlan(storage, plan)

    expect(
      readPendingCsvImportPlan(storage, householdId),
    ).toEqual(plan)
    expect(
      readPendingCsvImportPlan(storage, "household-2"),
    ).toBeNull()

    clearPendingCsvImportPlan(storage, householdId)
    expect(
      readPendingCsvImportPlan(storage, householdId),
    ).toBeNull()
  })

  it("ignores a malformed pending plan", () => {
    const storage = {
      getItem: () => JSON.stringify({ householdId, rows: [] }),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    }

    expect(
      readPendingCsvImportPlan(storage, householdId),
    ).toBeNull()
  })

  it("does not let unavailable browser storage break recovery cleanup", () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error("storage disabled")
      },
      removeItem: () => {
        throw new Error("storage disabled")
      },
      setItem: () => {
        throw new Error("storage disabled")
      },
    }

    expect(
      readPendingCsvImportPlan(
        unavailableStorage,
        householdId,
      ),
    ).toBeNull()
    expect(() =>
      clearPendingCsvImportPlan(
        unavailableStorage,
        householdId,
      ),
    ).not.toThrow()
  })
})

describe("CSV import commit RPC", () => {
  it("sends the immutable plan and parses its receipt", async () => {
    const plan = createCsvImportCommitPlan(
      {
        deviceId: "device-1",
        householdId,
        previewRows: [previewRow()],
      },
      dependencies([
        "import-1",
        "wine-new",
        "operation-1",
      ]),
    )
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          created_wine_count: 1,
          import_id: "import-1",
          imported_bottle_count: "2",
          imported_row_count: 1,
          reused_wine_count: 0,
        },
      ],
      error: null,
    })

    await expect(
      commitCsvImport(plan, { rpc }),
    ).resolves.toEqual({
      createdWineCount: 1,
      importId: "import-1",
      importedBottleCount: 2,
      importedRowCount: 1,
      reusedWineCount: 0,
    })
    expect(rpc).toHaveBeenCalledWith(
      "commit_csv_import",
      expect.objectContaining({
        p_device_id: "device-1",
        p_household_id: householdId,
        p_import_id: "import-1",
        p_rows: [
          expect.objectContaining({
            operation_id: "operation-1",
            quantity: 2,
            requested_wine_id: "wine-new",
            wine_action: "create",
          }),
        ],
      }),
    )
  })

  it("surfaces RPC failures without replacing the retry plan", async () => {
    const plan = createCsvImportCommitPlan(
      {
        deviceId: "device-1",
        householdId,
        previewRows: [previewRow()],
      },
      dependencies([
        "import-1",
        "wine-new",
        "operation-1",
      ]),
    )

    await expect(
      commitCsvImport(plan, {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "network response was lost" },
        }),
      }),
    ).rejects.toThrow(
      "CSV import failed: network response was lost",
    )
    expect(plan.importId).toBe("import-1")
  })

  it("checks whether an uncertain import already has a receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          created_wine_count: 1,
          import_id: "import-1",
          imported_bottle_count: 2,
          imported_row_count: 1,
          reused_wine_count: 0,
        },
      ],
      error: null,
    })

    await expect(
      getCsvImportReceipt(
        { householdId, importId: "import-1" },
        { rpc },
      ),
    ).resolves.toEqual({
      createdWineCount: 1,
      importId: "import-1",
      importedBottleCount: 2,
      importedRowCount: 1,
      reusedWineCount: 0,
    })
  })

  it("returns null when a failed transaction has no receipt", async () => {
    await expect(
      getCsvImportReceipt(
        { householdId, importId: "import-missing" },
        {
          rpc: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        },
      ),
    ).resolves.toBeNull()
  })
})
