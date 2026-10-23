// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getHouseholdAgeingGroupReview,
  manageHouseholdAgeingGroupChoice,
} from "../data/householdAgeingGroups"
import { WineAgeingGroupReviewPanel } from "./WineAgeingGroupReviewPanel"

vi.mock("../data/householdAgeingGroups", () => ({
  getHouseholdAgeingGroupReview: vi.fn(),
  manageHouseholdAgeingGroupChoice: vi.fn(),
}))

const review = {
  wineId: "wine-1", contextStatus: "ready", sourceFingerprint: "fingerprint",
  versions: [{ versionId: "version-1", versionNumber: 1, versionStatus: "draft" as const,
    groups: [{ groupId: "group-1", scope: "region" as const, groupKey: "long-ageing",
      definition: "Reviewed long-ageing wine", firstTrialYear: 2025,
      bestStartYear: 2028, bestEndYear: 2035 }],
    choices: [] }],
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getHouseholdAgeingGroupReview).mockReset().mockResolvedValue(review)
  vi.mocked(manageHouseholdAgeingGroupChoice).mockReset().mockResolvedValue()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function choose(value: string) {
  const select = container.querySelector("select")
  await act(async () => {
    if (select) select.value = value
    select?.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("wine ageing-group review panel", () => {
  it("saves a deliberate local group without publishing a draft", async () => {
    const onChanged = vi.fn()
    await act(async () => root.render(<WineAgeingGroupReviewPanel
      isOnline onChanged={onChanged} revision={0} wineId="wine-1" />))
    expect(container.textContent).toContain("Your choice does not enable shared dates")
    await choose("group-1")
    expect(container.textContent).toContain("Reviewed long-ageing wine")
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Save my choice"))
    await act(async () => save?.click())
    expect(manageHouseholdAgeingGroupChoice).toHaveBeenCalledWith(
      "wine-1", "version-1", "region", "select", "group-1", "fingerprint", null,
    )
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it("can explicitly exclude a scope instead of guessing a default group", async () => {
    await act(async () => root.render(<WineAgeingGroupReviewPanel
      isOnline onChanged={vi.fn()} revision={0} wineId="wine-1" />))
    await choose("unclassified")
    expect(container.textContent).toContain("Group-specific dates at this scope will not apply")
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Save my choice"))
    await act(async () => save?.click())
    expect(manageHouseholdAgeingGroupChoice).toHaveBeenCalledWith(
      "wine-1", "version-1", "region", "unclassified", null, "fingerprint", null,
    )
  })
})
