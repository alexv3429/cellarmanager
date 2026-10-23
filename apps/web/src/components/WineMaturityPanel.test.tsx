// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getWineMaturity, setWineMaturityOverride, supportsThreeMilestoneManualOverrides, type WineMaturity } from "../data/wineMaturity"
import { getProfileReviewInbox, getWineProfileReviewTargets } from "../data/profileReviews"
import { WineMaturityPanel } from "./WineMaturityPanel"

vi.mock("../data/wineMaturity", async (importOriginal) => ({
  ...await importOriginal<typeof import("../data/wineMaturity")>(),
  getWineMaturity: vi.fn(),
  setWineMaturityOverride: vi.fn(),
  supportsThreeMilestoneManualOverrides: vi.fn(),
}))
vi.mock("../data/profileReviews", async (importOriginal) => ({
  ...await importOriginal<typeof import("../data/profileReviews")>(),
  getProfileReviewInbox: vi.fn(),
  getWineProfileReviewTargets: vi.fn(),
}))

function maturity(drinkByYear: number | null, hasOverride: boolean): WineMaturity {
  return {
    assessmentReason: null,
    calibration: null,
    demandStatus: null,
    effectiveSource: hasOverride ? "manual" : "reviewed_reference",
    feedback: null,
    override: hasOverride ? {
      bestEndYear: 2035,
      bestStartYear: 2028,
      drinkByYear,
      firstTrialYear: 2025,
      note: null,
      storagePurpose: null,
      updatedAt: "2026-10-23T10:00:00Z",
    } : null,
    projection: null,
    reference: {
      bestEndYear: 2035,
      bestStartYear: 2028,
      firstTrialYear: 2025,
      matchedScope: "release",
      rationale: "Owner-reviewed estimate",
      referenceRowId: "reference-row",
      versionNumber: 1,
    },
    referenceStatus: null,
    wineId: "wine-1",
  }
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getProfileReviewInbox).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof getProfileReviewInbox>>)
  vi.mocked(getWineProfileReviewTargets).mockResolvedValue([])
  vi.mocked(setWineMaturityOverride).mockResolvedValue(maturity(null, true))
  vi.mocked(supportsThreeMilestoneManualOverrides).mockResolvedValue(true)
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

describe("wine maturity manual window", () => {
  it("shows three required milestones without inventing a fourth date", async () => {
    vi.mocked(getWineMaturity).mockResolvedValue(maturity(null, false))
    await act(async () => root.render(<WineMaturityPanel canManageCellar householdId="household-1" isOnline wineId="wine-1" />))

    const window = container.querySelector(".wine-maturity__window")
    expect(window?.querySelectorAll("dd")).toHaveLength(3)
    expect(window?.textContent).toContain("Start tasting")
    expect(window?.textContent).toContain("Probable optimal period starts")
    expect(window?.textContent).toContain("Probable optimal period ends")
    expect(container.querySelector('input[name="drinkByYear"]')).toBeNull()
  })

  it("keeps a legacy personal fourth year visible and explicitly clearable", async () => {
    vi.mocked(getWineMaturity).mockResolvedValue(maturity(2040, true))
    await act(async () => root.render(<WineMaturityPanel canManageCellar householdId="household-1" isOnline wineId="wine-1" />))

    expect(container.textContent).toContain("Previously recorded personal drink-by year: 2040")
    const legacyInput = container.querySelector('input[name="drinkByYear"]') as HTMLInputElement
    expect(legacyInput.value).toBe("2040")
    expect(container.querySelectorAll(".wine-maturity__window dd")).toHaveLength(3)

    legacyInput.value = ""
    const form = legacyInput.closest("form") as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    expect(setWineMaturityOverride).toHaveBeenCalledWith(
      "wine-1",
      { firstTrialYear: 2025, bestStartYear: 2028, bestEndYear: 2035, drinkByYear: null },
      null,
      "",
    )
  })

  it("keeps the required fourth field on a database that has not migrated", async () => {
    vi.mocked(supportsThreeMilestoneManualOverrides).mockResolvedValue(false)
    vi.mocked(getWineMaturity).mockResolvedValue(maturity(2040, true))
    await act(async () => root.render(<WineMaturityPanel canManageCellar householdId="household-1" isOnline wineId="wine-1" />))

    const legacyInput = container.querySelector('input[name="drinkByYear"]') as HTMLInputElement
    expect(legacyInput.required).toBe(true)
    expect(legacyInput.value).toBe("2040")
    expect(container.textContent).toContain("The three-date editor is not active in this cellar yet")

    const form = legacyInput.closest("form") as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    expect(setWineMaturityOverride).toHaveBeenCalledWith(
      "wine-1",
      { firstTrialYear: 2025, bestStartYear: 2028, bestEndYear: 2035, drinkByYear: 2040 },
      null,
      "",
    )
  })
})
