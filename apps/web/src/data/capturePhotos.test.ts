import { beforeEach, describe, expect, it, vi } from "vitest"

const { rpc, upload, remove } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}))

vi.mock("./supabase", () => ({
  supabase: {
    rpc,
    storage: { from: () => ({ upload, remove }) },
  },
}))

import {
  CAPTURE_PHOTO_MAX_BYTES,
  uploadCapturePhotos,
  validateCapturePhotoFiles,
} from "./capturePhotos"

const sessionId = "550e8400-e29b-41d4-a716-446655440000"
const objectName = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockResolvedValue({ data: { path: objectName }, error: null })
  remove.mockResolvedValue({ data: [], error: null })
})

describe("temporary label photo upload", () => {
  it("accepts only one or two JPEG/PNG files up to the cap", () => {
    const jpeg = new File([new Uint8Array([1])], "label-front.jpg", { type: "image/jpeg" })
    const png = new File([new Uint8Array([1])], "label-back.png", { type: "image/png" })
    const wrongType = new File([new Uint8Array([1])], "label.svg", { type: "image/svg+xml" })
    const oversized = new File([new Uint8Array(CAPTURE_PHOTO_MAX_BYTES + 1)], "large.jpg", { type: "image/jpeg" })

    expect(validateCapturePhotoFiles([jpeg])).toBeNull()
    expect(validateCapturePhotoFiles([jpeg, png])).toBeNull()
    expect(validateCapturePhotoFiles([])).toBe("invalid")
    expect(validateCapturePhotoFiles([jpeg, png, jpeg])).toBe("invalid")
    expect(validateCapturePhotoFiles([wrongType])).toBe("invalid")
    expect(validateCapturePhotoFiles([oversized])).toBe("invalid")
  })

  it("uses server-generated exact keys and does not send original filenames", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "private-cellar-photo.jpg", { type: "image/jpeg" })
    rpc.mockResolvedValueOnce({ data: {
      session_id: sessionId,
      expires_at: "2026-10-03T12:00:00.000Z",
      objects: [{ object_name: objectName, content_type: "image/jpeg" }],
    }, error: null })
    rpc.mockResolvedValueOnce({ data: { state: "ready" }, error: null })

    await uploadCapturePhotos("household-1", [file])

    expect(rpc).toHaveBeenNthCalledWith(1, "create_capture_session", {
      p_household_id: "household-1",
      p_assets: [{ content_type: "image/jpeg", size_bytes: 3 }],
    })
    expect(upload).toHaveBeenCalledWith(objectName, expect.objectContaining({
      name: "capture.jpg",
      type: "image/jpeg",
      lastModified: 0,
    }), {
      cacheControl: "0",
      contentType: "image/jpeg",
      upsert: false,
    })
    expect(upload.mock.calls[0]?.[1]).not.toBe(file)
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(file.name)
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_capture_session", { p_session_id: sessionId })
  })
})
