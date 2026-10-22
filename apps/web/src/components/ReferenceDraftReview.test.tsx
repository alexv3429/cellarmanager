// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getReferenceDrafts, recordReferenceReview } from "../data/drinkingWindowReferenceDrafts"
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
  it("hides draft information from users without the explicit grant", async () => {
    vi.mocked(getReferenceDrafts).mockResolvedValue({ eligible: false, drafts: [] })
    await act(async () => root.render(<ReferenceDraftReview isOnline />))
    expect(container.textContent).toBe("")
  })

  it("shows dates and provenance before accepting a reasoned curator decision", async () => {
    await act(async () => root.render(<ReferenceDraftReview isOnline />))
    expect(container.textContent).toContain("Unpublished draft")
    const summary = container.querySelector("summary")
    await act(async () => summary?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(container.textContent).toContain("2025 → 2028–2035")
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.test/review")
    const textarea = container.querySelector("textarea")
    await act(async () => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "I checked the dates and the evidence.")
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })
    expect(recordReferenceReview).not.toHaveBeenCalled()
  })
})
