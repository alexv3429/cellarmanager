import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

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
  validateCapturePhotoFiles: vi.fn(() => null),
  uploadCapturePhotos: vi.fn(),
}))

import { CapturePhotosPanel } from "./CapturePhotosPanel"

describe("capture photo panel", () => {
  it("asks for photo consent before offering camera or upload actions", () => {
    const html = renderToStaticMarkup(
      <CapturePhotosPanel householdId="household-1" isOnline userId="owner-1" wines={[]} onUseReviewedDetails={() => undefined} />,
    )

    expect(html).toContain("Add wine from a label")
    expect(html).toContain("Photo privacy details")
    expect(html).toContain("Before using a label photo")
    expect(html).toContain("one bottle at a time")
    expect(html).toContain("external AI service")
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain("<img")
    expect(html).not.toContain("private-cellar-photo")
  })

  it("makes photo inputs unavailable while offline", () => {
    const html = renderToStaticMarkup(
      <CapturePhotosPanel householdId="household-1" isOnline={false} userId="owner-1" wines={[]} onUseReviewedDetails={() => undefined} />,
    )

    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(1)
    expect(html).toContain("Photos are not queued offline")
  })
})
