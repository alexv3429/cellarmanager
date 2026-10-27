// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getDrinkingWindowRolloutStatus, getShadowReport, listShadowReports,
  refreshDrinkingWindowDraftShadowReport, reviewShadowReport,
} from "../data/drinkingWindowShadowReview"
import { LanguageContext } from "../i18n/LanguageContext"
import { translate } from "../i18n/messages"
import { DrinkingWindowShadowReviewPanel } from "./DrinkingWindowShadowReviewPanel"

vi.mock("../data/drinkingWindowShadowReview", () => ({
  getDrinkingWindowRolloutStatus: vi.fn(),
  getShadowReport: vi.fn(),
  listShadowReports: vi.fn(),
  refreshDrinkingWindowDraftShadowReport: vi.fn(),
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
  sessionStorage.clear()
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
  vi.mocked(refreshDrinkingWindowDraftShadowReport).mockReset()
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
    expect(container.querySelector(".drinking-window-shadow-review__history")?.hasAttribute("open")).toBe(false)
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
    expect(container.textContent).toContain("1 fiches présentent des informations contradictoires")
    expect(container.textContent).toContain("Ce ne sont pas des dates à approuver")
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

  it("keeps the review open on return and selects the fresh comparison instead of the old five-conflict snapshot", async () => {
    const latest = { ...listing, reportId: "latest", versionNumber: 2,
      draftIssueCount: 0, recordedAt: "2026-10-27T12:00:00Z" }
    const older = { ...latest, reportId: "older", recordedAt: "2026-10-26T12:00:00Z" }
    const withdrawn = { ...older, reportId: "withdrawn", versionNumber: 1,
      versionStatus: "withdrawn" }
    vi.mocked(listShadowReports).mockResolvedValue([latest, older, withdrawn])
    vi.mocked(getShadowReport).mockImplementation(async (entry) => ({
      ...entry, contentSha256: "sha", rows: entry.reportId === "latest" ? [{
        wineId: "wine", comparisonStatus: "changed", currentSource: "model",
        draftStatus: "draft_match", matchedScope: "release",
        currentFirstTrialYear: 2026, currentBestStartYear: 2031, currentBestEndYear: 2039,
        proposedFirstTrialYear: 2025, proposedBestStartYear: 2028, proposedBestEndYear: 2040,
        proposedGroupKey: null, proposedGroupDefinition: null,
        proposedReferenceRationale: null, reason: null,
      }] : [] ,
    }))
    const onOpenWine = vi.fn()
    const panel = <LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><DrinkingWindowShadowReviewPanel householdId="household" isOnline
      onOpenWine={onOpenWine}
      wines={[{ id: "wine", producer: "Burgaud", cuvee: "Côte du Py", vintage: 2022 }]}
    /></LanguageContext.Provider>
    await act(async () => root.render(panel))
    expect(container.textContent).toContain("Comparaison actuelle · Version de référence 2")
    const history = container.querySelector(".drinking-window-shadow-review__history")
    expect(history?.hasAttribute("open")).toBe(false)
    expect(history?.textContent).toContain("Version de référence 1")
    await act(async () => container.querySelector<HTMLDetailsElement>(".drinking-window-shadow-review")?.querySelector("summary")?.click())
    await act(async () => {
      const current = [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Comparaison actuelle"))
      current?.click()
    })
    await act(async () => container.querySelector<HTMLButtonElement>("button.wine-detail-link")?.click())
    expect(onOpenWine).toHaveBeenCalledWith("wine")
    expect(sessionStorage.getItem("cellarmanager:drinking-window-review-open:household")).toBe("true")
    await act(async () => root.unmount())
    expect(sessionStorage.getItem("cellarmanager:drinking-window-review-open:household")).toBe("true")
    root = createRoot(container)
    await act(async () => root.render(panel))
    expect(container.querySelector(".drinking-window-shadow-review")?.hasAttribute("open")).toBe(true)
    expect(container.textContent).toContain("2025")
    expect(container.textContent).not.toContain("fiches présentent des informations contradictoires")
    expect(getShadowReport).toHaveBeenLastCalledWith(latest)
  })

  it("lets an owner refresh a shared draft without approving or editing a wine", async () => {
    const old = { ...listing, reportId: "old", versionNumber: 2, draftIssueCount: 0 }
    const fresh = { ...old, reportId: "fresh", recordedAt: "2026-10-27T13:00:00Z" }
    vi.mocked(listShadowReports).mockResolvedValueOnce([old])
      .mockResolvedValue([fresh, old])
    vi.mocked(refreshDrinkingWindowDraftShadowReport).mockResolvedValue("fresh")
    vi.mocked(getShadowReport).mockImplementation(async (entry) => ({
      ...entry, contentSha256: "sha", rows: [],
    }))
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><DrinkingWindowShadowReviewPanel householdId="household" isOnline
      onOpenWine={() => undefined} wines={[]} /></LanguageContext.Provider>))

    const refresh = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Actualiser cette comparaison du brouillon")
    expect(refresh).toBeTruthy()
    await act(async () => refresh?.click())
    expect(refreshDrinkingWindowDraftShadowReport).toHaveBeenCalledWith("household")
    expect(getShadowReport).toHaveBeenCalledWith(fresh)
    expect(container.textContent).toContain("Comparaison actuelle · Version de référence 2")
    expect(container.textContent).toContain("n’approuve aucune date")
    expect(reviewShadowReport).not.toHaveBeenCalled()
  })
})
