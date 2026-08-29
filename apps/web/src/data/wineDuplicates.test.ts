import { describe, expect, it } from "vitest"

import {
  findWineDuplicateGroups,
  getWineDuplicateDifferences,
  parseWineMergeResult,
  type WineDuplicateCandidate,
} from "./wineDuplicates"

function wine(
  id: string,
  overrides: Partial<WineDuplicateCandidate> = {},
): WineDuplicateCandidate {
  return {
    id,
    household_id: "household-1",
    producer: "Domaine Test",
    cuvee: "Cuvée Test",
    vintage: 2020,
    color: "red",
    appellation: "Morgon",
    area: "Beaujolais",
    format_ml: 750,
    quantity: 1,
    position_count: 1,
    ...overrides,
  }
}

describe("wine duplicate detection", () => {
  it("finds a normalized catalog identity duplicate", () => {
    const groups = findWineDuplicateGroups([
      wine("wine-1"),
      wine("wine-2", {
        producer: " domaine   test ",
        cuvee: "CUVÉE TEST",
        color: "RED",
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].basis).toBe("catalog-identity")
    expect(groups[0].wines.map((item) => item.id)).toEqual([
      "wine-1",
      "wine-2",
    ])
  })

  it("uses a confirmed reference despite different local wording", () => {
    const groups = findWineDuplicateGroups([
      wine("wine-1", {
        wine_reference_id: "reference-1",
        wine_reference_type: "product",
      }),
      wine("wine-2", {
        producer: "Local producer alias",
        cuvee: "Local cuvée alias",
        wine_reference_id: "reference-1",
        wine_reference_type: "product",
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].basis).toBe("confirmed-reference")
  })

  it("keeps vintage, color, and format differences separate", () => {
    const referenced = {
      wine_reference_id: "reference-1",
      wine_reference_type: "product",
    }
    expect(
      findWineDuplicateGroups([
        wine("wine-1", referenced),
        wine("wine-2", { ...referenced, vintage: 2021 }),
        wine("wine-3", { ...referenced, color: "white" }),
        wine("wine-4", { ...referenced, format_ml: 1500 }),
      ]),
    ).toEqual([])
  })

  it("does not suggest rows with conflicting confirmed references", () => {
    expect(
      findWineDuplicateGroups([
        wine("wine-1", {
          wine_reference_id: "reference-1",
          wine_reference_type: "product",
        }),
        wine("wine-2", {
          wine_reference_id: "reference-2",
          wine_reference_type: "product",
        }),
      ]),
    ).toEqual([])
  })

  it("ignores an already merged catalog row", () => {
    expect(
      findWineDuplicateGroups([
        wine("wine-1"),
        wine("wine-2", { merged_into_wine_id: "wine-1" }),
      ]),
    ).toEqual([])
  })

  it("exposes the catalog fields that differ between two entries", () => {
    expect(
      getWineDuplicateDifferences(
        wine("wine-source", { appellation: "Beaujolais" }),
        wine("wine-target", { appellation: "Morgon" }),
      ),
    ).toEqual([
      expect.objectContaining({
        field: "appellation",
        sourceValue: "Beaujolais",
        targetValue: "Morgon",
      }),
    ])
  })
})

describe("wine merge response", () => {
  it("parses the guarded RPC summary", () => {
    expect(
      parseWineMergeResult({
        merge_event_id: "event-1",
        source_wine_id: "wine-2",
        target_wine_id: "wine-1",
        detection_basis: "catalog-identity",
        bottles_transferred: 4,
        positions_transferred: 2,
        positions_combined: 1,
        observations_transferred: 3,
        serving_override_transferred: false,
        serving_override_conflict: true,
        maturity_override_transferred: true,
        maturity_override_conflict: false,
      }),
    ).toMatchObject({
      targetWineId: "wine-1",
      bottlesTransferred: 4,
      servingOverrideConflict: true,
      maturityOverrideTransferred: true,
    })
  })

  it("rejects malformed RPC data", () => {
    expect(() => parseWineMergeResult({})).toThrow(
      "Invalid wine merge response",
    )
  })
})
