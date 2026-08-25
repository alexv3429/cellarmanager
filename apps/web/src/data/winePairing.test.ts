import { describe, expect, it, vi } from "vitest"

import {
  getPairingDishProfiles,
  getPairingSuggestions,
  parsePairingDishProfiles,
  parsePairingResult,
} from "./winePairing"

const attributes = {
  acidity: 4,
  fat: 1,
  fish: 0,
  intensity: 2,
  protein: 0,
  salt: 2,
  spice: 0,
  sweetness: 0,
  umami: 1,
}

it("parses reviewed dishes and personal defaults", () => {
  expect(
    parsePairingDishProfiles([
      {
        attributes,
        confidence: 0.72,
        description: "Acidic light salad",
        key: "salad-vinaigrette",
        name: "Green salad with vinaigrette",
        preference: {
          preferred_colors: ["white", "sparkling"],
          preferred_style: "fresh",
          updated_at: "2026-08-25T10:00:00Z",
        },
      },
    ]),
  ).toEqual([
    expect.objectContaining({
      key: "salad-vinaigrette",
      preference: expect.objectContaining({
        preferredColors: ["white", "sparkling"],
        preferredStyle: "fresh",
      }),
    }),
  ])
})

it("parses in-stock suggestions and their locations", () => {
  const result = parsePairingResult({
    assessed_candidates: 12,
    best_rejected: null,
    dish: {
      attributes,
      key: "salad-vinaigrette",
      name: "Green salad with vinaigrette",
    },
    preferred_colors: ["white"],
    preferred_style: "fresh",
    status: "suggestions",
    stock_wines: 20,
    suggestions: [
      {
        appellation: "Puligny-Montrachet",
        area: "Bourgogne",
        cautions: [],
        color: "white",
        confidence_label: "medium",
        cuvee: "Les Folatières",
        feedback_verdict: null,
        format_ml: 750,
        locations: [
          { cellar: "Service", location: "A2", quantity: 1 },
        ],
        maturity_state: "ready",
        producer: "Domaine Test",
        projection_id: "projection-1",
        quantity: 2,
        reasons: ["Its acidity can stand up to the dish."],
        score_label: "Strong match",
        vintage: 2020,
        wine_id: "wine-1",
      },
    ],
    unavailable_profiles: 8,
  })

  expect(result.suggestions[0]).toEqual(
    expect.objectContaining({
      projectionId: "projection-1",
      quantity: 2,
      locations: [
        { cellar: "Service", location: "A2", quantity: 1 },
      ],
    }),
  )
})

describe("pairing RPC", () => {
  it("waits through a short future-issued JWT timing skew", async () => {
    vi.useFakeTimers()
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "JWT issued at future" },
      })
      .mockResolvedValueOnce({ data: [], error: null })

    try {
      const request = getPairingDishProfiles(
        "household-1",
        { rpc },
      )

      await vi.runAllTimersAsync()

      await expect(request).resolves.toEqual([])
      expect(rpc).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sends bounded dish constraints and parses the response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        assessed_candidates: 0,
        best_rejected: null,
        dish: {
          attributes,
          key: "salad-vinaigrette",
          name: "Green salad with vinaigrette",
        },
        preferred_colors: [],
        preferred_style: null,
        status: "preparing",
        stock_wines: 5,
        suggestions: [],
        unavailable_profiles: 5,
      },
      error: null,
    })

    await expect(
      getPairingSuggestions(
        "household-1",
        "salad-vinaigrette",
        attributes,
        [],
        null,
        { rpc },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ status: "preparing" }),
    )

    expect(rpc).toHaveBeenCalledWith(
      "get_pairing_suggestions",
      expect.objectContaining({
        p_dish_key: "salad-vinaigrette",
        p_limit: 5,
      }),
    )
  })
})

it("rejects malformed server payloads", () => {
  expect(() =>
    parsePairingResult({
      assessed_candidates: 0,
      best_rejected: null,
      dish: { attributes: { ...attributes, acidity: 9 }, key: "x", name: "X" },
      preferred_colors: [],
      preferred_style: null,
      status: "suggestions",
      stock_wines: 0,
      suggestions: [],
      unavailable_profiles: 0,
    }),
  ).toThrow(/dish acidity/u)
})
