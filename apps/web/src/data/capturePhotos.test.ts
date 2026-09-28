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
  CAPTURE_PREPROCESSING_LEASE_MS,
  CAPTURE_PHOTO_MAX_BYTES,
  isCapturePhotoPreparationStale,
  listCaptureOcrResult,
  listCapturePhotoSessions,
  listPreparedCapturePhotos,
  processCapturePhotoSession,
  recognizeCapturePhotoSession,
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
  it("allows a retry only after the server-side preparation lease expires", () => {
    const session = {
      state: "processing" as const,
      processingStartedAt: "2026-09-28T10:00:00.000Z",
      expiresAt: "2026-09-29T10:00:00.000Z",
    }
    expect(isCapturePhotoPreparationStale(session, Date.parse(session.processingStartedAt) + CAPTURE_PREPROCESSING_LEASE_MS - 1)).toBe(false)
    expect(isCapturePhotoPreparationStale(session, Date.parse(session.processingStartedAt) + CAPTURE_PREPROCESSING_LEASE_MS)).toBe(true)
    expect(isCapturePhotoPreparationStale({ ...session, expiresAt: session.processingStartedAt }, Date.parse(session.processingStartedAt) + CAPTURE_PREPROCESSING_LEASE_MS)).toBe(false)
    expect(isCapturePhotoPreparationStale({ ...session, state: "ready" }, Date.parse(session.processingStartedAt) + CAPTURE_PREPROCESSING_LEASE_MS)).toBe(false)
  })

  it("accepts one or two files up to the cap and defers format checks to byte inspection", () => {
    const jpeg = new File([new Uint8Array([1])], "label-front.jpg", { type: "image/jpeg" })
    const png = new File([new Uint8Array([1])], "label-back.png", { type: "image/png" })
    const wrongType = new File([new Uint8Array([1])], "label.svg", { type: "image/svg+xml" })
    const oversized = new File([new Uint8Array(CAPTURE_PHOTO_MAX_BYTES + 1)], "large.jpg", { type: "image/jpeg" })

    expect(validateCapturePhotoFiles([jpeg])).toBeNull()
    expect(validateCapturePhotoFiles([jpeg, png])).toBeNull()
    expect(validateCapturePhotoFiles([])).toBe("invalid")
    expect(validateCapturePhotoFiles([jpeg, png, jpeg])).toBe("count")
    expect(validateCapturePhotoFiles([wrongType])).toBeNull()
    expect(validateCapturePhotoFiles([oversized])).toBe("size")
  })

  it("reports a safe stage-specific error when creating a private upload fails", async () => {
    const file = new File([new Uint8Array([1])], "label.jpg", { type: "image/jpeg" })
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } })

    await expect(uploadCapturePhotos("household-1", [file], {
      prepareImage: async () => new File([new Uint8Array([2])], "capture.jpg", { type: "image/jpeg" }),
    })).rejects.toMatchObject({ kind: "upload_start" })
  })

  it("classifies a network rejection while creating the private upload", async () => {
    const file = new File([new Uint8Array([1])], "label.jpg", { type: "image/jpeg" })
    rpc.mockRejectedValueOnce(new Error("network unavailable"))

    await expect(uploadCapturePhotos("household-1", [file], {
      prepareImage: async () => new File([new Uint8Array([2])], "capture.jpg", { type: "image/jpeg" }),
    })).rejects.toMatchObject({ kind: "upload_start" })
  })

  it("reports a transfer error when secure photo storage rejects the upload", async () => {
    const file = new File([new Uint8Array([1])], "label.jpg", { type: "image/jpeg" })
    rpc.mockResolvedValueOnce({ data: {
      session_id: sessionId,
      expires_at: "2026-10-03T12:00:00.000Z",
      objects: [{ object_name: objectName, content_type: "image/jpeg" }],
    }, error: null })
    upload.mockResolvedValueOnce({ data: null, error: { statusCode: "500" } })

    await expect(uploadCapturePhotos("household-1", [file], {
      prepareImage: async () => new File([new Uint8Array([2])], "capture.jpg", { type: "image/jpeg" }),
    })).rejects.toMatchObject({ kind: "upload_transfer" })
  })

  it("reports a confirmation error after a stored photo cannot be finalized", async () => {
    const file = new File([new Uint8Array([1])], "label.jpg", { type: "image/jpeg" })
    rpc.mockResolvedValueOnce({ data: {
      session_id: sessionId,
      expires_at: "2026-10-03T12:00:00.000Z",
      objects: [{ object_name: objectName, content_type: "image/jpeg" }],
    }, error: null })
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } })

    await expect(uploadCapturePhotos("household-1", [file], {
      prepareImage: async () => new File([new Uint8Array([2])], "capture.jpg", { type: "image/jpeg" }),
    })).rejects.toMatchObject({ kind: "upload_confirm" })
  })

  it("distinguishes failure to refresh temporary photo status", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } })

    await expect(listCapturePhotoSessions("household-1")).rejects.toMatchObject({ kind: "refresh" })
  })

  it("classifies a network rejection while refreshing temporary photo status", async () => {
    rpc.mockRejectedValueOnce(new Error("network unavailable"))

    await expect(listCapturePhotoSessions("household-1")).rejects.toMatchObject({ kind: "refresh" })
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
      { session_id: sessionId, state: "processing", created_at: "2026-09-27T10:00:00Z", expires_at: "2026-09-28T10:00:00Z", processing_started_at: "2026-09-27T10:01:00Z", photo_count: 1 },
      { session_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", state: "processed", created_at: "2026-09-27T09:00:00Z", expires_at: "2026-09-28T09:00:00Z", photo_count: 1 },
      { session_id: "c56a4180-65aa-42ec-a945-5fd21dec0538", state: "recognized", created_at: "2026-09-27T08:00:00Z", expires_at: "2026-09-28T08:00:00Z", photo_count: 0 },
      { session_id: "a987fbc9-4bed-4078-8f07-9141ba07c9f3", state: "ocr_deletion_pending", created_at: "2026-09-27T07:00:00Z", expires_at: "2026-09-28T07:00:00Z", photo_count: 1 },
    ], error: null })
    await expect(listCapturePhotoSessions("household-1")).resolves.toMatchObject([
      { sessionId, state: "processing", processingStartedAt: "2026-09-27T10:01:00Z" },
      { state: "processed" },
      { state: "recognized", photoCount: 0 },
      { state: "ocr_deletion_pending" },
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

  it("requests Cloudflare OCR through the authenticated same-origin worker", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      state: "recognized",
      engine_version: "cloudflare-moondream3.1-9b-a2b-v1",
      pages: [{ text: "Domaine Exemple 2022", confidence: 0 }],
    }))

    await expect(recognizeCapturePhotoSession(sessionId, {
      accessToken: "session-token",
      fetch: fetcher,
    })).resolves.toEqual({
      state: "recognized",
      pages: [{ text: "Domaine Exemple 2022", confidence: 0 }],
      engine: "cloudflare",
    })

    expect(fetcher).toHaveBeenCalledWith("/api/capture/ocr", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer session-token" },
      body: JSON.stringify({ sessionId }),
    }))
    expect(rpc).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("preserves the explicit no-text response as a retryable capture error", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "no_text" }, { status: 422 }))
    await expect(recognizeCapturePhotoSession(sessionId, { fetch: fetcher })).rejects.toMatchObject({
      name: "CaptureOcrEmptyError",
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("maps an owner authorization failure without exposing worker details", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    await expect(recognizeCapturePhotoSession(sessionId, {
      accessToken: "session-token",
      fetch: fetcher,
    })).rejects.toMatchObject({ kind: "permission" })
  })

  it("validates private OCR results before rendering them", async () => {
    rpc.mockResolvedValueOnce({ data: {
      session_id: sessionId,
      engine_version: "7.0.0",
      recognized_pages: [{ object_name: objectName, text: "Domaine Exemple", confidence: 89 }],
    }, error: null })
    await expect(listCaptureOcrResult(sessionId)).resolves.toEqual({
      pages: [{ text: "Domaine Exemple", confidence: 89 }],
      engine: "tesseract",
    })

    rpc.mockResolvedValueOnce({ data: {
      recognized_pages: [{ text: "", confidence: 0 }],
    }, error: null })
    await expect(listCaptureOcrResult(sessionId)).rejects.toMatchObject({ kind: "ocr" })
  })
})
