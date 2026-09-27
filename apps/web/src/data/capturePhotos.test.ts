import { beforeEach, describe, expect, it, vi } from "vitest"

const { rpc, upload, remove, getSession } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock("./supabase", () => ({
  supabase: {
    auth: { getSession },
    rpc,
    storage: { from: () => ({ upload, remove }) },
  },
}))

import {
  CAPTURE_PHOTO_MAX_BYTES,
  listCapturePhotoSessions,
  listPreparedCapturePhotos,
  processCapturePhotoSession,
  uploadCapturePhotos,
  validateCapturePhotoFiles,
} from "./capturePhotos"

const sessionId = "550e8400-e29b-41d4-a716-446655440000"
const objectName = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockResolvedValue({ data: { path: objectName }, error: null })
  remove.mockResolvedValue({ data: [], error: null })
  getSession.mockResolvedValue({ data: { session: { access_token: "session-token" } }, error: null })
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
    const preparedFile = new File([new Uint8Array([7, 8, 9])], "capture.jpg", { type: "image/jpeg" })
    const prepareImage = vi.fn().mockResolvedValue(preparedFile)
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "processed" }))

    await expect(uploadCapturePhotos("household-1", [file], {
      accessToken: "session-token",
      prepareImage,
      fetch: fetcher,
    })).resolves.toEqual({ sessionId, status: "processed" })

    expect(rpc).toHaveBeenNthCalledWith(1, "create_capture_session", {
      p_household_id: "household-1",
      p_assets: [{ content_type: "image/jpeg", size_bytes: 3 }],
    })
    expect(prepareImage).toHaveBeenCalledWith(file)
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
    expect(fetcher).toHaveBeenCalledWith("/api/capture/process", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer session-token" },
      body: JSON.stringify({ sessionId }),
    }))
  })

  it("lists processing and processed states while withholding keys from summaries", async () => {
    rpc.mockResolvedValueOnce({ data: [
      { session_id: sessionId, state: "processing", created_at: "2026-09-27T10:00:00Z", expires_at: "2026-09-28T10:00:00Z", photo_count: 1 },
      { session_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", state: "processed", created_at: "2026-09-27T09:00:00Z", expires_at: "2026-09-28T09:00:00Z", photo_count: 1 },
    ], error: null })
    await expect(listCapturePhotoSessions("household-1")).resolves.toMatchObject([
      { sessionId, state: "processing" },
      { state: "processed" },
    ])
  })

  it("requests authenticated preparation and downloads only the processed opaque key", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "processing" }, { status: 202 }))
    await expect(processCapturePhotoSession(sessionId, { accessToken: "session-token", fetch: fetcher })).resolves.toBe("processing")
    expect(fetcher).toHaveBeenCalledWith("/api/capture/process", expect.objectContaining({
      headers: { "content-type": "application/json", authorization: "Bearer session-token" },
    }))

    rpc.mockResolvedValueOnce({ data: [{ object_name: objectName, content_type: "image/jpeg", size_bytes: 4 }], error: null })
    const previewFetcher = vi.fn().mockResolvedValue(new Response("jpeg", {
      headers: { "cache-control": "no-store, max-age=0", "content-type": "image/jpeg" },
    }))
    await expect(listPreparedCapturePhotos(sessionId, {
      accessToken: "session-token",
      fetch: previewFetcher,
    })).resolves.toMatchObject([
      { objectName, blob: { type: "image/jpeg", size: 4 } },
    ])
    expect(previewFetcher).toHaveBeenCalledWith("/api/capture/preview", expect.objectContaining({
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", authorization: "Bearer session-token" },
      body: JSON.stringify({ sessionId, objectName }),
    }))
  })
})
