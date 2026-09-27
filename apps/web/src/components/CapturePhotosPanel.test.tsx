import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("../data/capturePhotos", () => ({
  CapturePhotoError: class CapturePhotoError extends Error {},
  deleteCapturePhotoSession: vi.fn(),
  listCaptureOcrResult: vi.fn(),
  listPreparedCapturePhotos: vi.fn(),
  listCapturePhotoSessions: vi.fn(),
  processCapturePhotoSession: vi.fn(),
  saveCaptureOcrResult: vi.fn(),
  validateCapturePhotoFiles: vi.fn(() => null),
  uploadCapturePhotos: vi.fn(),
}))

import { CapturePhotosPanel } from "./CapturePhotosPanel"

describe("capture photo panel", () => {
  it("offers camera and file selection without previewing or exposing filenames", () => {
    const html = renderToStaticMarkup(
      <CapturePhotosPanel householdId="household-1" isOnline userId="owner-1" />,
    )

    expect(html).toContain("Capture label photos")
    expect(html).toContain('accept="image/jpeg,image/png"')
    expect(html).toContain('capture="environment"')
    expect(html).toContain("Text recognition runs on this device")
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
