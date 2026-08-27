import { describe, expect, it } from "vitest"

import type { WineFacts } from "./wineFacts"
import type { MaturityOverviewItem } from "./wineMaturity"
import {
  buildCatalogCurationQueue,
  getCatalogFactCoverage,
  getCatalogProfileCoverage,
} from "./catalogCoverage"

function facts(overrides: Partial<WineFacts> = {}): WineFacts {
  return {
    alcoholPercent: null,
    certifications: [],
    classification: null,
    country: null,
    grapeComposition: [],
    region: "Bourgogne",
    sweetnessCategory: null,
    vineyard: null,
    ...overrides,
  }
}

function maturity(
  overrides: Partial<MaturityOverviewItem> = {},
): MaturityOverviewItem {
  return {
    assessmentReason: null,
    bestEndYear: 2032,
    bestStartYear: 2028,
    calculatedAt: "2026-08-27T10:00:00Z",
    confidence: 0.7,
    confidenceLabel: "medium",
    demandStatus: "complete",
    drinkByYear: 2038,
    feedbackVerdict: null,
    firstTrialYear: 2026,
    headline: "Start assessing",
    isOverride: false,
    moveMessage: null,
    moveNeeded: false,
    profileLayers: ["region", "vintage"],
    profileWarnings: [],
    projectionId: "projection-1",
    specificity: "place",
    state: "assess",
    stateLabel: "Start assessing",
    storagePurpose: "aging",
    urgency: "watch",
    urgencyScore: 35,
    wineId: "wine-1",
    ...overrides,
  }
}

describe("catalog knowledge coverage", () => {
  it("uses only country, grapes, and sweetness as useful core facts", () => {
    expect(
      getCatalogFactCoverage(
        facts({ alcoholPercent: 13.5, classification: "Premier Cru" }),
      ),
    ).toEqual({
      missingCoreFacts: ["country", "grapes", "sweetness"],
      presentCoreFactCount: 0,
      status: "missing",
    })

    expect(
      getCatalogFactCoverage(
        facts({
          country: "France",
          grapeComposition: [{ name: "Chardonnay", percentage: null }],
          sweetnessCategory: "bone-dry",
        }),
      ).status,
    ).toBe("complete")
  })

  it("reports exact missing profile layers instead of guessing from confidence", () => {
    expect(getCatalogProfileCoverage(maturity())).toEqual({
      missingLayers: ["producer", "cuvee"],
      status: "needs-refinement",
    })

    expect(
      getCatalogProfileCoverage(
        maturity({
          confidence: 0.4,
          profileLayers: ["region", "vintage", "producer-era", "cuvee"],
        }),
      ).status,
    ).toBe("full")
  })

  it("keeps cellar data issues separate from shared-library work", () => {
    const wine = {
      alcoholPercent: null,
      appellation: "Gevrey-Chambertin",
      area: "Bourgogne",
      color: "red",
      cuvee: "Les Evocelles",
      facts: facts(),
      id: "wine-1",
      producer: "Louis Boillot",
      quantity: 6,
      vintage: null,
    }
    const queue = buildCatalogCurationQueue(
      [wine],
      new Map([
        [
          wine.id,
          maturity({
            assessmentReason: "missing-vintage",
            profileLayers: [],
            state: null,
          }),
        ],
      ]),
    )

    expect(queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "wine-data",
          gap: "wine-missing-vintage",
          wineIds: ["wine-1"],
        }),
        expect.objectContaining({
          category: "household-fact",
          gap: "fact-grapes",
        }),
      ]),
    )
    expect(queue.some((item) => item.gap === "profile-vintage")).toBe(false)
  })

  it("groups shared gaps and prioritizes the bottles they affect", () => {
    const baseWine = {
      alcoholPercent: 13,
      appellation: "Volnay Premier Cru",
      area: "Bourgogne",
      color: "red",
      cuvee: "Les Angles",
      facts: facts({
        alcoholPercent: 13,
        country: "France",
        grapeComposition: [{ name: "Pinot Noir", percentage: null }],
        sweetnessCategory: "bone-dry",
      }),
      producer: "Domaine Test",
      vintage: 2020,
    }
    const wines = [
      { ...baseWine, id: "wine-1", quantity: 5 },
      { ...baseWine, id: "wine-2", quantity: 3 },
      {
        ...baseWine,
        appellation: "Unknown AOP",
        cuvee: "Other",
        id: "wine-3",
        quantity: 1,
      },
    ]
    const overview = new Map([
      ["wine-1", maturity({ wineId: "wine-1" })],
      ["wine-2", maturity({ wineId: "wine-2" })],
      [
        "wine-3",
        maturity({
          assessmentReason: "unsupported-place-profile",
          profileLayers: [],
          state: null,
          wineId: "wine-3",
        }),
      ],
    ])

    const queue = buildCatalogCurationQueue(wines, overview)
    const producer = queue.find((item) => item.gap === "profile-producer")

    expect(producer).toMatchObject({ bottleCount: 8, wineCount: 2 })
    expect(queue[0]).toMatchObject({
      bottleCount: 8,
      category: "shared-profile",
    })
    expect(queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gap: "profile-place",
          title: "Add place profile: Unknown AOP · red",
        }),
      ]),
    )
  })
})
