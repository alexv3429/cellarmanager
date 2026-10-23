import { describe, expect, it, vi } from "vitest"

import {
  clearMemberMaturityCalibration,
  getMemberMaturityCalibration,
  getHouseholdMaturityOverview,
  maturityAssessmentReasonLabel,
  maturityAssessmentReasonMessage,
  parseWineMaturity,
  reviewWineMaturity,
  setMemberMaturityCalibration,
  setWineMaturityOverride,
  supportsThreeMilestoneManualOverrides,
} from "./wineMaturity"

function maturityResponse() {
  return {
    assessment_reason: null,
    calibration: null,
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
            profile_id: "profile-region",
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
  it("keeps legacy drink-by dates but accepts a three-milestone manual window", () => {
    const oldWindow = {
      ...maturityResponse(),
      override: {
        first_trial_year: 2028,
        best_start_year: 2030,
        best_end_year: 2034,
        drink_by_year: 2040,
        storage_purpose: null,
        note: null,
        updated_at: "2026-10-23T10:00:00Z",
      },
    }

    expect(parseWineMaturity(oldWindow).override?.drinkByYear).toBe(2040)
    expect(parseWineMaturity({
      ...oldWindow,
      override: { ...oldWindow.override, drink_by_year: null },
    }).override?.drinkByYear).toBeNull()
  })

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
        profileId: "profile-region",
        rationale: "Reviewed regional baseline.",
      },
      {
        label: "Terrasses du Larzac",
        layer: "appellation",
        profileId: null,
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

  it("keeps a published three-date reference separate from the model", () => {
    const result = parseWineMaturity({
      ...maturityResponse(),
      effective_source: "reviewed_reference",
      reference: {
        status: "match", version_number: 3,
        reference_row_id: "reference-1", matched_scope: "region",
        first_trial_year: 2024, best_start_year: 2026,
        best_end_year: 2032, rationale: "Reviewed regional evidence.",
      },
    })
    expect(result.effectiveSource).toBe("reviewed_reference")
    expect(result.reference).toMatchObject({
      firstTrialYear: 2024, bestStartYear: 2026,
      bestEndYear: 2032, versionNumber: 3,
    })
    expect(result.projection?.maturity.bestEndYear).toBe(2031)
  })

  it("keeps v1/v2 recommendations compatible when no hierarchy trace exists", () => {
    const response = maturityResponse()
    Reflect.deleteProperty(response.projection.maturity, "contributions")

    expect(
      parseWineMaturity(response).projection?.maturity.contributions,
    ).toEqual([])
  })

  it("keeps canonical and private calibrated guidance separate", () => {
    const response = maturityResponse()
    const result = parseWineMaturity({
      ...response,
      calibration: {
        active: true,
        maturity: {
          ...response.projection.maturity,
          best_end_year: 2029,
          best_start_year: 2023,
          drink_by_year: 2035,
          first_trial_year: 2020,
          headline: "Your timing: Likely ready",
          message: "Your private timing preference places this wine inside its likely best period.",
        },
        updated_at: "2026-08-31T12:00:00Z",
        year_shift: -2,
      },
    })

    expect(result.projection?.maturity.firstTrialYear).toBe(2022)
    expect(result.calibration).toMatchObject({
      active: true,
      maturity: {
        drinkByYear: 2035,
        firstTrialYear: 2020,
      },
      yearShift: -2,
    })
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

  it("saves, reads, and resets the private account calibration", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          updated_at: "2026-08-31T12:00:00Z",
          year_shift: -2,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          updated_at: "2026-08-31T12:00:00Z",
          year_shift: -2,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null })

    await expect(
      setMemberMaturityCalibration(-2, { rpc }),
    ).resolves.toMatchObject({ yearShift: -2 })
    await expect(
      getMemberMaturityCalibration({ rpc }),
    ).resolves.toMatchObject({ yearShift: -2 })
    await expect(
      clearMemberMaturityCalibration({ rpc }),
    ).resolves.toBeNull()

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "set_member_maturity_calibration",
      { p_year_shift: -2 },
    )
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "get_member_maturity_calibration",
      {},
    )
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "clear_member_maturity_calibration",
      {},
    )
  })

  it("rejects an out-of-range personal calibration before calling the server", async () => {
    const rpc = vi.fn()

    await expect(
      setMemberMaturityCalibration(4, { rpc }),
    ).rejects.toThrow("between 3 years younger and 3 years later")
    expect(rpc).not.toHaveBeenCalled()
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

  it("sends a three-milestone manual window without inventing a drink-by date", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...maturityResponse(),
        override: {
          first_trial_year: 2028,
          best_start_year: 2030,
          best_end_year: 2034,
          drink_by_year: null,
          storage_purpose: null,
          note: null,
          updated_at: "2026-10-23T10:00:00Z",
        },
      },
      error: null,
    })

    await expect(setWineMaturityOverride(
      "wine-1",
      { firstTrialYear: 2028, bestStartYear: 2030, bestEndYear: 2034, drinkByYear: null },
      null,
      "",
      { rpc },
    )).resolves.toMatchObject({ override: { drinkByYear: null } })

    expect(rpc).toHaveBeenCalledWith("set_wine_maturity_override", {
      p_best_end_year: 2034,
      p_best_start_year: 2030,
      p_drink_by_year: null,
      p_first_trial_year: 2028,
      p_note: null,
      p_storage_purpose: null,
      p_wine_id: "wine-1",
    })
  })

  it("keeps the old editor until the database confirms three-date support", async () => {
    const missingRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Function not found" } })
    const supportedRpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const failedRpc = vi.fn().mockRejectedValue(new Error("Network unavailable"))

    await expect(supportsThreeMilestoneManualOverrides({ rpc: missingRpc })).resolves.toBe(false)
    await expect(supportsThreeMilestoneManualOverrides({ rpc: failedRpc })).resolves.toBe(false)
    await expect(supportsThreeMilestoneManualOverrides({ rpc: supportedRpc })).resolves.toBe(true)
    expect(supportedRpc).toHaveBeenCalledWith("supports_three_milestone_manual_overrides", {})
  })
})
