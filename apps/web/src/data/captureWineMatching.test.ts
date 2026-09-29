import { describe, expect, it } from "vitest"

import type { CaptureWineSuggestion } from "./capturePhotos"
import { findCaptureWineMatchCandidates, findCaptureWineMatchesFromTranscript } from "./captureWineMatching"
import type { WineCatalogEntry } from "./wineCatalog"

function text(value: string | null, evidence: string[] = []) {
  return { value, evidence, confidence: value ? "medium" as const : "low" as const }
}

const suggestion: CaptureWineSuggestion = {
  producer: text("JEAN-MARC BURGAUD", ["JEAN-MARC BURGAUD"]),
  cuvee: text("MORGON CÔTE DU PY", ["MORGON CÔTE DU PY"]),
  appellation: text("MORGON", ["APPELLATION MORGON PROTÉGÉE"]),
  area: text(null),
  color: { ...text(null), value: null },
  format_ml: { value: null, evidence: [], confidence: "low" },
  vintage: { value: 2011, status: "year", evidence: ["2011"], confidence: "high" },
}

function wine(overrides: Partial<WineCatalogEntry> = {}): WineCatalogEntry {
  return {
    id: "wine-1",
    household_id: "household-1",
    producer: "Jean-Marc Burgaud",
    cuvee: "Morgon Côte du Py",
    vintage: 2011,
    color: "red",
    appellation: "Morgon",
    area: "Beaujolais",
    format_ml: 750,
    ...overrides,
  }
}

describe("capture wine catalogue matching", () => {
  it("finds a known Pouilly-Fuissé even when the model would confuse appellation and cuvée", () => {
    const known = wine({
      id: "barraud", producer: "Domaine Barraud", cuvee: "En France",
      appellation: "Pouilly-Fuissé", vintage: 2019, color: "white",
    })
    const pages = [{ text: "2019\nVin de Bourgogne\nPOUILLY-FUISSÉ\nEn France\nDOMAINE BARRAUD" }]

    expect(findCaptureWineMatchesFromTranscript(pages, [known], "household-1").map((match) => match.id)).toEqual(["barraud"])
    expect(findCaptureWineMatchesFromTranscript(pages, [known], "household-2")).toEqual([])
    expect(findCaptureWineMatchesFromTranscript(pages, [{ ...known, vintage: 2020 }], "household-1")).toEqual([])
    expect(findCaptureWineMatchesFromTranscript([{ text: `${pages[0].text}\n2020` }], [known], "household-1")).toEqual([])
  })

  it("does not claim a known wine from only a producer or a generic cuvée phrase", () => {
    const known = wine({ producer: "Domaine Barraud", cuvee: "En France", appellation: "Pouilly-Fuissé", vintage: 2019 })
    expect(findCaptureWineMatchesFromTranscript([{ text: "DOMAINE BARRAUD\nPOUILLY-FUISSÉ\n2019" }], [known], "household-1")).toEqual([])
    expect(findCaptureWineMatchesFromTranscript([{ text: "DOMAINE BARRAUD\nEn France" }], [known], "household-1")).toEqual([])
  })
  it("returns local catalogue possibilities without using them to rewrite the suggestion", () => {
    const wines = [
      wine(),
      wine({ id: "wine-2", cuvee: "Morgon Côte du Py Vieilles Vignes" }),
      wine({ id: "private-wine", household_id: "household-2" }),
      wine({ id: "wrong-year", vintage: 2012 }),
    ]

    const matches = findCaptureWineMatchCandidates(suggestion, wines, "household-1")

    expect(matches.map((match) => match.wine.id)).toEqual(["wine-1", "wine-2"])
    expect(matches[0].supportingFields).toContain("vintage")
    expect(suggestion.cuvee.value).toBe("MORGON CÔTE DU PY")
  })

  it("excludes conflicts, merged entries and other households", () => {
    const redSuggestion = {
      ...suggestion,
      color: { value: "red" as const, evidence: ["ROUGE"], confidence: "high" as const },
    }
    const matches = findCaptureWineMatchCandidates(redSuggestion, [
      wine({ id: "wrong-vintage", vintage: 2012 }),
      wine({ id: "wrong-color", color: "white" }),
      wine({ id: "merged", merged_into_wine_id: "wine-1" }),
      wine({ id: "foreign", household_id: "household-2" }),
    ], "household-1")

    expect(matches).toEqual([])
  })

  it("does not suggest matches when producer or cuvée is still unknown", () => {
    expect(findCaptureWineMatchCandidates({
      ...suggestion,
      producer: text(null),
    }, [wine()], "household-1")).toEqual([])
  })
})
