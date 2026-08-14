import { describe, expect, it } from "vitest"

import {
  buildInventoryActivity,
  filterInventoryActivity,
  summarizeInventoryActivity,
  type InventoryActivityRow,
} from "./activityView"

function activityRow(
  overrides: Partial<InventoryActivityRow> = {},
): InventoryActivityRow {
  return {
    catalog_wine_id: "wine-1",
    color: "red",
    created_at_client: "2026-08-14T08:00:00.000Z",
    cuvee: "Cuvée Test",
    destination_cellar_name: "Main",
    destination_code: "A1",
    device_name: "Kitchen laptop",
    error_code: null,
    error_message: null,
    format_ml: 750,
    id: "operation-1",
    operation_type: "ADD",
    producer: " Domaine   Test ",
    quantity: 2,
    received_at_server: null,
    remove_reason: null,
    source_cellar_name: null,
    source_code: null,
    status: "PENDING",
    user_id: "user-1",
    vintage: 2020,
    wine_id: "wine-1",
    ...overrides,
  }
}

describe("inventory activity projection", () => {
  it("turns journal rows into user-facing activity", () => {
    const items = buildInventoryActivity([
      activityRow(),
      activityRow({
        destination_cellar_name: "Garage",
        destination_code: "B2",
        id: "operation-2",
        operation_type: "MOVE",
        quantity: 1,
        source_cellar_name: "Main",
        source_code: "A1",
        status: "ACCEPTED",
      }),
      activityRow({
        destination_cellar_name: null,
        destination_code: null,
        error_code: "INSUFFICIENT_STOCK",
        error_message: "Only one bottle remains",
        id: "operation-3",
        operation_type: "REMOVE",
        quantity: 3,
        remove_reason: "DRANK",
        source_cellar_name: "Garage",
        source_code: "B2",
        status: "REJECTED",
      }),
    ])

    expect(items).toMatchObject([
      {
        actionLabel: "Added",
        destinationLabel: "Main / A1",
        quantityLabel: "2 bottles",
        sourceLabel: null,
        statusLabel: "Queued",
        statusTone: "warning",
        wineLabel: "Domaine Test — Cuvée Test",
        wineMeta: "2020 · red · 75 cl",
      },
      {
        actionLabel: "Moved",
        destinationLabel: "Garage / B2",
        quantityLabel: "1 bottle",
        sourceLabel: "Main / A1",
        statusLabel: "Synced",
        statusTone: "success",
      },
      {
        actionLabel: "Removed",
        destinationLabel: null,
        reasonLabel: "Drank",
        sourceLabel: "Garage / B2",
        statusLabel: "Rejected",
        statusTone: "error",
      },
    ])
  })

  it("falls back safely when synchronized wine metadata is incomplete", () => {
    expect(
      buildInventoryActivity([
        activityRow({
          catalog_wine_id: null,
          color: null,
          cuvee: null,
          format_ml: null,
          producer: null,
          vintage: null,
        }),
      ])[0],
    ).toMatchObject({
      wineLabel: "Unknown wine",
      wineMeta: "NV",
    })
  })

  it("filters by operation, status, wine, storage, device, and errors", () => {
    const items = buildInventoryActivity([
      activityRow(),
      activityRow({
        device_name: "Phone",
        destination_cellar_name: "Garage",
        destination_code: "B2",
        id: "operation-2",
        operation_type: "MOVE",
        source_cellar_name: "Main",
        source_code: "A1",
        status: "ACCEPTED",
      }),
      activityRow({
        error_code: "INSUFFICIENT_STOCK",
        error_message: "Not enough bottles",
        id: "operation-3",
        operation_type: "REMOVE",
        status: "REJECTED",
      }),
    ])

    expect(
      filterInventoryActivity(items, {
        operationType: "MOVE",
        search: "garage phone",
        status: "ACCEPTED",
      }).map((item) => item.id),
    ).toEqual(["operation-2"])

    expect(
      filterInventoryActivity(items, {
        operationType: "ALL",
        search: "insufficient",
        status: "ALL",
      }).map((item) => item.id),
    ).toEqual(["operation-3"])
  })

  it("summarizes the visible journal states", () => {
    const items = buildInventoryActivity([
      activityRow(),
      activityRow({ id: "operation-2", status: "ACCEPTED" }),
      activityRow({ id: "operation-3", status: "ACCEPTED" }),
      activityRow({ id: "operation-4", status: "REJECTED" }),
    ])

    expect(summarizeInventoryActivity(items)).toEqual({
      acceptedCount: 2,
      pendingCount: 1,
      rejectedCount: 1,
      totalCount: 4,
    })
  })
})
