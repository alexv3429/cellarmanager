import { describe, expect, it, vi } from "vitest"

import {
  getWinePersonalGuidance,
  parseWinePersonalGuidance,
  saveWineObservation,
  saveWineServingOverride,
} from "./winePersonalGuidance"

const RESPONSE = {
  observations: [
    {
      created_at: "2026-08-26T08:00:00Z",
      id: "observation-1",
      is_author: true,
      maturity_assessment: "too-young",
      note: "Still closed after two hours.",
      observation_type: "tasting",
      observed_on: "2026-08-25",
      pairing_dish: null,
      pairing_verdict: null,
      ratings: {
        acidity: 4,
        body: 3,
        freshness: 5,
        tannin: 4,
      },
      updated_at: "2026-08-26T08:00:00Z",
      visibility: "household",
    },
  ],
  serving: {
    assessment_reason: null,
    demand_status: "complete",
    model: {
      aeration_max_minutes: 120,
      aeration_min_minutes: 60,
      calculated_at: "2026-08-25T20:00:00Z",
      confidence: 0.78,
      confidence_label: "high",
      method: "decant",
      reasons: ["Firm tannin and concentration benefit from air."],
      specificity: "producer-cuvee",
      temperature_max_c: 17,
      temperature_min_c: 15,
      warnings: [],
    },
    override: null,
  },
  wine_id: "wine-1",
}

describe("wine personal guidance", () => {
  it("parses serving advice and attributed household observations", () => {
    expect(parseWinePersonalGuidance(RESPONSE)).toMatchObject({
      observations: [
        {
          isAuthor: true,
          maturityAssessment: "too-young",
          ratings: { freshness: 5 },
          type: "tasting",
        },
      ],
      serving: {
        model: {
          aerationMaxMinutes: 120,
          method: "decant",
          temperatureMinC: 15,
        },
      },
      wineId: "wine-1",
    })
  })

  it("rejects unsupported serving methods", () => {
    expect(() =>
      parseWinePersonalGuidance({
        ...RESPONSE,
        serving: {
          ...RESPONSE.serving,
          model: { ...RESPONSE.serving.model, method: "shake" },
        },
      }),
    ).toThrow("serving method")
  })

  it("uses the narrow read RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: RESPONSE, error: null })
    await expect(getWinePersonalGuidance("wine-1", { rpc })).resolves.toMatchObject({
      wineId: "wine-1",
    })
    expect(rpc).toHaveBeenCalledWith("get_wine_personal_guidance", {
      p_wine_id: "wine-1",
    })
  })

  it("waits through a short future-issued JWT timing skew", async () => {
    vi.useFakeTimers()
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "JWT issued at future" },
      })
      .mockResolvedValueOnce({ data: RESPONSE, error: null })

    try {
      const request = getWinePersonalGuidance("wine-1", { rpc })
      await vi.runAllTimersAsync()
      await expect(request).resolves.toMatchObject({ wineId: "wine-1" })
      expect(rpc).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sends explicit observation fields without direct table writes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: RESPONSE, error: null })
    await saveWineObservation(
      {
        maturityAssessment: "ready",
        note: "Producer suggested trying it now.",
        observedOn: "2026-08-25",
        pairingDish: null,
        pairingVerdict: null,
        ratings: {
          acidity: null,
          body: null,
          freshness: null,
          tannin: null,
        },
        type: "producer-guidance",
        visibility: "household",
        wineId: "wine-1",
      },
      { rpc },
    )
    expect(rpc).toHaveBeenCalledWith(
      "save_wine_observation",
      expect.objectContaining({
        p_maturity_assessment: "ready",
        p_observation_id: null,
        p_observation_type: "producer-guidance",
        p_wine_id: "wine-1",
      }),
    )
  })

  it("sends a complete serving override", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: RESPONSE, error: null })
    await saveWineServingOverride(
      {
        aerationMaxMinutes: 45,
        aerationMinMinutes: 30,
        method: "open-ahead",
        note: "Taste before extending.",
        temperatureMaxC: 16,
        temperatureMinC: 14,
        wineId: "wine-1",
      },
      { rpc },
    )
    expect(rpc).toHaveBeenCalledWith("set_wine_serving_override", {
      p_aeration_max_minutes: 45,
      p_aeration_min_minutes: 30,
      p_method: "open-ahead",
      p_note: "Taste before extending.",
      p_temperature_max_c: 16,
      p_temperature_min_c: 14,
      p_wine_id: "wine-1",
    })
  })
})
