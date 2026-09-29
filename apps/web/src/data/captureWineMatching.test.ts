import { describe, expect, it } from "vitest"

import type { CaptureWineSuggestion } from "./capturePhotos"
import { enrichCaptureWineSuggestion, findCaptureWineCrossRoleMatch, findCaptureWineMatchCandidates, findCaptureWineMatchesFromTranscript, findCatalogueAppellationSpelling, findReviewedAppellation } from "./captureWineMatching"
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
  it("uses the reviewed appellation reference to correct a unique OCR typo", () => {
    expect(findReviewedAppellation("POULILLY-FUISSE")).toEqual({ appellation: "Pouilly-Fuissé", region: "Bourgogne" })
    expect(findReviewedAppellation("POUILLY-FUISSÉ")).toEqual({ appellation: "Pouilly-Fuissé", region: "Bourgogne" })
    expect(findReviewedAppellation("unknown print")).toBeNull()
  })

  it("fills the editable Barraud suggestion from a unique known wine, not from an OCR role mistake", () => {
    const known = wine({ producer: "Domaine Barraud", cuvee: "En France", vintage: 2019,
      appellation: null, area: "Bourgogne", color: "white" })
    const raw: CaptureWineSuggestion = { ...suggestion,
      producer: text("DOMAINE BARRAUD"), cuvee: text("En France"),
      appellation: text("POULILLY-FUISSE", ["POULILLY-FUISSE"]), area: text("En France"),
      color: { value: null, evidence: [], confidence: "low" },
      format_ml: { value: null, evidence: [], confidence: "low" },
      vintage: { value: 2019, status: "year", evidence: ["2019"], confidence: "high" },
    }
    const match = findCaptureWineCrossRoleMatch(raw, [known], "household-1")
    const enriched = enrichCaptureWineSuggestion(raw, match, "household-1")
    expect(enriched.suggestion.producer.value).toBe("Domaine Barraud")
    expect(enriched.suggestion.cuvee.value).toBe("En France")
    expect(enriched.suggestion.appellation.value).toBe("Pouilly-Fuissé")
    expect(enriched.suggestion.area.value).toBe("Bourgogne")
    expect(enriched.suggestion.color.value).toBe("white")
    expect(enriched.suggestion.format_ml.value).toBeNull()
    expect(enriched.suggestion.appellation.evidence).toEqual([])
    expect(enriched.catalogueFields).toEqual(["producer", "color", "area"])
    expect(enriched.reviewedFields).toEqual(["appellation"])
    expect(raw.appellation.value).toBe("POULILLY-FUISSE")
    const ambiguous = findCaptureWineCrossRoleMatch(raw, [known, { ...known, id: "other" }], "household-1")
    expect(ambiguous).toBeNull()
    expect(enrichCaptureWineSuggestion(raw, ambiguous, "household-1").suggestion.color.value).toBeNull()
    const malformedCatalogue = { ...known, appellation: "Poulilly-Fuisse", area: "En France" }
    const recovered = enrichCaptureWineSuggestion(raw, malformedCatalogue, "household-1")
    expect(recovered.suggestion.appellation.value).toBe("Pouilly-Fuissé")
    expect(recovered.suggestion.area.value).toBe("Bourgogne")
    expect(recovered.reviewedFields).toEqual(["appellation", "area"])
  })

  it("finds one existing wine when OCR and inference split its label across wrong fields", () => {
    const known = wine({
      id: "barraud", producer: "Domaine Barraud", cuvee: "En France", appellation: "Pouilly-Fuissé",
      vintage: 2019, color: "white", area: "Bourgogne",
    })
    const misclassified: CaptureWineSuggestion = {
      ...suggestion,
      producer: text("Domaine Barraud"),
      cuvee: text("POULILLY-FUISSE"),
      appellation: text("POULILLY-FUISSE"),
      area: text("En France"),
      vintage: { value: 2019, status: "year", evidence: ["2019"], confidence: "high" },
      color: { value: null, evidence: [], confidence: "low" },
    }

    expect(findCaptureWineCrossRoleMatch(misclassified, [known], "household-1")?.id).toBe("barraud")
    expect(findCaptureWineCrossRoleMatch({ ...misclassified, cuvee: text(null) }, [known], "household-1")?.id).toBe("barraud")
    expect(findCaptureWineCrossRoleMatch(misclassified, [known], "another-household")).toBeNull()
    expect(findCaptureWineCrossRoleMatch({ ...misclassified, area: text("Other cuvée") }, [known], "household-1")).toBeNull()
    expect(findCaptureWineCrossRoleMatch({ ...misclassified, vintage: { ...misclassified.vintage, value: 2020 } }, [known], "household-1")).toBeNull()
    expect(findCaptureWineCrossRoleMatch(misclassified, [known, { ...known, id: "other-format", format_ml: 1500 }], "household-1")).toBeNull()
  })

  it("does not override clear conflicting colour or format evidence from a label", () => {
    const known = wine({ producer: "Domaine Barraud", cuvee: "En France", appellation: "Pouilly-Fuissé", vintage: 2019, color: "white" })
    const base: CaptureWineSuggestion = {
      ...suggestion,
      producer: text("Domaine Barraud"), cuvee: text("En France"), appellation: text("POULILLY-FUISSE"),
      vintage: { value: 2019, status: "year", evidence: ["2019"], confidence: "high" },
    }
    expect(findCaptureWineCrossRoleMatch({
      ...base, color: { value: "red", confidence: "high", evidence: ["ROUGE"] },
    }, [known], "household-1")).toBeNull()
    expect(findCaptureWineCrossRoleMatch({
      ...base, format_ml: { value: 1500, confidence: "high", evidence: ["150 cl"] },
    }, [known], "household-1")).toBeNull()
    expect(findCaptureWineCrossRoleMatch({
      ...base, appellation: { value: "Morgon", confidence: "high", evidence: ["MORGON"] },
    }, [known], "household-1")).toBeNull()
  })

  it("can offer a unique existing wine when its catalogue appellation is missing", () => {
    const known = wine({
      producer: "Domaine Barraud", cuvee: "En France", appellation: null,
      area: "Bourgogne", vintage: 2019, color: "white",
    })
    const candidate: CaptureWineSuggestion = {
      ...suggestion,
      producer: text("Domaine Barraud"), cuvee: text("POULILLY-FUISSE"),
      appellation: text("POULILLY-FUISSE"), area: text("En France"),
      vintage: { value: 2019, status: "year", evidence: ["2019"], confidence: "high" },
    }
    expect(findCaptureWineCrossRoleMatch(candidate, [known], "household-1")?.id).toBe(known.id)
    expect(findCaptureWineCrossRoleMatch(candidate, [known, { ...known, id: "second" }], "household-1")).toBeNull()
  })

  it("corrects a clear OCR appellation typo using only this household's catalogue", () => {
    const known = wine({ appellation: "Pouilly-Fuissé" })
    expect(findCatalogueAppellationSpelling("POULILLY-FUISSE", [known], "household-1")).toBe("Pouilly-Fuissé")
    expect(findCatalogueAppellationSpelling("POUILLY-FUISSE", [known], "household-1")).toBe("Pouilly-Fuissé")
    expect(findCatalogueAppellationSpelling("Pouilly-Fuissé", [known], "household-1")).toBeNull()
    expect(findCatalogueAppellationSpelling("POULILLY-FUISSE", [known], "another-household")).toBeNull()
  })

  it("does not guess when the OCR appellation has multiple close catalogue spellings", () => {
    const known = wine({ appellation: "Pouilly-Fuissé" })
    expect(findCatalogueAppellationSpelling("POULILLY-FUISSE", [
      known, wine({ id: "variant", appellation: "Poulilly-Fuissè" }),
    ], "household-1")).toBe("Poulilly-Fuissè")
    expect(findCatalogueAppellationSpelling("POULILLY-FUISSE", [
      known, wine({ id: "variant", appellation: "Poulilly-Fuisss" }),
    ], "household-1")).toBeNull()
    expect(findCatalogueAppellationSpelling("MORGON", [known], "household-1")).toBeNull()
  })

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
