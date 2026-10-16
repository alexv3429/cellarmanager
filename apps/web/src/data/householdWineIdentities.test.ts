import { describe, expect, it, vi } from "vitest"

import {
  getHouseholdWineIdentityStatus,
  manageHouseholdWineIdentity,
  parseSharedWineIdentities,
  requestSharedWineIdentity,
  searchHouseholdWineIdentities,
} from "./householdWineIdentities"

const release = {
  reference_id: "release-2023",
  reference_type: "release",
  producer_name: "Daniel Barraud",
  product_name: "Sur La Roche",
  vintage_year: 2023,
  release_designator: null,
}

describe("household wine identity review", () => {
  it("reads the owner-only status without relying on Liv-ex candidates", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      wine_id: "wine", source_fingerprint: "fingerprint", matched_reference: null,
      request_status: "pending",
    }, error: null })
    expect(await getHouseholdWineIdentityStatus("wine", { rpc })).toEqual({
      wineId: "wine", sourceFingerprint: "fingerprint", matchedReference: null,
      requestStatus: "pending",
    })
    expect(rpc).toHaveBeenCalledWith("get_household_wine_identity_status", { p_wine_id: "wine" })
  })
  it("parses exact-vintage shared identities", () => {
    expect(parseSharedWineIdentities([release])).toEqual([{
      referenceId: "release-2023", referenceType: "release",
      producerName: "Daniel Barraud", productName: "Sur La Roche",
      vintageYear: 2023, releaseDesignator: null,
    }])
    expect(() => parseSharedWineIdentities([{ ...release, vintage_year: 2022, reference_type: "product" }])).toThrow()
  })

  it("searches only after a bounded query", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [release], error: null })
    expect(await searchHouseholdWineIdentities("wine", " Barraud ", { rpc })).toHaveLength(1)
    expect(rpc).toHaveBeenCalledWith("search_household_wine_references", {
      p_wine_id: "wine", p_query: "Barraud",
    })
    await expect(searchHouseholdWineIdentities("wine", "x", { rpc })).rejects.toThrow("2 to 100")
  })

  it("sends the observed source and current link for a guarded decision", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { wine_id: "wine", reference_id: "release-2023", reference_type: "release", source_fingerprint: "fingerprint" },
      error: null,
    })
    const [identity] = parseSharedWineIdentities([release])
    expect(await manageHouseholdWineIdentity("wine", "link", identity, "fingerprint", null, { rpc })).toBe("release-2023")
    expect(rpc).toHaveBeenCalledWith("manage_household_wine_identity", {
      p_wine_id: "wine", p_action: "link", p_reference_id: "release-2023",
      p_expected_fingerprint: "fingerprint", p_expected_reference_id: null,
    })
  })

  it("checks the result of a private missing-identity request", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { wine_id: "wine", request_id: "request" }, error: null,
    })
    expect(await requestSharedWineIdentity("wine", "fingerprint", { rpc })).toBe("request")
    expect(rpc).toHaveBeenCalledWith("request_household_wine_identity", {
      p_wine_id: "wine", p_expected_fingerprint: "fingerprint",
    })
  })
})
