// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getDrinkingWindowRolloutStatus, getShadowReport, listShadowReports,
  reviewShadowReport,
} from "../data/drinkingWindowShadowReview"
import { LanguageContext } from "../i18n/LanguageContext"
import { translate } from "../i18n/messages"
import { DrinkingWindowShadowReviewPanel } from "./DrinkingWindowShadowReviewPanel"

vi.mock("../data/drinkingWindowShadowReview", () => ({
  getDrinkingWindowRolloutStatus: vi.fn(),
  getShadowReport: vi.fn(),
  listShadowReports: vi.fn(),
  requestDrinkingWindowShadowReport: vi.fn(),
  reviewShadowReport: vi.fn(),
}))

const group = "Only individually reviewed long-ageing red 2022 releases in Beaujolais. This first draft includes Burgaud Côte du Py and James, not Les Charmes, all Morgon, or all Beaujolais Cru."
const rationale = "Owner-authored 2022 Beaujolais long-ageing estimate: test from 2025, probable optimum 2028–2035. These are not dates published by the producer; they apply only to separately reviewed release memberships."
const listing = {
  reportId: "report", versionNumber: 1, versionStatus: "draft", wineCount: 1,
  draftIssueCount: 4, recordedAt: "2026-10-24", latestVerdict: null,
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(listShadowReports).mockReset().mockResolvedValue([listing])
  vi.mocked(getDrinkingWindowRolloutStatus).mockReset().mockResolvedValue({
    activeVersionNumber: null, selectedVersionNumber: null,
    selectedEnabled: false, globalEnabled: false,
  })
  vi.mocked(getShadowReport).mockReset().mockResolvedValue({
    ...listing, contentSha256: "sha", rows: [{
      wineId: "wine", comparisonStatus: "changed", currentSource: "model",
      draftStatus: "draft_match", matchedScope: "region",
      currentFirstTrialYear: 2026, currentBestStartYear: 2031, currentBestEndYear: 2039,
      proposedFirstTrialYear: 2025, proposedBestStartYear: 2028, proposedBestEndYear: 2035,
      proposedGroupKey: "reviewed-long-ageing-2022-morgon",
      proposedGroupDefinition: group, proposedReferenceRationale: rationale, reason: null,
    }],
  })
  vi.mocked(reviewShadowReport).mockReset()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("shared drinking-window draft comparison", () => {
  it("marks a withdrawn reference as history rather than a pending review", async () => {
    const withdrawn = { ...listing, versionStatus: "withdrawn", draftIssueCount: 0 }
    vi.mocked(listShadowReports).mockResolvedValue([withdrawn])
    vi.mocked(getShadowReport).mockResolvedValue({
      ...withdrawn, contentSha256: "sha", rows: [],
    })
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><DrinkingWindowShadowReviewPanel householdId="household" isOnline
      onOpenWine={() => undefined} wines={[]} /></LanguageContext.Provider>))

    const reportButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Version de référence 1"))
    expect(reportButton?.textContent).toContain("Retirée — aucun avis nécessaire")
    await act(async () => reportButton?.click())
    expect(container.textContent).toContain("Cette version de référence a été retirée")
    expect(container.textContent).not.toContain("Approuver cette comparaison")
  })

  it("separates current and unpublished dates, explains eligibility in French, and requests no decision", async () => {
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><DrinkingWindowShadowReviewPanel householdId="household" isOnline
      onOpenWine={() => undefined}
      wines={[{ id: "wine", producer: "Burgaud", cuvee: "Côte du Py", vintage: 2022 }]}
    /></LanguageContext.Provider>))

    expect(container.textContent).toContain("aucune action nécessaire")
    const reportButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Version de référence 1"))
    expect(reportButton).toBeTruthy()
    await act(async () => reportButton?.click())

    expect(container.textContent).toContain("Ce brouillon n’est pas utilisé")
    expect(container.textContent).toContain("1 proposition avec des dates différentes")
    const panels = container.querySelectorAll(".drinking-window-shadow-review__comparison section")
    expect(panels).toHaveLength(2)
    expect(panels[0].textContent).toContain("Dates utilisées actuellement dans votre cave")
    expect(panels[0].textContent).toContain("2026")
    expect(panels[0].textContent).toContain("2031")
    expect(panels[0].textContent).toContain("2039")
    expect(panels[0].textContent).toContain("Ces dates actuelles viennent du modèle existant, pas de ce brouillon")
    expect(panels[0].textContent).toContain("Pourquoi cette estimation ?")
    expect(panels[1].textContent).toContain("Dates du brouillon — non utilisées")
    expect(panels[1].textContent).toContain("2025")
    expect(panels[1].textContent).toContain("2028")
    expect(panels[1].textContent).toContain("2035")
    expect(container.textContent).toContain("Quels vins sont concernés ?")
    expect(container.textContent).not.toContain("?:")
    expect(container.textContent).toContain("pas aux Charmes")
    expect(container.textContent).not.toContain(group)
    expect(container.textContent).not.toContain(rationale)
    expect(container.textContent).not.toContain("Approuver cette comparaison")
    expect(reviewShadowReport).not.toHaveBeenCalled()
  })

  it("explains why an identity conflict blocks owner approval and links to the wine", async () => {
    const ready = { ...listing, versionNumber: 2, draftIssueCount: 0 }
    vi.mocked(listShadowReports).mockResolvedValue([ready])
    vi.mocked(getShadowReport).mockResolvedValue({
      ...ready, contentSha256: "sha", rows: [{
        wineId: "conflict", comparisonStatus: "identity_conflict", currentSource: "model",
        draftStatus: "identity_conflict", matchedScope: null,
        currentFirstTrialYear: 2026, currentBestStartYear: 2031, currentBestEndYear: 2039,
        proposedFirstTrialYear: null, proposedBestStartYear: null, proposedBestEndYear: null,
        proposedGroupKey: null, proposedGroupDefinition: null, proposedReferenceRationale: null,
        reason: "appellation_outside_region",
      }],
    })
    const onOpenWine = vi.fn()
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><DrinkingWindowShadowReviewPanel householdId="household" isOnline
      onOpenWine={onOpenWine}
      wines={[{ id: "conflict", producer: "Boillot", cuvee: "Aux Caves", vintage: 2022 }]}
    /></LanguageContext.Provider>))

    const reportButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Version de référence 2"))
    await act(async () => reportButton?.click())
    expect(container.textContent).toContain("Identités de vin à vérifier avant approbation : 1")
    expect(container.textContent).toContain("L’appellation et la région ne concordent pas")
    expect(container.textContent).toContain("une nouvelle comparaison sera nécessaire")
    const approve = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Approuver cette comparaison")
    expect(approve?.disabled).toBe(true)
    const wine = [...container.querySelectorAll("button.wine-detail-link")]
      .find((button) => button.textContent?.includes("Boillot · Aux Caves"))
    await act(async () => wine?.click())
    expect(onOpenWine).toHaveBeenCalledWith("conflict")
  })
})
