import { supabase } from "./supabase"
import { CAPTURE_OCR_ENGINE_VERSION, CAPTURE_OCR_LANGUAGE_CODE } from "./captureOcrConstants"

export const CAPTURE_PHOTO_BUCKET = "capture-labels"
export const CAPTURE_PHOTO_MAX_BYTES = 6 * 1024 * 1024
export const CAPTURE_PHOTO_MAX_COUNT = 2

export type CapturePhotoErrorKind = "invalid" | "dimensions" | "processing" | "ocr" | "limit" | "permission" | "offline" | "upload" | "delete"

export class CapturePhotoError extends Error {
  readonly kind: CapturePhotoErrorKind

  constructor(kind: CapturePhotoErrorKind) {
    super(kind)
    this.name = "CapturePhotoError"
    this.kind = kind
  }
}

export interface CapturePhotoSession {
  sessionId: string
  state: "uploading" | "ready" | "processing" | "processed" | "ocr_deletion_pending" | "recognized" | "deletion_pending"
  createdAt: string
  expiresAt: string
  photoCount: number
}

interface CaptureUploadObject {
  object_name: string
  content_type: string
}

interface CaptureCreateResponse {
  session_id: string
  expires_at: string
  objects: CaptureUploadObject[]
}

export interface PreparedCapturePhoto {
  blob: Blob
  objectName: string
}

interface PhotoProcessingOptions {
  accessToken?: string
  fetch?: typeof fetch
}

interface UploadCapturePhotoOptions extends PhotoProcessingOptions {
  prepareImage?: (file: File) => Promise<File>
}

export interface StoredCaptureOcrPage {
  text: string
  confidence: number
}

export interface StoredCaptureOcrResult {
  pages: StoredCaptureOcrPage[]
}

export interface SavedCaptureOcrResult extends StoredCaptureOcrResult {
  state: "ocr_deletion_pending" | "recognized"
}

interface CaptureOcrInputPage {
  objectName: string
  text: string
  confidence: number
}

const OBJECT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorCode(error: unknown): string | undefined {
  return isPlainRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined
}

function mapRpcError(error: unknown, fallback: CapturePhotoErrorKind): CapturePhotoError {
  const code = errorCode(error)
  if (code === "42501" || code === "28000") return new CapturePhotoError("permission")
  if (code === "P0001") return new CapturePhotoError("limit")
  return new CapturePhotoError(fallback)
}

function asCreateResponse(value: unknown): CaptureCreateResponse {
  if (!isPlainRecord(value) || typeof value.session_id !== "string"
      || typeof value.expires_at !== "string" || !Array.isArray(value.objects)
      || !Number.isFinite(Date.parse(value.expires_at))) {
    throw new CapturePhotoError("upload")
  }
  const objects = value.objects.map((item) => {
    if (!isPlainRecord(item) || typeof item.object_name !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.object_name)
        || (item.content_type !== "image/jpeg" && item.content_type !== "image/png")) {
      throw new CapturePhotoError("upload")
    }
    return { object_name: item.object_name, content_type: item.content_type }
  })
  if (objects.length < 1 || objects.length > CAPTURE_PHOTO_MAX_COUNT) {
    throw new CapturePhotoError("upload")
  }
  return {
    session_id: value.session_id,
    expires_at: value.expires_at,
    objects,
  }
}

export function validateCapturePhotoFiles(files: readonly File[]): CapturePhotoErrorKind | null {
  if (files.length < 1 || files.length > CAPTURE_PHOTO_MAX_COUNT) return "invalid"
  for (const file of files) {
    if (file.size < 1 || file.size > CAPTURE_PHOTO_MAX_BYTES
        || (file.type !== "image/jpeg" && file.type !== "image/png")) {
      return "invalid"
    }
  }
  return null
}

export async function listCapturePhotoSessions(
  householdId: string,
): Promise<CapturePhotoSession[]> {
  const { data, error } = await supabase.rpc("list_capture_sessions", {
    p_household_id: householdId,
  })
  if (error) throw mapRpcError(error, "upload")
  if (!Array.isArray(data)) throw new CapturePhotoError("upload")
  return data.flatMap((item): CapturePhotoSession[] => {
    if (!isPlainRecord(item)
        || typeof item.session_id !== "string"
        || !["uploading", "ready", "processing", "processed", "ocr_deletion_pending", "recognized", "deletion_pending"].includes(String(item.state))
        || typeof item.created_at !== "string"
        || typeof item.expires_at !== "string"
        || typeof item.photo_count !== "number") return []
    return [{
      sessionId: item.session_id,
      state: item.state as CapturePhotoSession["state"],
      createdAt: item.created_at,
      expiresAt: item.expires_at,
      photoCount: item.photo_count,
    }]
  })
}

async function currentAccessToken(accessToken?: string): Promise<string> {
  if (accessToken) return accessToken
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new CapturePhotoError("permission")
  return data.session.access_token
}

export async function processCapturePhotoSession(
  sessionId: string,
  options: PhotoProcessingOptions = {},
): Promise<"processed" | "processing"> {
  const token = await currentAccessToken(options.accessToken)
  let response: Response
  try {
    response = await (options.fetch ?? fetch)("/api/capture/process", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId }),
    })
  } catch {
    throw new CapturePhotoError("processing")
  }
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new CapturePhotoError("processing")
  }
  if (!response.ok || !isPlainRecord(result)) {
    if (isPlainRecord(result) && result.error === "invalid_photo") throw new CapturePhotoError("invalid")
    throw new CapturePhotoError("processing")
  }
  if (result.status === "processed") return "processed"
  if (result.status === "processing") return "processing"
  throw new CapturePhotoError("processing")
}

export async function listPreparedCapturePhotos(
  sessionId: string,
  options: PhotoProcessingOptions = {},
): Promise<PreparedCapturePhoto[]> {
  const { data, error } = await supabase.rpc("list_capture_processed_assets", {
    p_session_id: sessionId,
  })
  if (error || !Array.isArray(data) || data.length < 1 || data.length > CAPTURE_PHOTO_MAX_COUNT) {
    throw new CapturePhotoError("permission")
  }

  const assets = data.map((item) => {
    if (!isPlainRecord(item) || typeof item.object_name !== "string"
        || !OBJECT_KEY_PATTERN.test(item.object_name) || item.content_type !== "image/jpeg"
        || !Number.isSafeInteger(item.size_bytes) || Number(item.size_bytes) < 1
        || Number(item.size_bytes) > 5 * 1024 * 1024) {
      throw new CapturePhotoError("processing")
    }
    return { objectName: item.object_name, size: Number(item.size_bytes) }
  })
  const token = await currentAccessToken(options.accessToken)
  const fetcher = options.fetch ?? fetch
  const results = await Promise.all(assets.map(async (asset) => {
    let response: Response
    try {
      response = await fetcher("/api/capture/preview", {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId, objectName: asset.objectName }),
      })
    } catch {
      throw new CapturePhotoError("offline")
    }
    if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/jpeg"
        || !response.headers.get("cache-control")?.includes("no-store")) {
      throw new CapturePhotoError("permission")
    }
    const blob = await response.blob()
    if (blob.type !== "image/jpeg" || blob.size !== asset.size || blob.size > 5 * 1024 * 1024) {
      throw new CapturePhotoError("processing")
    }
    return { objectName: asset.objectName, blob }
  }))
  return results
}

function asCaptureOcrResult(value: unknown): StoredCaptureOcrResult {
  if (!isPlainRecord(value) || !Array.isArray(value.recognized_pages)
      || value.recognized_pages.length < 1 || value.recognized_pages.length > CAPTURE_PHOTO_MAX_COUNT) {
    throw new CapturePhotoError("ocr")
  }
  const pages = value.recognized_pages.map((item): StoredCaptureOcrPage => {
    if (!isPlainRecord(item) || typeof item.text !== "string" || item.text.length > 10000
        || typeof item.confidence !== "number" || !Number.isFinite(item.confidence)
        || item.confidence < 0 || item.confidence > 100) {
      throw new CapturePhotoError("ocr")
    }
    return { text: item.text, confidence: item.confidence }
  })
  if (!pages.some((page) => page.text.trim().length > 0)) throw new CapturePhotoError("ocr")
  return { pages }
}

export async function listCaptureOcrResult(sessionId: string): Promise<StoredCaptureOcrResult> {
  const { data, error } = await supabase.rpc("list_capture_ocr_result", {
    p_session_id: sessionId,
  })
  if (error) throw mapRpcError(error, "ocr")
  return asCaptureOcrResult(data)
}

export async function saveCaptureOcrResult(
  sessionId: string,
  pages: readonly CaptureOcrInputPage[],
): Promise<SavedCaptureOcrResult> {
  if (pages.length < 1 || pages.length > CAPTURE_PHOTO_MAX_COUNT
      || pages.some((page) => !OBJECT_KEY_PATTERN.test(page.objectName)
        || typeof page.text !== "string" || page.text.length > 10000
        || !Number.isFinite(page.confidence) || page.confidence < 0 || page.confidence > 100)
      || !pages.some((page) => page.text.trim().length > 0)) {
    throw new CapturePhotoError("ocr")
  }

  const { data, error } = await supabase.rpc("complete_capture_ocr", {
    p_session_id: sessionId,
    p_language_code: CAPTURE_OCR_LANGUAGE_CODE,
    p_engine_version: CAPTURE_OCR_ENGINE_VERSION,
    p_pages: pages.map((page) => ({
      object_name: page.objectName,
      text: page.text,
      confidence: page.confidence,
    })),
  })
  if (error) throw mapRpcError(error, "ocr")
  if (!isPlainRecord(data)
      || !["ocr_deletion_pending", "recognized"].includes(String(data.state))
      || !Array.isArray(data.object_names)
      || data.object_names.length > CAPTURE_PHOTO_MAX_COUNT * 2
      || data.object_names.some((name) => typeof name !== "string" || !OBJECT_KEY_PATTERN.test(name))) {
    throw new CapturePhotoError("ocr")
  }

  // Read the server's canonical result before removing the only image copy;
  // this also handles a simultaneous second tab without overwriting its text.
  const result = await listCaptureOcrResult(sessionId)
  if (data.state === "recognized") return { state: "recognized", ...result }

  const names = [...new Set(data.object_names as string[])]
  if (names.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(CAPTURE_PHOTO_BUCKET)
      .remove(names)
    if (removeError) return { state: "ocr_deletion_pending", ...result }
  }

  const { data: completed, error: cleanupError } = await supabase.rpc("complete_capture_cleanup", {
    p_session_id: sessionId,
  })
  return {
    state: !cleanupError && completed === true ? "recognized" : "ocr_deletion_pending",
    ...result,
  }
}

async function closeAndDeleteCapture(sessionId: string): Promise<void> {
  const { data, error } = await supabase.rpc("cancel_capture_session", {
    p_session_id: sessionId,
  })
  if (error) throw mapRpcError(error, "delete")
  const names = isPlainRecord(data) && Array.isArray(data.object_names)
    ? data.object_names.filter((name): name is string => typeof name === "string")
    : []
  if (names.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(CAPTURE_PHOTO_BUCKET)
      .remove(names)
    if (removeError) throw new CapturePhotoError("delete")
  }
  const { data: deleted, error: cleanupError } = await supabase.rpc("complete_capture_cleanup", {
    p_session_id: sessionId,
  })
  if (cleanupError || deleted !== true) throw new CapturePhotoError("delete")
}

export async function uploadCapturePhotos(
  householdId: string,
  files: readonly File[],
  options: UploadCapturePhotoOptions = {},
): Promise<{ sessionId: string; status: "processed" | "processing" }> {
  const validationError = validateCapturePhotoFiles(files)
  if (validationError) throw new CapturePhotoError(validationError)

  const { prepareCapturePhotoFile } = await import("./capturePhotoImage")
  const preparedFiles: File[] = []
  for (const file of files) {
    preparedFiles.push(await (options.prepareImage ?? prepareCapturePhotoFile)(file))
  }
  const preparedValidation = validateCapturePhotoFiles(preparedFiles)
  if (preparedValidation) throw new CapturePhotoError(preparedValidation)

  const { data: created, error: createError } = await supabase.rpc("create_capture_session", {
    p_household_id: householdId,
    p_assets: preparedFiles.map((file) => ({
      content_type: file.type,
      size_bytes: file.size,
    })),
  })
  if (createError) throw mapRpcError(createError, "upload")
  const session = asCreateResponse(created)
  if (session.objects.length !== preparedFiles.length) {
    await closeAndDeleteCapture(session.session_id).catch(() => undefined)
    throw new CapturePhotoError("upload")
  }

  try {
    for (let index = 0; index < preparedFiles.length; index += 1) {
      const file = preparedFiles[index]
      const object = session.objects[index]
      if (!file || !object || file.type !== object.content_type) {
        throw new CapturePhotoError("upload")
      }
      // Supabase's multipart request can include the File object's name.
      // Replace it with a generic media type name before sending any bytes.
      const transferFile = new File([file], file.type === "image/jpeg" ? "capture.jpg" : "capture.png", {
        type: file.type,
        lastModified: 0,
      })
      const { error } = await supabase.storage
        .from(CAPTURE_PHOTO_BUCKET)
        .upload(object.object_name, transferFile, {
          cacheControl: "0",
          contentType: file.type,
          upsert: false,
        })
      if (error) throw new CapturePhotoError("upload")
    }

    const { error: completeError } = await supabase.rpc("complete_capture_session", {
      p_session_id: session.session_id,
    })
    if (completeError) throw mapRpcError(completeError, "upload")
  } catch (error) {
    // Closing access comes first. If the Storage API is temporarily unavailable,
    // the cleanup worker retries these exact server-created paths.
    await closeAndDeleteCapture(session.session_id).catch(() => undefined)
    if (error instanceof CapturePhotoError) throw error
    throw new CapturePhotoError("upload")
  }

  const status = await processCapturePhotoSession(session.session_id, options)
  return { sessionId: session.session_id, status }
}

export async function deleteCapturePhotoSession(sessionId: string): Promise<void> {
  await closeAndDeleteCapture(sessionId)
}
