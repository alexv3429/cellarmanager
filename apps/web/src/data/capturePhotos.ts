import { supabase } from "./supabase"

export const CAPTURE_PHOTO_BUCKET = "capture-labels"
export const CAPTURE_PHOTO_MAX_BYTES = 6 * 1024 * 1024
export const CAPTURE_PHOTO_MAX_COUNT = 2
export const CAPTURE_PREPROCESSING_LEASE_MS = 5 * 60 * 1000

export type CapturePhotoErrorKind = "invalid" | "count" | "size" | "format" | "dimensions" | "server_photo" | "processing" | "ocr" | "suggestion" | "limit" | "permission" | "offline" | "upload_start" | "upload_transfer" | "upload_confirm" | "refresh" | "delete"

export class CapturePhotoError extends Error {
  readonly kind: CapturePhotoErrorKind

  constructor(kind: CapturePhotoErrorKind) {
    super(kind)
    this.name = "CapturePhotoError"
    this.kind = kind
  }
}

export function isCapturePhotoPreparationStale(
  session: Pick<CapturePhotoSession, "state" | "processingStartedAt" | "expiresAt">,
  now = Date.now(),
): boolean {
  if (session.state !== "processing" || !session.processingStartedAt) return false
  const startedAt = Date.parse(session.processingStartedAt)
  const expiresAt = Date.parse(session.expiresAt)
  return Number.isFinite(startedAt)
    && Number.isFinite(expiresAt)
    && now - startedAt >= CAPTURE_PREPROCESSING_LEASE_MS
    && now < expiresAt
}

export interface CapturePhotoSession {
  sessionId: string
  state: "uploading" | "ready" | "processing" | "processed" | "ocr_deletion_pending" | "recognized" | "deletion_pending"
  createdAt: string
  expiresAt: string
  processingStartedAt: string | null
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
  engine: "tesseract" | "cloudflare" | "unknown"
}

export interface SavedCaptureOcrResult extends StoredCaptureOcrResult {
  state: "ocr_deletion_pending" | "recognized"
}

export type CaptureSuggestionConfidence = "high" | "medium" | "low"

export interface CaptureWineTextField {
  value: string | null
  evidence: string[]
  confidence: CaptureSuggestionConfidence
}

export interface CaptureWineNumberField {
  value: number | null
  evidence: string[]
  confidence: CaptureSuggestionConfidence
}

export interface CaptureWineVintageField extends CaptureWineNumberField {
  status: "year" | "non_vintage" | "not_visible"
}

export interface CaptureWineSuggestion {
  producer: CaptureWineTextField
  cuvee: CaptureWineTextField
  appellation: CaptureWineTextField
  area: CaptureWineTextField
  color: CaptureWineTextField & { value: "red" | "white" | "rose" | "sparkling" | "other" | null }
  format_ml: CaptureWineNumberField
  vintage: CaptureWineVintageField
}

export interface SavedCaptureWineSuggestion {
  modelVersion: string
  suggestion: CaptureWineSuggestion
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
    throw new CapturePhotoError("upload_start")
  }
  const objects = value.objects.map((item) => {
    if (!isPlainRecord(item) || typeof item.object_name !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.object_name)
        || (item.content_type !== "image/jpeg" && item.content_type !== "image/png")) {
      throw new CapturePhotoError("upload_start")
    }
    return { object_name: item.object_name, content_type: item.content_type }
  })
  if (objects.length < 1 || objects.length > CAPTURE_PHOTO_MAX_COUNT) {
    throw new CapturePhotoError("upload_start")
  }
  return {
    session_id: value.session_id,
    expires_at: value.expires_at,
    objects,
  }
}

export function validateCapturePhotoFiles(files: readonly File[]): CapturePhotoErrorKind | null {
  if (files.length < 1) return "invalid"
  if (files.length > CAPTURE_PHOTO_MAX_COUNT) return "count"
  for (const file of files) {
    // Browsers, especially iOS photo pickers, may report an empty or non-standard
    // MIME type for a valid JPEG. The preparation step verifies the actual bytes.
    if (file.size < 1) return "invalid"
    if (file.size > CAPTURE_PHOTO_MAX_BYTES) return "size"
  }
  return null
}

export async function listCapturePhotoSessions(
  householdId: string,
): Promise<CapturePhotoSession[]> {
  let response
  try {
    response = await supabase.rpc("list_capture_sessions", {
      p_household_id: householdId,
    })
  } catch {
    throw new CapturePhotoError("refresh")
  }
  const { data, error } = response
  if (error) throw mapRpcError(error, "refresh")
  if (!Array.isArray(data)) throw new CapturePhotoError("refresh")
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
      processingStartedAt: typeof item.processing_started_at === "string" ? item.processing_started_at : null,
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
    if (isPlainRecord(result) && result.error === "invalid_photo") throw new CapturePhotoError("server_photo")
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
  const engine = value.engine_version === "7.0.0"
    ? "tesseract"
    : value.engine_version === "cloudflare-moondream3.1-9b-a2b-v1"
      ? "cloudflare"
      : "unknown"
  return { pages, engine }
}

export async function listCaptureOcrResult(sessionId: string): Promise<StoredCaptureOcrResult> {
  const { data, error } = await supabase.rpc("list_capture_ocr_result", {
    p_session_id: sessionId,
  })
  if (error) throw mapRpcError(error, "ocr")
  return asCaptureOcrResult(data)
}

const CAPTURE_WINE_SUGGESTION_MODEL_VERSION = "cloudflare-llama-3.3-70b-wine-label-v1"
const CAPTURE_SUGGESTION_CONFIDENCE = new Set<CaptureSuggestionConfidence>(["high", "medium", "low"])
const CAPTURE_SUGGESTION_COLORS = new Set(["red", "white", "rose", "sparkling", "other"])

function asEvidence(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 4
      || value.some((line) => typeof line !== "string" || line.length > 500)) {
    throw new CapturePhotoError("suggestion")
  }
  return value
}

function asConfidence(value: unknown): CaptureSuggestionConfidence {
  if (typeof value !== "string" || !CAPTURE_SUGGESTION_CONFIDENCE.has(value as CaptureSuggestionConfidence)) {
    throw new CapturePhotoError("suggestion")
  }
  return value as CaptureSuggestionConfidence
}

function asTextField(value: unknown): CaptureWineTextField {
  if (!isPlainRecord(value)
      || !(value.value === null || (typeof value.value === "string" && value.value.trim().length > 0 && value.value.length <= 240))) {
    throw new CapturePhotoError("suggestion")
  }
  return {
    value: value.value === null ? null : value.value.trim(),
    evidence: asEvidence(value.evidence),
    confidence: asConfidence(value.confidence),
  }
}

function asNumberField(value: unknown, max: number): CaptureWineNumberField {
  if (!isPlainRecord(value)
      || !(value.value === null || (typeof value.value === "number" && Number.isInteger(value.value)
        && value.value > 0 && value.value <= max))) {
    throw new CapturePhotoError("suggestion")
  }
  return {
    value: value.value as number | null,
    evidence: asEvidence(value.evidence),
    confidence: asConfidence(value.confidence),
  }
}

function asCaptureWineSuggestion(value: unknown): SavedCaptureWineSuggestion {
  if (!isPlainRecord(value) || value.model_version !== CAPTURE_WINE_SUGGESTION_MODEL_VERSION
      || !isPlainRecord(value.suggestion)) throw new CapturePhotoError("suggestion")
  const candidate = value.suggestion
  const vintage = asNumberField(candidate.vintage, 2200)
  if (!isPlainRecord(candidate.vintage)
      || !["year", "non_vintage", "not_visible"].includes(String(candidate.vintage.status))
    || (candidate.vintage.status === "year"
      ? vintage.value === null || vintage.value < 1800
      : vintage.value !== null)) {
    throw new CapturePhotoError("suggestion")
  }
  const color = asTextField(candidate.color)
  if (color.value !== null && !CAPTURE_SUGGESTION_COLORS.has(color.value)) {
    throw new CapturePhotoError("suggestion")
  }
  return {
    modelVersion: CAPTURE_WINE_SUGGESTION_MODEL_VERSION,
    suggestion: {
      producer: asTextField(candidate.producer),
      cuvee: asTextField(candidate.cuvee),
      appellation: asTextField(candidate.appellation),
      area: asTextField(candidate.area),
      color: color as CaptureWineSuggestion["color"],
      format_ml: asNumberField(candidate.format_ml, 20_000),
      vintage: {
        ...vintage,
        status: candidate.vintage.status as CaptureWineVintageField["status"],
      },
    },
  }
}

export async function suggestCaptureWineCandidate(
  sessionId: string,
  options: PhotoProcessingOptions = {},
): Promise<SavedCaptureWineSuggestion> {
  const token = await currentAccessToken(options.accessToken)
  let response: Response
  try {
    response = await (options.fetch ?? fetch)("/api/capture/suggest-wine", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId }),
    })
  } catch {
    throw new CapturePhotoError("offline")
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new CapturePhotoError("suggestion")
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new CapturePhotoError("permission")
    throw new CapturePhotoError("suggestion")
  }
  return asCaptureWineSuggestion(data)
}

export async function recognizeCapturePhotoSession(
  sessionId: string,
  options: PhotoProcessingOptions = {},
): Promise<SavedCaptureOcrResult> {
  const token = await currentAccessToken(options.accessToken)
  let response: Response
  try {
    response = await (options.fetch ?? fetch)("/api/capture/ocr", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId }),
    })
  } catch {
    throw new CapturePhotoError("offline")
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new CapturePhotoError("ocr")
  }
  if (isPlainRecord(data) && data.error === "no_text") {
    const error = new Error("No text recognized")
    error.name = "CaptureOcrEmptyError"
    throw error
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new CapturePhotoError("permission")
    throw new CapturePhotoError("ocr")
  }
  if (!isPlainRecord(data) || !["ocr_deletion_pending", "recognized"].includes(String(data.state))
      || !Array.isArray(data.pages) || data.pages.length < 1 || data.pages.length > CAPTURE_PHOTO_MAX_COUNT) {
    throw new CapturePhotoError("ocr")
  }
  const pages = data.pages.map((page): StoredCaptureOcrPage => {
    if (!isPlainRecord(page) || typeof page.text !== "string" || page.text.length > 10000
        || typeof page.confidence !== "number" || !Number.isFinite(page.confidence)
        || page.confidence < 0 || page.confidence > 100) {
      throw new CapturePhotoError("ocr")
    }
    return { text: page.text, confidence: page.confidence }
  })
  if (!pages.some((page) => page.text.trim().length > 0)) throw new CapturePhotoError("ocr")
  const engine = data.engine_version === "cloudflare-moondream3.1-9b-a2b-v1" ? "cloudflare" : "unknown"
  return { state: data.state as SavedCaptureOcrResult["state"], pages, engine }
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

  let createResponse
  try {
    createResponse = await supabase.rpc("create_capture_session", {
      p_household_id: householdId,
      p_assets: preparedFiles.map((file) => ({
        content_type: file.type,
        size_bytes: file.size,
      })),
    })
  } catch {
    throw new CapturePhotoError("upload_start")
  }
  const { data: created, error: createError } = createResponse
  if (createError) throw mapRpcError(createError, "upload_start")
  const session = asCreateResponse(created)
  if (session.objects.length !== preparedFiles.length) {
    await closeAndDeleteCapture(session.session_id).catch(() => undefined)
    throw new CapturePhotoError("upload_start")
  }

  try {
    for (let index = 0; index < preparedFiles.length; index += 1) {
      const file = preparedFiles[index]
      const object = session.objects[index]
      if (!file || !object || file.type !== object.content_type) {
        throw new CapturePhotoError("upload_transfer")
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
      if (error) {
        const status = isPlainRecord(error) ? Number(error.statusCode ?? error.status) : NaN
        if (status === 401 || status === 403) throw new CapturePhotoError("permission")
        throw new CapturePhotoError("upload_transfer")
      }
    }

    let completeResponse
    try {
      completeResponse = await supabase.rpc("complete_capture_session", {
        p_session_id: session.session_id,
      })
    } catch {
      throw new CapturePhotoError("upload_confirm")
    }
    const { error: completeError } = completeResponse
    if (completeError) throw mapRpcError(completeError, "upload_confirm")
  } catch (error) {
    // Closing access comes first. If the Storage API is temporarily unavailable,
    // the cleanup worker retries these exact server-created paths.
    await closeAndDeleteCapture(session.session_id).catch(() => undefined)
    if (error instanceof CapturePhotoError) throw error
    throw new CapturePhotoError("upload_transfer")
  }

  const status = await processCapturePhotoSession(session.session_id, options)
  return { sessionId: session.session_id, status }
}

export async function deleteCapturePhotoSession(sessionId: string): Promise<void> {
  await closeAndDeleteCapture(sessionId)
}
