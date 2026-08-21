import { describe, expect, it, vi } from "vitest"

import {
  decideWineReferenceMatch,
  getWineReferenceBlockerLabel,
  getWineReferenceReview,
  parseWineReferenceReview,
} from "./wineReferenceMatching"

function candidate(lwin7 = "1000001") {
  return {
    blockers: ["close_runner_up"],
    details: {
      classification: "Premier Cru",
      colour: "Red",
      country: "France",
      designation: "AOP",
      display_name: "Louis Boillot, Volnay, Les Angles",
      final_vintage: 2025,
      first_vintage: 2000,
      lwin7,
      parcel: null,
      producer_name: "Louis Boillot",
      region: "Burgundy",
      site: "Les Angles",
      sub_region: "Volnay",
      wine_name: "Volnay",
    },
    evidence: {
      appellation_score: 1,
      area_score: 1,
      color_compatible: true,
      producer_preferred: false,
      producer_score: 1,
      product_score: 1,
      review_required: true,
      vintage_compatible: true,
    },
    generated_at: "2026-08-20T20:00:00Z",
    lwin7,
    match_strength: "strong",
    rank: 1,
    score: 0.95,
  }
}

function reviewResponse() {
  return {
    candidates: [candidate()],
    matched_reference: null,
    rejected_candidates: [],
    source_fingerprint: "a".repeat(32),
    source_updated_through: "2026-08-20T19:00:00",
    status: "unmatched",
  }
}

describe("wine-reference review parsing", () => {
  it("maps provider-shaped JSON into typed review data", () => {
    expect(parseWineReferenceReview(reviewResponse())).toEqual(
      expect.objectContaining({
        candidates: [
          expect.objectContaining({
            lwin7: "1000001",
            matchStrength: "strong",
          }),
        ],
        sourceFingerprint: "a".repeat(32),
        status: "unmatched",
      }),
    )
  })

  it("rejects inconsistent candidate identifiers and matched states", () => {
    const inconsistentCandidate = reviewResponse()
    inconsistentCandidate.candidates[0].details.lwin7 = "9999999"

    expect(() =>
      parseWineReferenceReview(inconsistentCandidate),
    ).toThrow("inconsistent LWIN7")

    expect(() =>
      parseWineReferenceReview({
        ...reviewResponse(),
        status: "matched",
      }),
    ).toThrow("matched status")
  })
})

describe("wine-reference review RPCs", () => {
  it("requests a fresh review with explicit RPC parameters", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: reviewResponse(),
      error: null,
    })

    await expect(
      getWineReferenceReview("wine-1", true, { rpc }),
    ).resolves.toMatchObject({ status: "unmatched" })

    expect(rpc).toHaveBeenCalledWith(
      "get_wine_reference_review",
      {
        p_refresh: true,
        p_wine_id: "wine-1",
      },
    )
  })

  it("sends confirmation and rejection memory choices explicitly", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: reviewResponse(),
      error: null,
    })

    await decideWineReferenceMatch(
      "wine-1",
      "1000001",
      "confirmed",
      true,
      { rpc },
    )

    expect(rpc).toHaveBeenCalledWith(
      "decide_wine_reference_match",
      {
        p_decision: "confirmed",
        p_lwin7: "1000001",
        p_remember_producer: true,
        p_wine_id: "wine-1",
      },
    )

    await expect(
      decideWineReferenceMatch(
        "wine-1",
        "1000001",
        "rejected",
        true,
        { rpc },
      ),
    ).rejects.toThrow("cannot remember its producer")
  })

  it("surfaces RPC errors without accepting malformed data", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Reference service unavailable" },
    })

    await expect(
      getWineReferenceReview("wine-1", false, { rpc }),
    ).rejects.toThrow("Reference service unavailable")
  })
})

describe("wine-reference review labels", () => {
  it("explains known safety blockers in plain language", () => {
    expect(
      getWineReferenceBlockerLabel("close_runner_up"),
    ).toBe("Another candidate is almost as close")
    expect(
      getWineReferenceBlockerLabel("future_guard"),
    ).toBe("future guard")
  })
})
