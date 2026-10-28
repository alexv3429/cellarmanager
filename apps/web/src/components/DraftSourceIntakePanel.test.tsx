// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getSourceIntakes, reviewSourceIntake, submitSourceIntake } from "../data/drinkingWindowSourceIntake"
import { changeDraftRowEvidence } from "../data/drinkingWindowDraftCorrections"
import { DraftSourceIntakePanel } from "./DraftSourceIntakePanel"

vi.mock("../data/drinkingWindowSourceIntake", () => ({
  getSourceIntakes: vi.fn(), submitSourceIntake: vi.fn(), reviewSourceIntake: vi.fn(),
}))
vi.mock("../data/drinkingWindowDraftCorrections", () => ({ changeDraftRowEvidence: vi.fn() }))

const item = {
  id: "intake", sourceName: "Producer page", sourceKind: "producer" as const,
  sourceUrl: "https://example.org/wine", claimNote: "Dates printed in the table.",
  rightsEvidenceUrl: "https://example.org/terms", rightsNote: "Terms checked for factual citation.",
  firstTrialYear: 2025, bestStartYear: 2028, bestEndYear: 2040,
  rowHash: "a".repeat(64), status: "pending" as const,
  submittedAt: "2026-10-28T14:00:00Z", reviewNote: null, evidenceId: null,
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getSourceIntakes).mockReset().mockResolvedValue([item])
  vi.mocked(submitSourceIntake).mockReset().mockResolvedValue("intake")
  vi.mocked(reviewSourceIntake).mockReset().mockResolvedValue({ status: "approved", evidenceId: "evidence" })
  vi.mocked(changeDraftRowEvidence).mockReset().mockResolvedValue("b".repeat(64))
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("source verification UI", () => {
  it("requires both checks and an explanation before approval, without auto-linking", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(<DraftSourceIntakePanel versionId="version" rowId="row"
      rowHash={item.rowHash} linkedEvidenceIds={[]} isOnline onChanged={onChanged} />))
    const open = [...container.querySelectorAll("button")].find((button) => button.textContent === "Review this source")!
    await act(async () => open.click())
    const verify = [...container.querySelectorAll("button")].find((button) => button.textContent === "Verify this source")!
    expect(verify.disabled).toBe(true)
    const checks = [...container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    await act(async () => { checks[0].click(); checks[1].click() })
    const note = container.querySelector('.drinking-window-source-review textarea') as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(note,
        "All three dates and the reuse rights were checked.")
      note.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(verify.disabled).toBe(false)
    await act(async () => verify.click())
    expect(reviewSourceIntake).toHaveBeenCalledWith(expect.objectContaining({
      verdict: "approve", datesChecked: true, rightsChecked: true, expectedHash: item.rowHash,
    }))
    expect(onChanged).toHaveBeenCalledOnce()
    expect(changeDraftRowEvidence).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Link it to the draft window below")
  })

  it("links an approved source only after a separate click", async () => {
    vi.mocked(getSourceIntakes).mockResolvedValue([{ ...item, status: "approved", evidenceId: "evidence" }])
    const onChanged = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(<DraftSourceIntakePanel versionId="version" rowId="row"
      rowHash={item.rowHash} linkedEvidenceIds={[]} isOnline onChanged={onChanged} />))
    const link = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Link this verified source to the draft")!
    await act(async () => link.click())
    expect(changeDraftRowEvidence).toHaveBeenCalledWith(expect.objectContaining({
      versionId: "version", rowId: "row", action: "attach", evidenceId: "evidence",
      expectedHash: item.rowHash,
    }))
    expect(onChanged).toHaveBeenCalledOnce()
  })
})
