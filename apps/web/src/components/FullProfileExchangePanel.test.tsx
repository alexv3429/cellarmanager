// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createProfileIdentityBatch,
  exportFullProfileExchange, importFullProfileExchange, listFullProfileExchanges, previewFullProfileExchange,
  previewProfileIdentityBatch, previewProfileStaging, stageProfileExchange,
  suggestProfileIdentities, suggestProfilePlaces,
} from "../data/drinkingWindowProfileExchange"
import { searchCurationTargets } from "../data/drinkingWindowFallbackAuthoring"
import { getReleaseWorkspace } from "../data/drinkingWindowReleaseWorkflow"
import { FullProfileExchangePanel } from "./FullProfileExchangePanel"

vi.mock("../data/drinkingWindowProfileExchange", () => ({
  exportFullProfileExchange: vi.fn(), importFullProfileExchange: vi.fn(),
  listFullProfileExchanges: vi.fn(), previewFullProfileExchange: vi.fn(),
  previewProfileIdentityBatch: vi.fn(), createProfileIdentityBatch: vi.fn(),
  previewProfileStaging: vi.fn(), stageProfileExchange: vi.fn(),
  suggestProfileIdentities: vi.fn(), suggestProfilePlaces: vi.fn(),
}))
vi.mock("../data/drinkingWindowReleaseWorkflow", () => ({
  createWorkingDraft: vi.fn(), getReleaseWorkspace: vi.fn(),
}))
vi.mock("../data/drinkingWindowFallbackAuthoring", () => ({ searchCurationTargets: vi.fn() }))
vi.mock("../i18n/useLanguage", () => ({ useLanguage: () => ({
  t: (key: string, values?: Record<string, string>) => Object.entries(values || {})
    .reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), key),
}) }))

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
  vi.mocked(suggestProfileIdentities).mockResolvedValue({ map: {}, producerMatches: 0,
    ambiguousCuvees: [] })
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
  it("uses only unique existing identity suggestions without an extra owner decision", async () => {
    vi.mocked(suggestProfileIdentities).mockResolvedValue({
      map: { producer_id: "shared-chagnoleau", cuvees: { a_la_cote: "shared-cote" } },
      producerMatches: 1, ambiguousCuvees: ["generic_rose"],
    })
    await act(async () => root.render(<FullProfileExchangePanel isOnline />))
    await act(async () => container.querySelector("summary")?.click())
    const profile = container.querySelector("select") as HTMLSelectElement
    await act(async () => {
      profile.value = "profile"
      profile.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const mapping = [...container.querySelectorAll("summary")]
      .find((summary) => summary.textContent === "Map profile names to shared wine identities")
    await act(async () => mapping?.click())
    expect(container.textContent).toContain("1 existing cuvées matched")
    expect(container.textContent).toContain("1 ambiguous cuvées left for review")
    const inspect = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Preview mapping and changes")
    await act(async () => inspect?.click())
    expect(previewProfileStaging).toHaveBeenLastCalledWith(expect.anything(), "draft",
      { producer_id: "shared-chagnoleau", cuvees: { a_la_cote: "shared-cote" } })
  })
  it("requires an explicit click before a proposed place mapping reaches the preview", async () => {
    vi.mocked(previewFullProfileExchange).mockReturnValue({
      kind: "producer", name: "Frantz Chagnoleau", datasetVersion: "1.1.0",
      releaseCount: 1, factCount: 0, sourceCount: 0,
      document: { producer: { name: "Frantz Chagnoleau" }, cuvees: [{
        id: "a_la_cote", name: "À la Côte", region: "Bourgogne — Mâconnais",
        appellation: "Saint-Véran",
      }, { id: "premier_cru", name: "A classified wine", region: "Bourgogne — Côte de Beaune",
        appellation: "Meursault 1er Cru" }] },
    })
    vi.mocked(suggestProfilePlaces).mockResolvedValue({ regions: [{
      kind: "region", sourceName: "Bourgogne — Mâconnais", targetId: "region-bourgogne",
      targetName: "Bourgogne", reason: "parent_region_prefix",
    }], appellations: [{ kind: "appellation", sourceName: "Meursault 1er Cru",
      targetId: "appellation-meursault", targetName: "Meursault",
      reason: "classification_parent_appellation" }] })
    await act(async () => root.render(<FullProfileExchangePanel isOnline />))
    await act(async () => container.querySelector("summary")?.click())
    const profile = container.querySelector("select") as HTMLSelectElement
    await act(async () => {
      profile.value = "profile"
      profile.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const mapping = [...container.querySelectorAll("summary")]
      .find((summary) => summary.textContent === "Map profile names to shared wine identities")
    await act(async () => mapping?.click())
    const suggest = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Find unambiguous place suggestions")
    await act(async () => suggest?.click())
    expect(container.textContent).toContain("Bourgogne — Mâconnais → Bourgogne")
    expect(container.textContent).toContain("Meursault 1er Cru → Meursault")
    expect(container.textContent).toContain("Check the classification and vintage")
    const inspect = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Preview mapping and changes")
    await act(async () => inspect?.click())
    expect(previewProfileStaging).toHaveBeenLastCalledWith(expect.anything(), "draft", {})
    const accept = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Use selected correspondences for this import")
    expect(accept?.disabled).toBe(true)
    const regionChoice = [...container.querySelectorAll("li label")]
      .find((label) => label.textContent?.includes("Bourgogne — Mâconnais → Bourgogne"))
    await act(async () => regionChoice?.querySelector("input")?.click())
    await act(async () => accept?.click())
    await act(async () => inspect?.click())
    expect(previewProfileStaging).toHaveBeenLastCalledWith(expect.anything(), "draft",
      { regions: { "Bourgogne — Mâconnais": "region-bourgogne" } })
    await act(async () => suggest?.click())
    const appellationChoice = [...container.querySelectorAll("li label")]
      .find((label) => label.textContent?.includes("Meursault 1er Cru → Meursault"))
    await act(async () => appellationChoice?.querySelector("input")?.click())
    const acceptAppellation = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Use selected correspondences for this import")
    await act(async () => acceptAppellation?.click())
    await act(async () => inspect?.click())
    expect(previewProfileStaging).toHaveBeenLastCalledWith(expect.anything(), "draft",
      { regions: { "Bourgogne — Mâconnais": "region-bourgogne" },
        appellations: { "Meursault 1er Cru": "appellation-meursault" } })
  })
  it("accepts multiple profiles and retains failed imports for an explicit retry", async () => {
    vi.mocked(importFullProfileExchange)
      .mockResolvedValueOnce({ id: "first", documentSha256: "hash-first", kind: "producer",
        name: "First", schemaVersion: "1.1.0", datasetVersion: "1.0.0",
        releaseCount: 1, submittedAt: "2026-10-31" })
      .mockRejectedValueOnce(new Error("Network interrupted"))
      .mockResolvedValueOnce({ id: "second", documentSha256: "hash-second", kind: "producer",
        name: "Second", schemaVersion: "1.1.0", datasetVersion: "1.0.0",
        releaseCount: 1, submittedAt: "2026-10-31" })
    await act(async () => root.render(<FullProfileExchangePanel isOnline />))
    await act(async () => container.querySelector("summary")?.click())
    expect(container.textContent).toContain(
      "Saving a profile does not match it to wines already in a cellar.")
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.multiple).toBe(true)
    Object.defineProperty(input, "files", { configurable: true, value: [
      { name: "First.json", size: 50, text: async () => '{"name":"First"}' },
      { name: "Second.json", size: 50, text: async () => '{"name":"Second"}' },
    ] })
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })))
    const saveTwo = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Save 2 complete profiles for review")
    expect(saveTwo).toBeTruthy()
    await act(async () => saveTwo?.click())
    expect(importFullProfileExchange).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("Complete profile saved for review")
    expect(container.textContent).toContain("Second.json: Network interrupted")
    const retry = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Save complete profile for review")
    await act(async () => retry?.click())
    expect(importFullProfileExchange).toHaveBeenCalledTimes(3)
    expect(container.textContent).not.toContain("Second.json: Network interrupted")
  })

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

  it("passes an explicitly reviewed region mapping to the staging preview", async () => {
    vi.mocked(previewFullProfileExchange).mockReturnValue({
      kind: "producer", name: "Frantz Chagnoleau", datasetVersion: "1.1.0",
      releaseCount: 1, factCount: 0, sourceCount: 0,
      document: { producer: { name: "Frantz Chagnoleau" }, cuvees: [{
        id: "a_la_cote", name: "À la Côte", region: "Bourgogne — Mâconnais",
        appellation: "Saint-Véran",
      }] },
    })
    vi.mocked(searchCurationTargets).mockResolvedValue([{
      id: "region-bourgogne", label: "Bourgogne", detail: "region",
    }])
    await act(async () => root.render(<FullProfileExchangePanel isOnline />))
    await act(async () => container.querySelector("summary")?.click())
    const profile = container.querySelector("select") as HTMLSelectElement
    await act(async () => {
      profile.value = "profile"
      profile.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const mapping = [...container.querySelectorAll("summary")]
      .find((summary) => summary.textContent === "Map profile names to shared wine identities")
    await act(async () => mapping?.click())
    expect(container.textContent).toContain("Bourgogne — Mâconnais")
    const regionLabel = [...container.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Shared region"))
    const search = regionLabel?.parentElement?.querySelector("button")
    await act(async () => search?.click())
    const result = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Bourgogne · region")
    await act(async () => result?.click())
    const inspect = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Preview mapping and changes")
    await act(async () => inspect?.click())
    expect(previewProfileStaging).toHaveBeenCalledWith(
      expect.anything(), "draft", { regions: { "Bourgogne — Mâconnais": "region-bourgogne" } })
  })

  it("previews a selected identity batch separately from approving drinking dates", async () => {
    vi.mocked(previewFullProfileExchange).mockReturnValue({
      kind: "producer", name: "Frantz Chagnoleau", datasetVersion: "1.1.0",
      releaseCount: 2, factCount: 0, sourceCount: 0,
      document: { producer: { name: "Frantz Chagnoleau" }, cuvees: [{
        id: "a_la_cote", name: "À la Côte", region: "Bourgogne", appellation: "Saint-Véran",
      }], exact_release_calibrations: [
        { cuvee_id: "a_la_cote", vintage: 2019, format_ml: 750 },
        { cuvee_id: "a_la_cote", vintage: 2022, format_ml: 750 },
      ] },
    })
    vi.mocked(previewProfileIdentityBatch).mockResolvedValue({
      profileId: "profile", planSha256: "a".repeat(64), status: "ready",
      producerName: "Frantz Chagnoleau", producerStatus: "existing",
      entries: [{ key: "a_la_cote|2019", cuveeId: "a_la_cote", cuveeName: "À la Côte",
        vintage: 2019, productStatus: "existing", releaseStatus: "create",
        sourceUrls: ["https://example.org/existence"], reason: null }],
    })
    vi.mocked(createProfileIdentityBatch).mockResolvedValue({
      createdProducers: 0, createdProducts: 0, createdReleases: 1,
      datesStaged: 0, winesLinked: 0, published: false,
    })
    await act(async () => root.render(<FullProfileExchangePanel isOnline />))
    await act(async () => container.querySelector("summary")?.click())
    const profile = container.querySelector("select") as HTMLSelectElement
    await act(async () => {
      profile.value = "profile"
      profile.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const identitySection = [...container.querySelectorAll("summary")]
      .find((summary) => summary.textContent === "Prepare missing shared wine identities")
    await act(async () => identitySection?.click())
    const choice = container.querySelector('.drinking-window-profile-identity-choices input[type="checkbox"]') as HTMLInputElement
    await act(async () => choice.click())
    const preview = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Preview selected identities")
    await act(async () => preview?.click())
    expect(previewProfileIdentityBatch).toHaveBeenCalledWith(expect.anything(), {}, ["a_la_cote|2019"])
    expect(container.textContent).toContain("Release existence sources to check")
    const reason = container.querySelector('.drinking-window-profile-identity-confirm')
      ?.parentElement?.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        reason, "I verified this exact synthetic wine and its cited release source.")
      reason.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const confirm = container.querySelector('.drinking-window-profile-identity-confirm input') as HTMLInputElement
    await act(async () => confirm.click())
    const create = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Create the reviewed shared identities")
    await act(async () => create?.click())
    expect(createProfileIdentityBatch).toHaveBeenCalledWith(expect.anything(), {},
      ["a_la_cote|2019"], expect.anything(),
      "I verified this exact synthetic wine and its cited release source.", true)
    expect(stageProfileExchange).not.toHaveBeenCalled()
    expect(container.textContent).toContain("No dates were approved and no cellar wine was linked")
  })

  it("keeps an appellation choice specific to the selected vintage", async () => {
    vi.mocked(previewFullProfileExchange).mockReturnValue({
      kind: "producer", name: "Example producer", datasetVersion: "1.1.0",
      releaseCount: 2, factCount: 0, sourceCount: 0,
      document: { producer: { name: "Example producer" }, cuvees: [{ id: "red", name: "Rouge" }],
        exact_release_calibrations: [
          { cuvee_id: "red", vintage: 2002, format_ml: 750 },
          { cuvee_id: "red", vintage: 2018, format_ml: 750 },
        ] },
    })
    vi.mocked(previewProfileIdentityBatch).mockResolvedValue({
      profileId: "profile", planSha256: "a".repeat(64), status: "blocked",
      producerName: "Example producer", producerStatus: "existing",
      entries: [{ key: "red|2002", cuveeId: "red", cuveeName: "Rouge", vintage: 2002,
        productStatus: "existing", releaseStatus: "blocked", sourceUrls: [],
        reason: "Appellation has no unique canonical identity in this region" }],
    })
    vi.mocked(searchCurationTargets).mockResolvedValue([
      { id: "appellation-2002", label: "IGP Hérault", detail: "Languedoc" },
    ])
    await act(async () => root.render(<FullProfileExchangePanel isOnline />))
    await act(async () => container.querySelector("summary")?.click())
    const profile = container.querySelector("select") as HTMLSelectElement
    await act(async () => { profile.value = "profile"; profile.dispatchEvent(new Event("change", { bubbles: true })) })
    await act(async () => [...container.querySelectorAll("summary")]
      .find((summary) => summary.textContent === "Prepare missing shared wine identities")?.click())
    await act(async () => (container.querySelector('.drinking-window-profile-identity-choices input') as HTMLInputElement).click())
    const preview = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Preview selected identities")
    await act(async () => preview?.click())
    const vintageDetails = [...container.querySelectorAll("summary")]
      .find((summary) => summary.textContent === "Choose the appellation for this vintage")
    await act(async () => vintageDetails?.click())
    const search = vintageDetails?.parentElement?.querySelector("input") as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "Hérault")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => [...(vintageDetails?.parentElement?.querySelectorAll("button") || [])]
      .find((button) => button.textContent === "Search canonical identities")?.click())
    await act(async () => [...(vintageDetails?.parentElement?.querySelectorAll("button") || [])]
      .find((button) => button.textContent?.includes("IGP Hérault"))?.click())
    await act(async () => preview?.click())
    expect(previewProfileIdentityBatch).toHaveBeenLastCalledWith(expect.anything(),
      { release_appellations: { "red|2002": "appellation-2002" } }, ["red|2002"])
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

  it("lets a curator narrow a blocked identity batch without approving dates", async () => {
    vi.mocked(previewFullProfileExchange).mockReturnValue({
      kind: "producer", name: "Frantz Chagnoleau", datasetVersion: "1.1.0",
      releaseCount: 2, factCount: 0, sourceCount: 0,
      document: { producer: { name: "Frantz Chagnoleau" },
        cuvees: [{ id: "a_la_cote", name: "À la Côte", region: "Bourgogne", appellation: "Saint-Véran" }],
        exact_release_calibrations: [
          { cuvee_id: "a_la_cote", vintage: 2019, format_ml: 750 },
          { cuvee_id: "a_la_cote", vintage: 2022, format_ml: 750 },
        ] },
    })
    vi.mocked(previewProfileIdentityBatch).mockResolvedValueOnce({
      profileId: "profile", planSha256: "a".repeat(64), status: "blocked",
      producerName: "Frantz Chagnoleau", producerStatus: "existing",
      entries: [
        { key: "a_la_cote|2019", cuveeId: "a_la_cote", cuveeName: "À la Côte", vintage: 2019,
          productStatus: "existing", releaseStatus: "existing", sourceUrls: [], reason: null },
        { key: "a_la_cote|2022", cuveeId: "a_la_cote", cuveeName: "À la Côte", vintage: 2022,
          productStatus: "blocked", releaseStatus: "blocked", sourceUrls: [],
          reason: "Release existence needs a source pointer" },
      ],
    }).mockResolvedValueOnce({
      profileId: "profile", planSha256: "b".repeat(64), status: "ready",
      producerName: "Frantz Chagnoleau", producerStatus: "existing",
      entries: [{ key: "a_la_cote|2019", cuveeId: "a_la_cote", cuveeName: "À la Côte", vintage: 2019,
        productStatus: "existing", releaseStatus: "existing", sourceUrls: [], reason: null }],
    })
    await act(async () => root.render(<FullProfileExchangePanel isOnline />))
    await act(async () => container.querySelector("summary")?.click())
    const profile = container.querySelector("select") as HTMLSelectElement
    await act(async () => {
      profile.value = "profile"
      profile.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const identitySection = [...container.querySelectorAll("summary")]
      .find((summary) => summary.textContent === "Prepare missing shared wine identities")
    await act(async () => identitySection?.click())
    const selectAll = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Select all for identity review (not approval)")
    await act(async () => selectAll?.click())
    const preview = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Preview selected identities")
    await act(async () => preview?.click())
    const narrow = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Keep only unblocked identities, then preview again")
    expect(narrow).toBeTruthy()
    await act(async () => narrow?.click())
    await act(async () => preview?.click())
    expect(previewProfileIdentityBatch).toHaveBeenNthCalledWith(2, expect.anything(), {}, ["a_la_cote|2019"])
    expect(stageProfileExchange).not.toHaveBeenCalled()
  })
})
