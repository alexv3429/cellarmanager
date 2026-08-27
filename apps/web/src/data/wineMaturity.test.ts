import { describe, expect, it, vi } from "vitest"

import {
  getHouseholdMaturityOverview,
  maturityAssessmentReasonLabel,
  maturityAssessmentReasonMessage,
  parseWineMaturity,
  reviewWineMaturity,
  setWineMaturityOverride,
} from "./wineMaturity"

function maturityResponse() {
  return {
    assessment_reason: null,
    demand_status: "completed",
    feedback: null,
    override: null,
    projection: {
      calculated_at: "2026-08-21T10:00:00Z",
      confidence: 0.42,
      id: "projection-1",
      maturity: {
        as_of_year: 2026,
        best_end_year: 2031,
        best_start_year: 2025,
        confidence_label: "low",
        contributions: [
          {
            adjustment: {
              best_end: 0,
              best_start: 0,
              drink_by: 0,
              first: 0,
            },
            label: "Languedoc red",
            layer: "region",
            rationale: "Reviewed regional baseline.",
          },
          {
            adjustment: {
              best_end: 2,
              best_start: 1,
              drink_by: 3,
              first: 2,
            },
            label: "Terrasses du Larzac",
            layer: "appellation",
            rationale: "Reviewed appellation adjustment.",
          },
        ],
        drink_by_year: 2037,
        first_trial_year: 2022,
        headline: "Likely ready",
        message: "This wine is inside its likely best period.",
        reasons: ["Reviewed Pic Saint-Loup baseline."],
        state: "ready",
        state_label: "Likely ready",
        urgency: "ready",
        urgency_score: 55,
        warnings: ["No reviewed producer-era profile was available."],
      },
      method: "curated-inference",
      specificity: "comparable-profile",
      storage: {
        current: {
          aging_bottles: 5,
          service_bottles: 0,
          total_bottles: 5,
        },
        message: "Move 1 bottle to service storage.",
        move: {
          message: "Move 1 bottle to service storage.",
          needed: true,
          possible: true,
          quantity: 1,
          to_purpose: "service",
        },
        purpose: "split-service-and-aging",
        schema_version: 1,
      },
      valid_until: "2027-01-01T00:00:00Z",
    },
    wine_id: "wine-1",
  }
}

describe("maturity RPC boundary", () => {
  it("parses explainable maturity and storage advice", () => {
    const result = parseWineMaturity(maturityResponse())

    expect(result.projection?.maturity).toMatchObject({
      bestEndYear: 2031,
      bestStartYear: 2025,
      drinkByYear: 2037,
      firstTrialYear: 2022,
      state: "ready",
    })
    expect(result.projection?.maturity.contributions).toEqual([
      {
        label: "Languedoc red",
        layer: "region",
        rationale: "Reviewed regional baseline.",
      },
      {
        label: "Terrasses du Larzac",
        layer: "appellation",
        rationale: "Reviewed appellation adjustment.",
      },
    ])
    expect(result.projection?.storage?.move).toEqual({
      message: "Move 1 bottle to service storage.",
      needed: true,
      possible: true,
      quantity: 1,
      toPurpose: "service",
    })
  })

  it("keeps v1/v2 recommendations compatible when no hierarchy trace exists", () => {
    const response = maturityResponse()
    Reflect.deleteProperty(response.projection.maturity, "contributions")

    expect(
      parseWineMaturity(response).projection?.maturity.contributions,
    ).toEqual([])
  })

  it("loads the compact household overview", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          assessment_reason: null,
          best_end_year: 2031,
          best_start_year: 2025,
          calculated_at: "2026-08-21T10:00:00Z",
          confidence: 0.42,
          confidence_label: "low",
          demand_status: "completed",
          drink_by_year: 2037,
          feedback_verdict: null,
          first_trial_year: 2022,
          headline: "Likely ready",
          is_override: false,
          move_message: "Move 1 bottle to service storage.",
          move_needed: true,
          profile_layers: ["region", "vintage", "producer-era"],
          profile_warnings: ["No confirmed cuvee or climat profile was used."],
          projection_id: "projection-1",
          specificity: "producer-era",
          state: "ready",
          state_label: "Likely ready",
          storage_purpose: "split-service-and-aging",
          urgency: "ready",
          urgency_score: 55,
          wine_id: "wine-1",
        },
      ],
      error: null,
    })

    await expect(
      getHouseholdMaturityOverview("household-1", { rpc }),
    ).resolves.toMatchObject([
      {
        moveNeeded: true,
        profileLayers: ["region", "vintage", "producer-era"],
        specificity: "producer-era",
        state: "ready",
        wineId: "wine-1",
      },
    ])
    expect(rpc).toHaveBeenCalledWith(
      "get_household_maturity_overview",
      { p_household_id: "household-1" },
    )
  })

  it("keeps a precise explanation when a range was not calculated", () => {
    const result = parseWineMaturity({
      assessment_reason: "appellation-color-conflict",
      demand_status: "needs-review",
      feedback: null,
      override: null,
      projection: null,
      wine_id: "wine-2",
    })

    expect(result.assessmentReason).toBe("appellation-color-conflict")
    expect(
      maturityAssessmentReasonLabel(result.assessmentReason!),
    ).toBe("Check appellation or color")
    expect(
      maturityAssessmentReasonMessage(result.assessmentReason!),
    ).toContain("stored color")
  })

  it("sends projection feedback without changing the wine", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...maturityResponse(),
        feedback: {
          note: null,
          updated_at: "2026-08-21T10:05:00Z",
          verdict: "useful",
        },
      },
      error: null,
    })

    await expect(
      reviewWineMaturity("projection-1", "useful", "", { rpc }),
    ).resolves.toMatchObject({
      feedback: { verdict: "useful" },
    })
    expect(rpc).toHaveBeenCalledWith(
      "review_wine_maturity_projection",
      {
        p_note: null,
        p_projection_id: "projection-1",
        p_verdict: "useful",
      },
    )
  })

  it("rejects an impossible manual window before calling the server", async () => {
    const rpc = vi.fn()

    await expect(
      setWineMaturityOverride(
        "wine-1",
        {
          bestEndYear: 2035,
          bestStartYear: 2030,
          drinkByYear: 2034,
          firstTrialYear: 2028,
        },
        "aging",
        "",
        { rpc },
      ),
    ).rejects.toThrow("chronological order")
    expect(rpc).not.toHaveBeenCalled()
  })
})
