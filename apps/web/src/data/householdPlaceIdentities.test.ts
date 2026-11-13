import { describe, expect, it, vi } from "vitest"

import {
  getHouseholdPlaceGroups, manageHouseholdPlaceLink, parsePlaceGroups,
  searchHouseholdPlaces,
} from "./householdPlaceIdentities"

const householdId = "00000000-0000-4000-8000-000000000100"
const response = {
  regions: [{ source_area: "Cote d'Or", wine_count: 8,
    chosen_id: "region-id", resolved_id: "region-id", resolved_name: "Bourgogne" }],
  appellations: [{ source_area: "Cote d'Or", source_appellation: "Volnay 1er Cru",
    wine_count: 3, chosen_id: null, resolved_id: null, resolved_name: null,
    region_id: "region-id", valid: true }],
}

describe("household place identity links", () => {
  it("parses local region and appellation decisions separately", () => {
    expect(parsePlaceGroups(response)).toEqual({
      regions: [{ kind: "region", sourceArea: "Cote d'Or", wineCount: 8,
        chosenId: "region-id", resolvedId: "region-id", resolvedName: "Bourgogne" }],
      appellations: [{ kind: "appellation", sourceArea: "Cote d'Or",
        sourceAppellation: "Volnay 1er Cru", wineCount: 3, chosenId: null,
        resolvedId: null, resolvedName: null, regionId: "region-id", valid: true }],
    })
  })

  it("rejects missing geographic hierarchy status", () => {
    expect(() => parsePlaceGroups({ ...response,
      appellations: [{ ...response.appellations[0], valid: null }] })).toThrow("Invalid place hierarchy")
  })

  it("calls owner-scoped search and uses the current link as an optimistic check", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === "get_household_place_identity_groups" ? response
        : name === "search_household_places" ? [{ id: "region-id", name: "Bourgogne", type: "region" }]
          : { kind: "region", source_area: "cote d or", place_id: "region-id" },
      error: null,
    }))
    const options = { rpc }
    const groups = await getHouseholdPlaceGroups(householdId, options)
    expect(await searchHouseholdPlaces(householdId, "region", "Cote d'Or", "Bourgogne", options))
      .toEqual([{ id: "region-id", name: "Bourgogne", type: "region" }])
    await manageHouseholdPlaceLink(householdId, groups.regions[0], "set", "region-id", options)
    expect(rpc).toHaveBeenCalledWith("manage_household_place_identity_link", expect.objectContaining({
      p_household_id: householdId, p_kind: "region", p_source_area: "Cote d'Or",
      p_expected_place_id: "region-id", p_place_id: "region-id",
    }))
  })
})
