// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapturePhotosPanel } from "./CapturePhotosPanel"
import {
  listCaptureOcrResult,
  listCapturePhotoSessions,
  recognizeCapturePhotoSession,
  suggestCaptureWineCandidate,
  uploadCapturePhotos,
  type CaptureWineSuggestion,
} from "../data/capturePhotos"
import { findCaptureWineCrossRoleMatch, findCaptureWineMatchCandidates, findCaptureWineMatchesFromTranscript, findCatalogueAppellationSpelling } from "../data/captureWineMatching"

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
vi.mock("../data/captureWineMatching", async (importOriginal) => ({
  enrichCaptureWineSuggestion: (await importOriginal<typeof import("../data/captureWineMatching")>()).enrichCaptureWineSuggestion,
  findCaptureWineMatchCandidates: vi.fn(() => []),
  findCaptureWineMatchesFromTranscript: vi.fn(() => []),
  findCatalogueAppellationSpelling: vi.fn(() => null),
  findCaptureWineCrossRoleMatch: vi.fn(() => null),
}))

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
  window.localStorage.clear()
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
  vi.mocked(findCaptureWineMatchesFromTranscript).mockReturnValue([])
  vi.mocked(findCatalogueAppellationSpelling).mockReturnValue(null)
  vi.mocked(findCaptureWineCrossRoleMatch).mockReturnValue(null)
  vi.mocked(uploadCapturePhotos).mockResolvedValue({ sessionId: "capture-1", status: "processed" })
  vi.mocked(recognizeCapturePhotoSession).mockResolvedValue({
    state: "recognized", engine: "cloudflare",
    pages: [{ text: "JEAN-MARC BURGAUD\nMORGON CÔTE DU PY\n2011", confidence: 0 }],
  })
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
  await click("I understand — continue with photos")
  await click("Review label")
  await click("Suggest wine details")
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}

async function choosePhoto() {
  const input = container.querySelector<HTMLInputElement>('.capture-photos__picker input[type="file"]')!
  expect(input).not.toBeNull()
  const file = new File(["image"], "label.jpg", { type: "image/jpeg" })
  Object.defineProperty(input, "files", { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })))
}

describe("label review", () => {
  it("remembers photo acknowledgement for one account on this device, not another account", async () => {
    await act(async () => root.render(
      <CapturePhotosPanel householdId="household-1" isOnline userId="owner-1" wines={[]} onUseReviewedDetails={onUseReviewedDetails} />,
    ))
    await click("I understand — continue with photos")
    expect(window.localStorage.getItem("cellarmanager:photo-reading-consent:v1:owner-1")).toBe("accepted")
    expect(container.querySelector('input[type="file"]')).not.toBeNull()

    await act(async () => root.render(
      <CapturePhotosPanel householdId="household-1" isOnline userId="owner-2" wines={[]} onUseReviewedDetails={onUseReviewedDetails} />,
    ))
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(container.textContent).toContain("Before using a label photo")
  })

  it("starts reading and suggesting after one photo choice, with no repeated confirmation", async () => {
    await act(async () => root.render(
      <CapturePhotosPanel householdId="household-1" isOnline userId="owner-1" wines={[]} onUseReviewedDetails={onUseReviewedDetails} />,
    ))
    expect(container.querySelector('input[type="file"]')).toBeNull()
    await click("I understand — continue with photos")
    expect(container.textContent).toContain("front and back labels of the same bottle")
    expect(container.querySelector('input[capture="environment"]')).not.toBeNull()
    expect(container.querySelector('input[multiple]')).not.toBeNull()

    await choosePhoto()
    expect(uploadCapturePhotos).toHaveBeenCalledTimes(1)
    expect(recognizeCapturePhotoSession).toHaveBeenCalledExactlyOnceWith("capture-1")
    expect(suggestCaptureWineCandidate).toHaveBeenCalledExactlyOnceWith("capture-1")
    expect(container.textContent).toContain("Check the wine details")
    expect(onUseReviewedDetails).not.toHaveBeenCalled()
  })

  it("offers a transcript match without paying for field inference", async () => {
    vi.mocked(findCaptureWineMatchesFromTranscript).mockReturnValue([{
      id: "barraud", household_id: "household-1", producer: "Domaine Barraud", cuvee: "En France",
      appellation: "Pouilly-Fuissé", area: "Bourgogne", vintage: 2019, color: "white", format_ml: 750,
    }])
    await act(async () => root.render(
      <CapturePhotosPanel householdId="household-1" isOnline userId="owner-1" wines={[]} onUseReviewedDetails={onUseReviewedDetails} />,
    ))
    await click("I understand — continue with photos")
    await choosePhoto()
    expect(suggestCaptureWineCandidate).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Domaine Barraud — En France")
    await click("Continue with this wine")
    expect(onUseReviewedDetails).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      producer: "Domaine Barraud", cuvee: "En France", appellation: "Pouilly-Fuissé", vintage: 2019,
    }))
  })

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

  it("shows a reviewed appellation spelling correction without hiding the OCR reading", async () => {
    vi.mocked(suggestCaptureWineCandidate).mockResolvedValue({
      modelVersion: "test",
      suggestion: { ...suggestion, appellation: textField("POULILLY-FUISSE", ["POULILLY-FUISSE"]) },
    })
    await renderReview()
    expect(container.querySelector<HTMLInputElement>('label input[value="Pouilly-Fuissé"]')).not.toBeNull()
    expect(container.textContent).toContain("Spelling adjusted using reviewed appellation names (OCR: “POULILLY-FUISSE”).")
    await click("Continue to add bottles")
    expect(onUseReviewedDetails).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ appellation: "Pouilly-Fuissé" }))
  })

  it("shows saved wine details ahead of misclassified OCR fields", async () => {
    const known = {
      id: "barraud", household_id: "household-1", producer: "Domaine Barraud", cuvee: "En France",
      appellation: "Pouilly-Fuissé", area: "Bourgogne", vintage: 2019, color: "white", format_ml: 750,
    }
    vi.mocked(suggestCaptureWineCandidate).mockResolvedValue({
      modelVersion: "test",
      suggestion: {
        ...suggestion,
        producer: textField("Domaine Barraud"),
        cuvee: textField("POULILLY-FUISSE"),
        appellation: textField("POULILLY-FUISSE"),
        area: textField("En France"),
        vintage: { value: 2019, status: "year", evidence: ["2019"], confidence: "high" },
        color: { value: null, evidence: [], confidence: "low" },
      },
    })
    vi.mocked(findCaptureWineCrossRoleMatch).mockReturnValue(known)
    await renderReview()
    expect(container.querySelector(".capture-photos__matches")?.textContent).toContain("Bourgogne")
    expect(container.querySelector(".capture-photos__matches")?.textContent).toContain("White")
    expect(container.querySelector<HTMLInputElement>('label input[value="Pouilly-Fuissé"]')).not.toBeNull()
    expect(container.textContent).toContain("Spelling adjusted using reviewed appellation names (OCR: “POULILLY-FUISSE”).")
    expect(container.querySelector<HTMLSelectElement>('.capture-photos__suggestion-fields select')?.value).toBe("year")
    expect(container.querySelectorAll<HTMLSelectElement>('.capture-photos__suggestion-fields select')[1]?.value).toBe("white")
    expect(container.querySelector<HTMLInputElement>('label input[value="Bourgogne"]')).not.toBeNull()
    await click("Continue to add bottles")
    expect(onUseReviewedDetails).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      color: "white", appellation: "Pouilly-Fuissé", area: "Bourgogne", cuvee: "En France",
    }))
    onUseReviewedDetails.mockClear()

    await click("Continue with this wine")
    expect(onUseReviewedDetails).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      producer: "Domaine Barraud", cuvee: "En France", appellation: "Pouilly-Fuissé",
      area: "Bourgogne", vintage: 2019, color: "white",
    }))
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
