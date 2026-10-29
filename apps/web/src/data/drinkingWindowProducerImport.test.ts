import { describe, expect, it, vi } from "vitest"

import {
  previewProducerResearchPackage,
  submitProducerResearchPackage,
} from "./drinkingWindowProducerImport"

function pack() {
  const url = "https://example.org/producers/example/2022"
  return {
    format: "cellarmanager.producer_research",
    schema_version: "1.1.0",
    dataset_version: "1.0.0",
    status: "draft_for_curator_review",
    scope: "producer_independent_of_any_household",
    import_policy: {
      review_required: true,
      no_direct_production_publication: true,
      no_direct_household_inventory_write: true,
    },
    producer: { name: "Example Domaine", source_ids: ["estate"] },
    sources: [{ id: "estate", url, reuse: { store_raw_content: false, pointer_candidate_only: true } }],
    cuvees: [{ id: "parcel_a", name: "Parcel A", appellation: "Example AOC", region: "Example Region",
      color: "red", source_ids: ["estate"] }],
    exact_release_calibrations: [{
      cuvee_id: "parcel_a", vintage: 2022, format_ml: 750,
      release_existence: { status: "confirmed_by_named_vintage_source", source_ids: ["estate"], source_urls: [url] },
      proposal: {
        first_trial_year: 2025, best_start_year: 2028, best_end_year: 2035,
        rationale: "A curator estimate requiring separate review.", confidence: "low",
        date_origin: "curator_model_estimate_not_source_fact", review_status: "candidate_not_approved",
        supporting_source_ids: ["estate"], supporting_source_urls: [url],
      },
    }],
  }
}

describe("producer profile intake", () => {
  it("produces only compact, unapproved exact-release candidates", () => {
    const result = previewProducerResearchPackage(pack())
    expect(result.producer).toBe("Example Domaine")
    expect(result.candidates).toEqual([expect.objectContaining({
      cuvee_id: "parcel_a", vintage: 2022, format_ml: 750,
      first_trial_year: 2025, best_start_year: 2028, best_end_year: 2035,
      evidence_urls: ["https://example.org/producers/example/2022"],
      review_status: "candidate_not_approved",
    })])
    expect(JSON.stringify(result)).not.toContain("no_direct_household_inventory_write")
  })

  it("rejects an attempt to treat a researched estimate as approved", () => {
    const data = pack()
    data.exact_release_calibrations[0].proposal.review_status = "approved"
    expect(() => previewProducerResearchPackage(data)).toThrow(/Already-approved proposal/)
  })

  it("rejects dates, source links and release identity mismatches", () => {
    const dates = pack()
    dates.exact_release_calibrations[0].proposal.best_start_year = 2024
    expect(() => previewProducerResearchPackage(dates)).toThrow(/Unordered dates/)
    const links = pack()
    links.exact_release_calibrations[0].proposal.supporting_source_urls = ["https://example.org/other"]
    expect(() => previewProducerResearchPackage(links)).toThrow(/Source URL mismatch/)
    const release = pack()
    release.exact_release_calibrations[0].release_existence.status = "inferred"
    expect(() => previewProducerResearchPackage(release)).toThrow(/Unconfirmed release/)
  })

  it("submits review-only candidates through the curator RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { inserted: 1, published: false }, error: null })
    const result = await submitProducerResearchPackage(JSON.stringify(pack()), { rpc })
    expect(result.response).toEqual({ inserted: 1, published: false })
    expect(rpc).toHaveBeenCalledWith("submit_drinking_window_producer_profile", expect.objectContaining({
      p_package_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_producer_name: "Example Domaine",
      p_candidates: [expect.objectContaining({ review_status: "candidate_not_approved" })],
    }))
  })
})
