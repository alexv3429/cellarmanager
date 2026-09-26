import { supabase } from "./supabase"

export const CAPTURE_PHOTO_BUCKET = "capture-labels"
export const CAPTURE_PHOTO_MAX_BYTES = 6 * 1000 * 1000
export const CAPTURE_PHOTO_MAX_COUNT = 2

export type CapturePhotoErrorKind = "invalid" | "limit" | "permission" | "offline" | "upload" | "delete"

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
  state: "uploading" | "ready" | "deletion_pending"
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
        || !["uploading", "ready", "deletion_pending"].includes(String(item.state))
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
): Promise<void> {
  const validationError = validateCapturePhotoFiles(files)
  if (validationError) throw new CapturePhotoError(validationError)

  const { data: created, error: createError } = await supabase.rpc("create_capture_session", {
    p_household_id: householdId,
    p_assets: files.map((file) => ({
      content_type: file.type,
      size_bytes: file.size,
    })),
  })
  if (createError) throw mapRpcError(createError, "upload")
  const session = asCreateResponse(created)
  if (session.objects.length !== files.length) {
    await closeAndDeleteCapture(session.session_id).catch(() => undefined)
    throw new CapturePhotoError("upload")
  }

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
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
}

export async function deleteCapturePhotoSession(sessionId: string): Promise<void> {
  await closeAndDeleteCapture(sessionId)
}
