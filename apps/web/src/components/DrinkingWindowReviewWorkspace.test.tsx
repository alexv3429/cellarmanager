// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getDrinkingWindowReviewWorkspace, saveDrinkingWindowCandidateReview,
  stageDrinkingWindowCandidateAsDraft } from "../data/drinkingWindowReview"
import { getReferenceDrafts } from "../data/drinkingWindowReferenceDrafts"
import { DrinkingWindowReviewWorkspace } from "./DrinkingWindowReviewWorkspace"

vi.mock("../data/drinkingWindowReview", () => ({
  getDrinkingWindowReviewWorkspace: vi.fn(),
  saveDrinkingWindowCandidateReview: vi.fn(),
  stageDrinkingWindowCandidateAsDraft: vi.fn(),
}))
vi.mock("../data/drinkingWindowReferenceDrafts", () => ({ getReferenceDrafts: vi.fn() }))
vi.mock("./ReferenceDraftReview", () => ({ ReferenceDraftReview: () => <div>Reference drafts</div> }))
vi.mock("./DrinkingWindowReleasePanel", () => ({ DrinkingWindowReleasePanel: () => <div>Publication controls</div> }))
vi.mock("./ProfileGovernanceInbox", () => ({ ProfileGovernanceInbox: () => <div>Profile governance</div> }))
vi.mock("./FullProfileExchangePanel", () => ({ FullProfileExchangePanel: () => <div>Complete profiles</div> }))
vi.mock("./ProducerProfileImportPanel", () => ({ ProducerProfileImportPanel: () => <div>Producer profiles</div> }))

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
  vi.mocked(stageDrinkingWindowCandidateAsDraft).mockReset().mockResolvedValue({
    versionId: "new-version", versionNumber: 3, rowId: "new-row", alreadyStaged: false,
  })
  vi.mocked(getReferenceDrafts).mockReset().mockResolvedValue({ eligible: true, drafts: [{
    versionId: "base-version", versionNumber: 2, subjects: [],
  }] })
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
  it("separates profile, proposal and publication tasks", async () => {
    await act(async () => root.render(<DrinkingWindowReviewWorkspace householdId="home" isOnline />))
    expect(container.textContent).toContain("Reference candidates")
    expect(container.textContent).not.toContain("Publication controls")
    const tabs = [...container.querySelectorAll("nav button")]
    expect(tabs.map((button) => button.textContent)).toEqual(["Profiles", "Proposals", "Publication"])
    await act(async () => tabs[0].click())
    expect(container.textContent).toContain("Profile governance")
    expect(container.textContent).not.toContain("Reference candidates")
    await act(async () => tabs[2].click())
    expect(container.textContent).toContain("Publication controls")
    expect(container.textContent).toContain("Reference drafts")
    expect(container.textContent).not.toContain("Profile governance")
  })
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

  it("shows an owner suggestion with its three dates and unverified source material", async () => {
    vi.mocked(getDrinkingWindowReviewWorkspace).mockResolvedValue({
      eligible: true, identityRequests: [], candidates: [{
        ...workspace.candidates[0], sourceLocator: "cellar-owner-proposal:opaque-id",
        firstTrialYear: 2026, bestStartYear: 2029, bestEndYear: 2040,
        vintageYear: 2023,
        sourceIdentity: { origin: "cellar-owner-proposal", producer: "Jean-Marc Burgaud",
          cuvee: "Côte du Py", format_ml: 750,
          rationale: "The proposed years reflect this release's structure.",
          evidence_urls: ["https://example.org/release"] },
      }],
    })
    await act(async () => root.render(<DrinkingWindowReviewWorkspace isOnline />))
    const choose = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Burgaud · Côte du Py · 2023"))
    await act(async () => choose?.click())
    expect(container.textContent).toContain("Cellar owner suggestion")
    expect(container.textContent).toContain("2026 / 2029–2040")
    expect((container.querySelector('textarea[maxlength="2000"]') as HTMLTextAreaElement).value)
      .toContain("proposed years reflect")
    expect(saveDrinkingWindowCandidateReview).not.toHaveBeenCalled()
  })

  it("stages only a saved exact-release proposal into a new unpublished draft", async () => {
    vi.mocked(getDrinkingWindowReviewWorkspace).mockResolvedValue({
      eligible: true, identityRequests: [], candidates: [{
        ...workspace.candidates[0],
        sourceIdentity: { origin: "cellar-owner-proposal", producer: "Burgaud",
          cuvee: "James", format_ml: 750, region: "Beaujolais", appellation: "Morgon" },
        review: { id: "review", proposedScope: "release", firstTrialYear: 2026,
          bestStartYear: 2032, bestEndYear: 2042, ageingGroupNote: "",
          rationale: "Reviewed exact-release proposal.", evidenceUrls: ["https://example.org/source"],
          rightsStatus: "reuse-allowed", disposition: "propose", createdAt: "2026-10-28" },
      }],
    })
    await act(async () => root.render(<DrinkingWindowReviewWorkspace isOnline />))
    const choose = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Burgaud · James"))
    await act(async () => choose?.click())
    const base = [...container.querySelectorAll("select")].find((select) => select.querySelector('option[value="base-version"]'))
    expect(base).toBeTruthy()
    await act(async () => {
      if (base) {
        base.value = "base-version"
        base.dispatchEvent(new Event("change", { bubbles: true }))
      }
    })
    const stage = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Create a new unpublished draft"))
    await act(async () => stage?.click())
    expect(stageDrinkingWindowCandidateAsDraft).toHaveBeenCalledWith({
      candidateId: "candidate", expectedReviewId: "review", baseVersionId: "base-version",
    })
    expect(container.textContent).toContain("Dates are not published")
  })
})
