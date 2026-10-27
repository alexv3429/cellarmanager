// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getMySharedWindowCandidates, submitSharedWindowCandidate } from "../data/drinkingWindowCandidateSubmission"
import { SharedWindowCandidatePanel } from "./SharedWindowCandidatePanel"

vi.mock("../data/drinkingWindowCandidateSubmission", () => ({
  getMySharedWindowCandidates: vi.fn(), submitSharedWindowCandidate: vi.fn(),
}))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getMySharedWindowCandidates).mockReset().mockResolvedValue([])
  vi.mocked(submitSharedWindowCandidate).mockReset().mockResolvedValue("candidate")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("shared drinking-window suggestion panel", () => {
  it("explains the separate, nonpublishing path for an exact release", async () => {
    await act(async () => root.render(<SharedWindowCandidatePanel formatMl={750} isOnline vintage={2023} wineId="wine-23" />))
    expect(container.textContent).toContain("exact wine, vintage and bottle size (750 ml)")
    expect(container.textContent).toContain("does not change your cellar or publish dates")
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(3)
    expect(submitSharedWindowCandidate).not.toHaveBeenCalled()
  })

  it("shows a saved candidate as pending, not approved", async () => {
    vi.mocked(getMySharedWindowCandidates).mockResolvedValue([{
      id: "candidate", createdAt: "2026-10-28T12:00:00Z",
      reviewStatus: "staged", reviewDisposition: null,
      firstTrialYear: 2026, bestStartYear: 2029, bestEndYear: 2040,
    }])
    await act(async () => root.render(<SharedWindowCandidatePanel formatMl={750} isOnline vintage={2023} wineId="wine-23" />))
    expect(container.textContent).toContain("2026 / 2029–2040")
    expect(container.textContent).toContain("Awaiting shared-reference review")
  })

  it("does not allow submission offline", async () => {
    await act(async () => root.render(<SharedWindowCandidatePanel formatMl={750} isOnline={false} vintage={2023} wineId="wine-23" />))
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true)
    expect(getMySharedWindowCandidates).not.toHaveBeenCalled()
  })
})
