import { describe, expect, it, vi } from "vitest"

import {
  getHouseholdProducerSources,
  manageHouseholdProducerPreference,
  parseProducerReferences,
  parseProducerSources,
  searchHouseholdReferenceProducers,
} from "./householdProducerPreferences"

const source = {
  sourceText: "Barthod", normalized: "barthod", wineCount: 3,
  producerId: null, canonicalName: null,
}
const wire = {
  household_id: "household",
  sources: [{ source_text: "Barthod", normalized: "barthod", wine_count: 3, producer_id: null, canonical_name: null }],
}

describe("household producer preferences", () => {
  it("verifies household identity and source rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: wire, error: null })
    expect(await getHouseholdProducerSources("household", { rpc })).toEqual([source])
    expect(rpc).toHaveBeenCalledWith("get_household_producer_preference_review", { p_household_id: "household" })
    expect(() => parseProducerSources({ ...wire, household_id: "other" }, "household")).toThrow()
    expect(() => parseProducerSources({ ...wire, sources: [wire.sources[0], wire.sources[0]] }, "household")).toThrow()
    expect(() => parseProducerSources({ ...wire, sources: [{ ...wire.sources[0], canonical_name: "Ghislaine Barthod" }] }, "household")).toThrow()
  })

  it("searches existing shared identities but rejects blank searches", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "producer", canonical_name: "Ghislaine Barthod" }], error: null })
    expect(await searchHouseholdReferenceProducers("household", " Barthod ", { rpc })).toEqual([{ id: "producer", canonicalName: "Ghislaine Barthod" }])
    expect(rpc).toHaveBeenCalledWith("search_household_reference_producers", { p_household_id: "household", p_query: "Barthod" })
    await expect(searchHouseholdReferenceProducers("household", " ", { rpc })).rejects.toThrow()
    expect(() => parseProducerReferences({ id: "producer" })).toThrow()
  })

  it("submits an explicit local choice with optimistic concurrency", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { source_text: "Barthod", producer_id: "producer" }, error: null })
    await manageHouseholdProducerPreference("household", source, "set", "producer", { rpc })
    expect(rpc).toHaveBeenCalledWith("manage_household_producer_preference", {
      p_household_id: "household", p_source_text: "Barthod", p_action: "set",
      p_producer_id: "producer", p_expected_producer_id: null,
    })
    rpc.mockResolvedValue({ data: { source_text: "Barthod", producer_id: "wrong" }, error: null })
    await expect(manageHouseholdProducerPreference("household", source, "set", "producer", { rpc })).rejects.toThrow("could not be confirmed")
    rpc.mockResolvedValue({ error: { message: "Producer preference changed; refresh before saving" } })
    await expect(manageHouseholdProducerPreference("household", source, "set", "producer", { rpc })).rejects.toThrow("refresh before saving")
  })
})
