import { describe, expect, it, vi } from "vitest"

import {
  applyHouseholdExactCuveeLinks, getHouseholdCuveeGroups, manageHouseholdCuveeLink,
  parseCuveeGroups, parseExactCuveePlan, previewHouseholdExactCuveeLinks,
  searchHouseholdCuveeProducts,
} from "./householdCuveeIdentities"

const householdId = "00000000-0000-4000-8000-000000000100"
const group = {
  source_producer: "Boillot", source_cuvee: "Caillerets",
  source_appellation: "Volnay", source_color: "rouge", wine_count: 3,
  first_seen_vintage: 2021, last_seen_vintage: 2023,
  producer_id: "producer-id", producer_name: "Domaine Louis Boillot et Fils",
  links: [{ first_vintage: 1800, last_vintage: 2200,
    product_id: "product-id", product_name: "Volnay 1er cru Les Caillerets", active: true }],
}

describe("household cuvée identity links", () => {
  it("parses one durable group link across vintages", () => {
    expect(parseCuveeGroups([group])[0]).toMatchObject({
      sourceProducer: "Boillot", sourceCuvee: "Caillerets", wineCount: 3,
      links: [{ firstVintage: 1800, lastVintage: 2200, productId: "product-id" }],
    })
  })

  it("rejects an impossible rename range", () => {
    expect(() => parseCuveeGroups([{ ...group, links: [{ ...group.links[0], first_vintage: 2024, last_vintage: 2023 }] }]))
      .toThrow("Invalid cuvée range")
  })

  it("uses owner-scoped RPCs and optimistic link confirmation", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "get_household_cuvee_identity_groups" ? [group]
      : name === "search_household_cuvee_products" ? [{ id: "product-id", name: "Volnay 1er cru Les Caillerets" }]
        : { source_cuvee: "Caillerets", first_vintage: 1800, product_id: "product-id" }, error: null }))
    const options = { rpc }
    const [parsed] = await getHouseholdCuveeGroups(householdId, options)
    expect(await searchHouseholdCuveeProducts(householdId, "Boillot", "Caillerets", options))
      .toEqual([{ id: "product-id", name: "Volnay 1er cru Les Caillerets" }])
    await manageHouseholdCuveeLink(householdId, parsed, "set", 1800, 2200, "product-id", null, options)
    expect(rpc).toHaveBeenCalledWith("manage_household_cuvee_identity_link", expect.objectContaining({
      p_household_id: householdId, p_source_producer: "Boillot", p_source_cuvee: "Caillerets",
      p_first_vintage: 1800, p_last_vintage: 2200, p_expected_product_id: null,
    }))
  })

  it("previews and applies only a current exact-name plan", async () => {
    const plan = {
      household_id: householdId, plan_sha256: "a".repeat(64),
      candidate_groups: 1, wine_count: 2,
      candidates: [{ source_producer: "Boillot", source_cuvee: "Les Caillerets",
        source_appellation: "Volnay", source_color: "rouge",
        first_vintage: 2022, last_vintage: 2023,
        product_id: "product-id", product_name: "Les Caillerets", wine_count: 2 }],
    }
    const rpc = vi.fn(async (name: string) => ({ data: name === "preview_household_exact_cuvee_links"
      ? plan : { household_id: householdId, linked_groups: 1, published: false, dates_approved: false },
    error: null }))
    expect(await previewHouseholdExactCuveeLinks(householdId, { rpc })).toMatchObject({
      candidateGroups: 1, wineCount: 2, candidates: [{ sourceCuvee: "Les Caillerets" }],
    })
    expect(await applyHouseholdExactCuveeLinks(householdId, plan.plan_sha256, { rpc })).toBe(1)
    expect(rpc).toHaveBeenCalledWith("apply_household_exact_cuvee_links", {
      p_household_id: householdId, p_expected_plan_sha256: plan.plan_sha256,
      p_confirmed: true,
    })
    expect(() => parseExactCuveePlan({ ...plan, candidate_groups: 2 }))
      .toThrow("Invalid exact cuvée totals")
  })
})
