// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapturePhotosPanel } from "./CapturePhotosPanel"
import {
  listCaptureOcrResult,
  listCapturePhotoSessions,
  suggestCaptureWineCandidate,
  type CaptureWineSuggestion,
} from "../data/capturePhotos"
import { findCaptureWineMatchCandidates } from "../data/captureWineMatching"

vi.mock("../data/capturePhotos", () => ({
  CapturePhotoError: class CapturePhotoError extends Error {},
  CAPTURE_PREPROCESSING_LEASE_MS: 5 * 60 * 1000,
  deleteCapturePhotoSession: vi.fn(),
  isCapturePhotoPreparationStale: vi.fn(() => false),
  listCaptureOcrResult: vi.fn(),
  listPreparedCapturePhotos: vi.fn(),
  listCapturePhotoSessions: vi.fn(),
  processCapturePhotoSession: vi.fn(),
  recognizeCapturePhotoSession: vi.fn(),
  suggestCaptureWineCandidate: vi.fn(),
  validateCapturePhotoFiles: vi.fn(() => null),
  uploadCapturePhotos: vi.fn(),
}))
vi.mock("../data/captureWineMatching", () => ({ findCaptureWineMatchCandidates: vi.fn(() => []) }))

const textField = (value: string | null, evidence: string[] = []) => ({ value, evidence, confidence: "high" as const })
const suggestion: CaptureWineSuggestion = {
  producer: textField("Jean-Marc Burgaud", ["JEAN-MARC BURGAUD"]),
  cuvee: textField("Côte du Py", ["MORGON CÔTE DU PY"]),
  appellation: textField("Morgon", ["MORGON"]),
  area: textField("Beaujolais"),
  vintage: { value: 2011, status: "year", evidence: ["2011"], confidence: "high" },
  color: { value: "red", evidence: [], confidence: "low" },
  format_ml: { value: 750, evidence: [], confidence: "low" },
}
const onUseReviewedDetails = vi.fn()
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.resetAllMocks()
  vi.mocked(listCapturePhotoSessions).mockResolvedValue([{
    sessionId: "capture-1",
    state: "recognized",
    createdAt: "2026-09-29T10:00:00Z",
    expiresAt: "2026-09-30T10:00:00Z",
    processingStartedAt: null,
    photoCount: 0,
  }])
  vi.mocked(listCaptureOcrResult).mockResolvedValue({
    engine: "cloudflare",
    pages: [{ text: "JEAN-MARC BURGAUD\nMORGON CÔTE DU PY\n2011", confidence: 1 }],
  })
  vi.mocked(suggestCaptureWineCandidate).mockResolvedValue({ modelVersion: "test", suggestion })
  vi.mocked(findCaptureWineMatchCandidates).mockReturnValue([])
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function renderReview() {
  await act(async () => root.render(
    <CapturePhotosPanel householdId="household-1" isOnline userId="owner-1" wines={[]} onUseReviewedDetails={onUseReviewedDetails} />,
  ))
  await click("Review label")
  await click("Suggest wine details")
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}

describe("label review", () => {
  it("shows editable suggestions first while keeping transcript and evidence available on demand", async () => {
    await renderReview()
    expect(container.textContent).toContain("Check the wine details")
    expect(container.querySelector<HTMLInputElement>('label input[value="Jean-Marc Burgaud"]')).not.toBeNull()
    expect(container.querySelector<HTMLDetailsElement>(".capture-photos__evidence")?.open).toBe(false)
    expect(container.querySelector<HTMLDetailsElement>(".capture-photos__transcript")?.open).toBe(false)
    expect(container.querySelector<HTMLDetailsElement>(".capture-photos__more-details")?.open).toBe(false)
    expect(container.querySelector(".capture-photos__suggestion-fields .capture-photos__field-meta")).toBeNull()
    expect(container.querySelector(".capture-photos__evidence")?.textContent).toContain("JEAN-MARC BURGAUD")
    expect(container.querySelector(".capture-photos__transcript")?.textContent).toContain("MORGON CÔTE DU PY")
    expect(suggestCaptureWineCandidate).toHaveBeenCalledExactlyOnceWith("capture-1")
    expect(onUseReviewedDetails).not.toHaveBeenCalled()

    await click("Continue to add bottles")
    expect(onUseReviewedDetails).toHaveBeenCalledExactlyOnceWith({
      producer: "Jean-Marc Burgaud",
      cuvee: "Côte du Py",
      vintage: 2011,
      color: "red",
      appellation: "Morgon",
      area: "Beaujolais",
      formatMl: 750,
    })
  })

  it("offers a catalogue match before the label form but never chooses it automatically", async () => {
    vi.mocked(findCaptureWineMatchCandidates).mockReturnValue([{
      wine: {
        id: "wine-1", household_id: "household-1", producer: "Jean-Marc Burgaud", cuvee: "Côte du Py",
        vintage: 2011, color: "red", appellation: "Morgon", area: "Beaujolais", format_ml: 750,
      },
      producerSimilarity: 1, cuveeSimilarity: 1, supportingFields: ["vintage"],
    }])
    await renderReview()
    const review = container.querySelector(".capture-photos__suggestion")!
    expect(review.querySelector(".capture-photos__matches")).not.toBeNull()
    expect(review.querySelector(".capture-photos__matches")!.compareDocumentPosition(review.querySelector(".capture-photos__suggestion-fields")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(onUseReviewedDetails).not.toHaveBeenCalled()

    await click("Continue with this wine")
    expect(onUseReviewedDetails).toHaveBeenCalledExactlyOnceWith({
      producer: "Jean-Marc Burgaud", cuvee: "Côte du Py", vintage: 2011,
      color: "red", appellation: "Morgon", area: "Beaujolais", formatMl: 750,
    })
  })

  it("requires a producer and cuvée and uses the Owner's corrections", async () => {
    vi.mocked(suggestCaptureWineCandidate).mockResolvedValue({
      modelVersion: "test",
      suggestion: { ...suggestion, producer: textField(null) },
    })
    await renderReview()
    const continueButton = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Continue to add bottles")!
    expect(continueButton.disabled).toBe(true)
    expect(onUseReviewedDetails).not.toHaveBeenCalled()

    const producer = container.querySelector<HTMLInputElement>('.capture-photos__suggestion-fields label input[value=""]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(producer, "Corrected producer")
      producer.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(continueButton.disabled).toBe(false)
    await click("Continue to add bottles")
    expect(onUseReviewedDetails).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ producer: "Corrected producer" }))
    expect(container.querySelector(".capture-photos__evidence")?.textContent).toContain("No supporting label text")
  })
})
