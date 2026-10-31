// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  exportFullProfileExchange, listFullProfileExchanges, previewFullProfileExchange,
  previewProfileStaging, stageProfileExchange,
} from "../data/drinkingWindowProfileExchange"
import { getReleaseWorkspace } from "../data/drinkingWindowReleaseWorkflow"
import { FullProfileExchangePanel } from "./FullProfileExchangePanel"

vi.mock("../data/drinkingWindowProfileExchange", () => ({
  exportFullProfileExchange: vi.fn(), importFullProfileExchange: vi.fn(),
  listFullProfileExchanges: vi.fn(), previewFullProfileExchange: vi.fn(),
  previewProfileStaging: vi.fn(), stageProfileExchange: vi.fn(),
}))
vi.mock("../data/drinkingWindowReleaseWorkflow", () => ({
  createWorkingDraft: vi.fn(), getReleaseWorkspace: vi.fn(),
}))
vi.mock("../data/drinkingWindowFallbackAuthoring", () => ({ searchCurationTargets: vi.fn() }))
vi.mock("../i18n/useLanguage", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(listFullProfileExchanges).mockResolvedValue([{
    id: "profile", documentSha256: "hash", kind: "producer", name: "Domaine Jean-Marc Burgaud",
    schemaVersion: "1.1.0", datasetVersion: "1.2.0", releaseCount: 2, submittedAt: "2026-10-31",
  }])
  vi.mocked(getReleaseWorkspace).mockResolvedValue({ canPublish: false, versions: [{
    versionId: "draft", versionNumber: 2, status: "draft", rowCount: 1, latestPreflight: null,
  }] })
  vi.mocked(exportFullProfileExchange).mockResolvedValue({})
  vi.mocked(previewFullProfileExchange).mockReturnValue({
    kind: "producer", name: "Domaine Jean-Marc Burgaud", datasetVersion: "1.2.0",
    releaseCount: 2, factCount: 0, sourceCount: 0,
    document: { producer: { name: "Domaine Jean-Marc Burgaud" }, cuvees: [] },
  })
  vi.mocked(previewProfileStaging).mockResolvedValue({
    profileId: "profile", versionId: "draft", previewSha256: "hash",
    ready: 0, unchanged: 0, quarantined: 2,
    items: ["2008", "2009"].map((year) => ({
      key: year, name: `James ${year}`, status: "quarantined" as const,
      reason: "Producer has no unique canonical identity", rationale: null,
      canonicalId: null, firstTrialYear: null, bestStartYear: null, bestEndYear: null,
      sourceUrls: [], children: [],
    })),
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("complete profile exchange", () => {
  it("groups a shared identity blocker before individual quarantined releases", async () => {
    await act(async () => root.render(<FullProfileExchangePanel isOnline />))
    await act(async () => container.querySelector("summary")?.click())
    const profile = container.querySelector("select") as HTMLSelectElement
    await act(async () => {
      profile.value = "profile"
      profile.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const inspect = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Preview mapping and changes")
    await act(async () => inspect?.click())
    expect(container.textContent).toContain("0 ready · 0 unchanged · 2 quarantined")
    expect(container.textContent).toContain("Why entries were set aside")
    expect(container.textContent).toContain("2 · Producer has no unique canonical identity")
    expect(container.textContent).toContain("Select the existing shared producer under name mapping")
    expect(container.textContent).not.toContain("Prepare valid entries in this draft")
  })

  it("passes the exact staged draft to the publication workflow", async () => {
    const onStaged = vi.fn()
    vi.mocked(previewProfileStaging).mockResolvedValue({
      profileId: "profile", versionId: "draft", previewSha256: "hash",
      ready: 1, unchanged: 0, quarantined: 0,
      items: [{
        key: "james-2022", name: "James · 2022 · 1500 ml", status: "ready",
        reason: null, rationale: "Synthetic editorial estimate", canonicalId: "release",
        firstTrialYear: 2026, bestStartYear: 2029, bestEndYear: 2038,
        sourceUrls: ["https://example.org/context"], children: [],
      }],
    })
    vi.mocked(stageProfileExchange).mockResolvedValue({
      staged: 1, unchanged: 0, quarantined: 0, published: false,
    })
    await act(async () => root.render(<FullProfileExchangePanel isOnline onStaged={onStaged} />))
    await act(async () => container.querySelector("summary")?.click())
    const profile = container.querySelector("select") as HTMLSelectElement
    await act(async () => {
      profile.value = "profile"
      profile.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const inspect = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Preview mapping and changes")
    await act(async () => inspect?.click())
    const reason = container.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(reason,
        "I checked this exact release and adopt these editorial estimates for shared use.")
      reason.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const consent = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => consent.click())
    const stage = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Prepare valid entries in this draft")
    expect(stage?.disabled).toBe(false)
    await act(async () => stage?.click())
    expect(stageProfileExchange).toHaveBeenCalledOnce()
    expect(onStaged).toHaveBeenCalledWith("draft")
  })
})
