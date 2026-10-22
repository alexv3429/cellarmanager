// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getDrinkingWindowReviewWorkspace, saveDrinkingWindowCandidateReview } from "../data/drinkingWindowReview"
import { DrinkingWindowReviewWorkspace } from "./DrinkingWindowReviewWorkspace"

vi.mock("../data/drinkingWindowReview", () => ({
  getDrinkingWindowReviewWorkspace: vi.fn(),
  saveDrinkingWindowCandidateReview: vi.fn(),
}))
vi.mock("./ReferenceDraftReview", () => ({ ReferenceDraftReview: () => <div>Reference drafts</div> }))

const workspace = {
  eligible: true,
  identityRequests: [{ id: "request", requestedAt: "2026-10-16", producer: "Barraud",
    cuvee: "En France", vintage: 2019, color: "white", appellation: "Pouilly-Fuissé",
    region: "Bourgogne", sourceChanged: false }],
  candidates: [{ id: "candidate", sourceLocator: "Barraud!A2:F2",
    sourceIdentity: { producer: "Barraud", cuvee: "En France" },
    candidateScope: "release", reviewReason: null, wineColor: "white",
    vintageYear: 2019, firstTrialYear: null, bestStartYear: 2024, bestEndYear: 2031,
    review: null }],
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getDrinkingWindowReviewWorkspace).mockReset().mockResolvedValue(workspace)
  vi.mocked(saveDrinkingWindowCandidateReview).mockReset().mockResolvedValue("review")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("curator drinking-window review workspace", () => {
  it("stays invisible without a curator grant", async () => {
    vi.mocked(getDrinkingWindowReviewWorkspace).mockResolvedValue({ eligible: false, candidates: [], identityRequests: [] })
    await act(async () => root.render(<DrinkingWindowReviewWorkspace isOnline />))
    expect(container.querySelector("details")).toBeNull()
  })

  it("shows identity requests and keeps candidate review separate from published advice", async () => {
    await act(async () => root.render(<DrinkingWindowReviewWorkspace isOnline />))
    expect(container.textContent).toContain("Missing shared wine identities")
    expect(container.textContent).toContain("Barraud · En France · 2019")
    const choose = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Barraud · En France · 2019"))
    expect(choose).toBeTruthy()
    await act(async () => choose?.click())
    expect(container.textContent).toContain("Original dates")
    expect(container.textContent).toContain("Saving a draft does not publish")
    expect(saveDrinkingWindowCandidateReview).not.toHaveBeenCalled()
  })
})
