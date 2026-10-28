// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  changeDraftRowEvidence, correctDraftRow, getDraftRowCorrection,
} from "../data/drinkingWindowDraftCorrections"
import { DraftRowCorrectionEditor } from "./DraftRowCorrectionEditor"

vi.mock("../data/drinkingWindowDraftCorrections", () => ({
  getDraftRowCorrection: vi.fn(), correctDraftRow: vi.fn(), changeDraftRowEvidence: vi.fn(),
}))

const draft = {
  hash: "a".repeat(64), firstTrialYear: 2025, bestStartYear: 2028, bestEndYear: 2040,
  rationale: "A source-backed rationale for this exact release.",
  linked: [{ evidenceId: "evidence", claimPart: "first_trial", evidenceRole: "supports",
    sourceName: "Producer page", sourceUrl: "https://example.org/release",
    reviewStatus: "reviewed", reuseRight: "allowed" }],
  available: [{ evidenceId: "evidence", sourceName: "Producer page",
    sourceUrl: "https://example.org/release" }],
  history: [],
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getDraftRowCorrection).mockReset().mockResolvedValue(draft)
  vi.mocked(correctDraftRow).mockReset().mockResolvedValue("b".repeat(64))
  vi.mocked(changeDraftRowEvidence).mockReset().mockResolvedValue("c".repeat(64))
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("draft row correction screen", () => {
  it("saves a three-date correction and makes prior approval status explicit", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(<DraftRowCorrectionEditor versionId="version" rowId="row"
      subjectHash={draft.hash} isOnline onChanged={onChanged} />))
    expect(container.textContent).toContain("A submitted URL alone is not verified evidence")
    const first = container.querySelector('input[type="number"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(first, "2026")
      first.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const form = container.querySelector("form")
    await act(async () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(correctDraftRow).toHaveBeenCalledWith(expect.objectContaining({
      versionId: "version", rowId: "row", expectedHash: draft.hash,
      firstTrialYear: 2026, bestStartYear: 2028, bestEndYear: 2040,
    }))
    expect(onChanged).toHaveBeenCalledOnce()
    expect(container.textContent).toContain("Earlier approval must be reviewed again")
  })

  it("removes only an existing supporting date link", async () => {
    await act(async () => root.render(<DraftRowCorrectionEditor versionId="version" rowId="row"
      subjectHash={draft.hash} isOnline onChanged={async () => undefined} />))
    const remove = [...container.querySelectorAll("button")].find((button) => button.textContent === "Remove source link")
    await act(async () => remove?.click())
    expect(changeDraftRowEvidence).toHaveBeenCalledWith(expect.objectContaining({
      action: "remove", evidenceId: "evidence",
      expectedHash: draft.hash,
    }))
  })
})
