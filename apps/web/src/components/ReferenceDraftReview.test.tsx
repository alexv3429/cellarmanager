// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getReferenceDrafts, recordReferenceReview } from "../data/drinkingWindowReferenceDrafts"
import { LanguageContext } from "../i18n/LanguageContext"
import { translate } from "../i18n/messages"
import { ReferenceDraftReview } from "./ReferenceDraftReview"

vi.mock("../data/drinkingWindowReferenceDrafts", () => ({
  getReferenceDrafts: vi.fn(), recordReferenceReview: vi.fn(),
}))

const workspace = {
  eligible: true,
  drafts: [{ versionId: "version", versionNumber: 1, subjects: [{
    kind: "row" as const, id: "row", hash: "a".repeat(64),
    title: "Beaujolais · 2022 · red",
    details: { first_trial_year: 2025, best_start_year: 2028, best_end_year: 2035 },
    rationale: "Owner-authored reference dates",
    evidence: [{ claimPart: "optimal_period", evidenceRole: "supports",
      sourceName: "Owner review", sourceUrl: "https://example.test/review",
      reviewStatus: "reviewed", reuseRight: "allowed" }],
    reviews: [], issues: ["missing_current_approval"],
  }] }],
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getReferenceDrafts).mockReset().mockResolvedValue(workspace)
  vi.mocked(recordReferenceReview).mockReset().mockResolvedValue("decision")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("reference draft curator review", () => {
  it("opens and closes a draft with one click each", async () => {
    await act(async () => root.render(<ReferenceDraftReview isOnline />))
    const details = container.querySelector("details")
    const summary = details?.querySelector("summary")
    expect(details?.open).toBe(false)
    const openClick = new MouseEvent("click", { bubbles: true, cancelable: true })
    await act(async () => summary?.dispatchEvent(openClick))
    expect(openClick.defaultPrevented).toBe(true)
    expect(details?.open).toBe(true)
    const closeClick = new MouseEvent("click", { bubbles: true, cancelable: true })
    await act(async () => summary?.dispatchEvent(closeClick))
    expect(closeClick.defaultPrevented).toBe(true)
    expect(details?.open).toBe(false)
  })

  it("hides draft information from users without the explicit grant", async () => {
    vi.mocked(getReferenceDrafts).mockResolvedValue({ eligible: false, drafts: [] })
    await act(async () => root.render(<ReferenceDraftReview isOnline />))
    expect(container.textContent).toBe("")
  })

  it("shows dates and provenance before accepting a reasoned curator decision", async () => {
    await act(async () => root.render(<ReferenceDraftReview isOnline />))
    expect(container.textContent).toContain("Unpublished draft")
    expect(container.textContent).toContain("1 draft item still needs review")
    const summary = container.querySelector("summary")
    await act(async () => summary?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    const milestones = container.querySelectorAll(".drinking-window-review-milestones div")
    expect([...milestones].map((item) => item.textContent)).toEqual([
      "Start tasting2025", "Optimum starts2028", "Optimum ends2035",
    ])
    expect(container.textContent).toContain("A general ageing claim or an owner's estimate is not a producer-published optimum window")
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.test/review")
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_self")
    const select = container.querySelector("select")
    const reviewForm = select?.closest("form")
    const submit = reviewForm?.querySelector('button[type="submit"]') as HTMLButtonElement | null
    expect(select?.value).toBe("")
    expect(submit?.disabled).toBe(true)
    const textarea = reviewForm?.querySelector("textarea")
    await act(async () => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "I checked the dates and the evidence.")
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })
    expect(submit?.disabled).toBe(true)
    await act(async () => {
      if (select) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "approve")
        select.dispatchEvent(new Event("change", { bubbles: true }))
      }
    })
    expect(submit?.disabled).toBe(false)
    expect(recordReferenceReview).not.toHaveBeenCalled()
    await act(async () => submit?.click())
    expect(recordReferenceReview).toHaveBeenCalledWith(expect.objectContaining({
      versionId: "version", kind: "row", subjectId: "row", expectedHash: "a".repeat(64),
      verdict: "approve", rationale: "I checked the dates and the evidence.",
    }))
    expect(select?.value).toBe("")
    expect(container.querySelector("details")?.open).toBe(false)
  })

  it("keeps an approved unpublished draft visible without asking for the same decision again", async () => {
    const approved = {
      ...workspace.drafts[0].subjects[0],
      issues: [],
      reviews: [{ verdict: "approve" as const, rationale: "I verified these three years.",
        decidedAt: "2026-10-26T10:00:00Z", curatorId: "owner" }],
    }
    vi.mocked(getReferenceDrafts).mockResolvedValue({
      eligible: true, drafts: [{ ...workspace.drafts[0], subjects: [approved] }],
    })
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><ReferenceDraftReview isOnline /></LanguageContext.Provider>))

    expect(container.textContent).toContain("Toutes les propositions de cette version ont été examinées")
    expect(container.textContent).toContain("brouillon non publié")
    await act(async () => container.querySelector("summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(container.textContent).toContain("I verified these three years.")
    expect(container.querySelector("form select")).toBeNull()
    const reconsider = [...container.querySelectorAll("button")].find((button) => button.textContent === "Réexaminer cette décision")
    expect(reconsider).toBeDefined()
    await act(async () => reconsider?.click())
    expect(container.querySelector("form select")).not.toBeNull()
  })

  it("puts unresolved items first and explains the three milestones in French", async () => {
    const pending = workspace.drafts[0].subjects[0]
    vi.mocked(getReferenceDrafts).mockResolvedValue({
      eligible: true,
      drafts: [{ ...workspace.drafts[0], subjects: [
        { ...pending, id: "approved", title: "Earlier approved row", issues: [] },
        pending,
      ] }],
    })
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><ReferenceDraftReview isOnline /></LanguageContext.Provider>))

    const summaries = [...container.querySelectorAll("summary strong")].map((item) => item.textContent)
    expect(summaries[0]).toContain("Beaujolais · 2022 · red")
    expect(summaries[1]).toContain("Earlier approved row")
    expect(container.textContent).toContain("1 élément du brouillon reste à examiner")
    const firstSummary = container.querySelector("summary")
    await act(async () => firstSummary?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(container.textContent).toContain("Commencer à tester2025")
    expect(container.textContent).toContain("Début probable de l’optimum2028")
    expect(container.textContent).toContain("Fin probable de l’optimum2035")
    expect(container.textContent).toContain("Choisir une décision")
  })

  it("presents the owner-authored pilot in French without duplicating one source", async () => {
    const pilot = workspace.drafts[0].subjects[0]
    vi.mocked(getReferenceDrafts).mockResolvedValue({
      eligible: true,
      drafts: [{ ...workspace.drafts[0], subjects: [{
        ...pilot,
        details: { ...pilot.details, scope: "release", format_ml: 750, best_end_year: 2040 },
        rationale: "Owner-authored provisional Côte du Py 2022 / 750 ml estimate: start tasting 2025, probable optimum 2028–2040. Exact-release retailer drinking horizons conflict; 2040 is the owner-selected estimate, not a producer- or critic-published optimum end. Requires curator and cellar-owner review before publication.",
        evidence: ["first_trial", "optimal_period"].map((claimPart) => ({
          claimPart, evidenceRole: "supports", sourceName: "Owner-reviewed first shared drinking-window estimate",
          sourceUrl: "https://github.com/alexv3429/cellarmanager/blob/main/docs/drinking-window-first-shared-draft.md", reviewStatus: "reviewed", reuseRight: "allowed",
        })),
      }] }],
    })
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><ReferenceDraftReview isOnline /></LanguageContext.Provider>))
    await act(async () => container.querySelector("summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(container.textContent).toContain("Vin et millésime exacts · Format : 750 ml")
    expect(container.textContent).toContain("La fin 2040 est le choix de la personne ayant proposé ces dates")
    expect(container.textContent).toContain("pas une fin d’optimum publiée")
    expect(container.textContent).not.toContain("non le domaine viticole")
    expect(container.querySelectorAll('a[href$="drinking-window-first-shared-draft.md"]')).toHaveLength(0)
    const readNote = [...container.querySelectorAll("button")].find((button) => button.textContent === "Lire la note de décision")
    expect(readNote?.getAttribute("aria-expanded")).toBe("false")
    await act(async () => readNote?.click())
    expect(readNote?.getAttribute("aria-expanded")).toBe("true")
    await vi.waitFor(() => expect(container.querySelector(".drinking-window-source-note__document h5")).not.toBeNull())
    expect(container.querySelector(".drinking-window-source-note__document h5")?.textContent).toContain("Burgaud 2022")
    expect(container.querySelectorAll(".drinking-window-source-note__document table")).toHaveLength(2)
    expect(container.querySelector('.drinking-window-source-note__document a[href="https://github.com/alexv3429/cellarmanager/blob/main/docs/producer-research-format.md"]')).not.toBeNull()
    expect(container.textContent).toContain("Ouvrir le document d’origine sur GitHub")
    expect(container.querySelector('a[href$="drinking-window-first-shared-draft.md"]')?.getAttribute("target")).toBe("_self")
    expect(container.textContent).toContain("début de dégustation, période optimale")
    expect(container.textContent).not.toContain("Owner-authored provisional")
  })

  it("explains that disagreement blocks publication and directs the reviewer to correction tools", async () => {
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><ReferenceDraftReview isOnline /></LanguageContext.Provider>))
    await act(async () => container.querySelector("summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    const select = container.querySelector("select")
    await act(async () => {
      if (select) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "disagree")
        select.dispatchEvent(new Event("change", { bubbles: true }))
      }
    })
    expect(container.textContent).toContain("Un désaccord bloque la publication, mais ne change pas ces dates")
    expect(container.textContent).toContain("utilisez les outils de correction ci-dessus")
    expect(container.textContent).toContain("Corriger les dates ou les sources")
    expect(container.textContent).toContain("Que faut-il corriger ?")
    expect(container.textContent).toContain("Enregistrer le désaccord")
    expect(recordReferenceReview).not.toHaveBeenCalled()
  })
})
