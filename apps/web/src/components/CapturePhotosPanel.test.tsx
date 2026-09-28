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
  it("offers clear camera and existing-photo actions without exposing filenames", () => {
    const html = renderToStaticMarkup(
      <CapturePhotosPanel householdId="household-1" isOnline userId="owner-1" />,
    )

    expect(html).toContain("Capture label photos")
    expect(html).toContain('accept="image/jpeg,image/png,.jpg,.jpeg,.png"')
    expect(html).toContain('capture="environment"')
    expect(html).toContain("Choose existing photos")
    expect(html).toContain("photo library or Files")
    expect(html).toContain('multiple=""')
    expect(html).toContain("prepared photos are sent to Cloudflare Workers AI")
    expect(html).toContain("does not use submissions to train or improve models")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("private-cellar-photo")
  })

  it("makes photo inputs unavailable while offline", () => {
    const html = renderToStaticMarkup(
      <CapturePhotosPanel householdId="household-1" isOnline={false} userId="owner-1" />,
    )

    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain("Photos are not queued offline")
  })
})
