import { describe, expect, it, vi } from "vitest"

import {
  getWineFactSuggestions,
  parseWineFactSuggestions,
  parseWineFacts,
  prepareWineFacts,
  sweetnessLabel,
  updateWineFacts,
} from "./wineFacts"

describe("wine facts", () => {
  it("parses JSON values synchronized through SQLite", () => {
    expect(
      parseWineFacts({
        country: "France",
        area: "Burgundy",
        classification: "Premier Cru",
        vineyard: "Les Evocelles",
        grape_composition:
          '[{"name":"Pinot Noir","percentage":100}]',
        sweetness_category: "dry",
        alcohol_percent: "13.5",
        certifications: '["Organic","HVE"]',
      }),
    ).toEqual({
      country: "France",
      region: "Burgundy",
      classification: "Premier Cru",
      vineyard: "Les Evocelles",
      grapeComposition: [
        { name: "Pinot Noir", percentage: 100 },
      ],
      sweetnessCategory: "dry",
      alcoholPercent: 13.5,
      certifications: ["Organic", "HVE"],
    })
  })

  it("normalizes drafts, decimal commas, and repeated certifications", () => {
    expect(
      prepareWineFacts({
        country: "  France ",
        region: " Bourgogne ",
        classification: " Premier   Cru ",
        vineyard: " Les Evocelles ",
        grapeComposition: [
          { name: " Pinot Noir ", percentage: "60" },
          { name: "Chardonnay", percentage: "40,0" },
          { name: "", percentage: "" },
        ],
        sweetnessCategory: "dry",
        alcoholPercent: "13,5",
        certifications: "Organic, HVE; organic\nDemeter",
      }),
    ).toEqual({
      country: "France",
      region: "Bourgogne",
      classification: "Premier Cru",
      vineyard: "Les Evocelles",
      grapeComposition: [
        { name: "Pinot Noir", percentage: 60 },
        { name: "Chardonnay", percentage: 40 },
      ],
      sweetnessCategory: "dry",
      alcoholPercent: 13.5,
      certifications: ["Organic", "HVE", "Demeter"],
    })
  })

  it("allows named grapes when exact percentages are unknown", () => {
    expect(
      prepareWineFacts({
        country: "",
        region: "",
        classification: "",
        vineyard: "",
        grapeComposition: [
          { name: "Grenache", percentage: "" },
          { name: "Syrah", percentage: "" },
        ],
        sweetnessCategory: "",
        alcoholPercent: "",
        certifications: "",
      }).grapeComposition,
    ).toEqual([
      { name: "Grenache", percentage: null },
      { name: "Syrah", percentage: null },
    ])
  })

  it("rejects duplicate grapes and totals above 100 percent", () => {
    const base = {
      country: "",
      region: "",
      classification: "",
      vineyard: "",
      sweetnessCategory: "",
      alcoholPercent: "",
      certifications: "",
    }

    expect(() =>
      prepareWineFacts({
        ...base,
        grapeComposition: [
          { name: "Syrah", percentage: "50" },
          { name: "syrah", percentage: "40" },
        ],
      }),
    ).toThrow("listed more than once")

    expect(() =>
      prepareWineFacts({
        ...base,
        grapeComposition: [
          { name: "Syrah", percentage: "60" },
          { name: "Grenache", percentage: "50" },
        ],
      }),
    ).toThrow("cannot total more than 100%")
  })

  it("rejects invalid alcohol and malformed synchronized values", () => {
    expect(() =>
      prepareWineFacts({
        country: "",
        region: "",
        classification: "",
        vineyard: "",
        grapeComposition: [],
        sweetnessCategory: "",
        alcoholPercent: "31",
        certifications: "",
      }),
    ).toThrow("at most 30")

    expect(() =>
      parseWineFacts({ grape_composition: "not-json" }),
    ).toThrow("valid JSON")
  })

  it("formats normalized sweetness labels", () => {
    expect(sweetnessLabel("bone-dry")).toBe("Bone dry")
    expect(sweetnessLabel("medium-sweet")).toBe("Medium-sweet")
  })

  it("parses attributed reviewed-reference suggestions", () => {
    expect(
      parseWineFactSuggestions({
        reason: null,
        sources: [
          {
            kind: "reference",
            identifier_scheme: "LWIN7",
            identifier_value: "1234567",
            name: "Liv-ex LWIN reference",
            reviewed_at: "2026-08-26T10:00:00Z",
            url: null,
          },
          {
            kind: "reviewed-web",
            identifier_scheme: null,
            identifier_value: null,
            name: "Bourgogne Wine Board grape material",
            reviewed_at: "2026-08-26T18:00:00Z",
            url: "https://www.inao.gouv.fr/produit/puligny",
          },
        ],
        status: "available",
        values: {
          classification: "Premier Cru",
          country: "France",
          grape_composition: [
            { name: "Chardonnay", percentage: null },
          ],
          grape_note: "Confirm the producer or label.",
          region: "Burgundy",
          subregion: "Côte de Nuits",
          vineyard: "Les Evocelles",
        },
      }),
    ).toEqual({
      reason: null,
      sources: [
        {
          kind: "reference",
          identifierScheme: "LWIN7",
          identifierValue: "1234567",
          name: "Liv-ex LWIN reference",
          reviewedAt: "2026-08-26T10:00:00Z",
          url: null,
        },
        {
          kind: "reviewed-web",
          identifierScheme: null,
          identifierValue: null,
          name: "Bourgogne Wine Board grape material",
          reviewedAt: "2026-08-26T18:00:00Z",
          url: "https://www.inao.gouv.fr/produit/puligny",
        },
      ],
      status: "available",
      values: {
        classification: "Premier Cru",
        country: "France",
        grapeComposition: [
          { name: "Chardonnay", percentage: null },
        ],
        grapeNote: "Confirm the producer or label.",
        region: "Burgundy",
        subregion: "Côte de Nuits",
        vineyard: "Les Evocelles",
      },
    })
  })

  it("loads suggestions through the narrow read RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        reason: "No reviewed facts are available",
        sources: [],
        status: "unavailable",
        values: null,
      },
      error: null,
    })

    await expect(
      getWineFactSuggestions("wine-1", { rpc }),
    ).resolves.toEqual({
      reason: "No reviewed facts are available",
      sources: [],
      status: "unavailable",
      values: null,
    })
    expect(rpc).toHaveBeenCalledWith("get_wine_fact_suggestions", {
      p_wine_id: "wine-1",
    })
  })

  it("sends only the bounded rich-facts RPC contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })

    await updateWineFacts("wine-1", {
      country: "France",
      region: "Burgundy",
      classification: "Premier Cru",
      vineyard: "Les Evocelles",
      grapeComposition: [
        { name: "Pinot Noir", percentage: 100 },
      ],
      sweetnessCategory: "dry",
      alcoholPercent: 13.5,
      certifications: ["Organic"],
    }, { rpc })

    expect(rpc).toHaveBeenCalledWith("update_wine_facts", {
      p_wine_id: "wine-1",
      p_country: "France",
      p_region: "Burgundy",
      p_classification: "Premier Cru",
      p_vineyard: "Les Evocelles",
      p_grape_composition: [
        { name: "Pinot Noir", percentage: 100 },
      ],
      p_sweetness_category: "dry",
      p_alcohol_percent: 13.5,
      p_certifications: ["Organic"],
    })
  })
})
