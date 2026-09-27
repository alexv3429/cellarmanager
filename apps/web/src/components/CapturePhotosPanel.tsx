import { useCallback, useEffect, useRef, useState } from "react"

import {
  CapturePhotoError,
  deleteCapturePhotoSession,
  listCaptureOcrResult,
  listPreparedCapturePhotos,
  listCapturePhotoSessions,
  processCapturePhotoSession,
  saveCaptureOcrResult,
  validateCapturePhotoFiles,
  uploadCapturePhotos,
  type CapturePhotoSession,
  type StoredCaptureOcrResult,
} from "../data/capturePhotos"
import { useLanguage } from "../i18n/useLanguage"

interface CapturePhotosPanelProps {
  householdId: string
  isOnline: boolean
  userId: string
}

function messageForError(error: unknown, t: (key: string) => string): string {
  if (error instanceof Error && error.name === "CaptureOcrEmptyError") {
    return t("No label text could be read. The private photo is still available to retry or delete.")
  }
  if (!(error instanceof CapturePhotoError)) return t("Photo upload failed. Your cellar was not changed.")
  switch (error.kind) {
    case "invalid": return t("Choose one or two valid JPEG or PNG photos, each no larger than 6 MB.")
    case "dimensions": return t("This photo is too large to prepare safely. Choose a smaller image.")
    case "processing": return t("Photo preparation did not finish. You can retry or delete this capture.")
    case "ocr": return t("Local text recognition did not finish. Your cellar was not changed; you can retry or delete the photo.")
    case "limit": return t("The temporary photo limit has been reached. Delete an earlier capture or try again later.")
    case "permission": return t("Only the current household owner can upload these photos. Refresh your access and try again.")
    case "offline": return t("Reconnect before uploading photos. Photos are not queued offline.")
    case "delete": return t("Deletion is still pending. CellarManager will retry it automatically.")
    default: return t("Photo upload failed. Your cellar was not changed.")
  }
}

function sessionStateLabel(session: CapturePhotoSession, t: (key: string) => string): string {
  switch (session.state) {
    case "ready": return t("Ready to prepare privately")
    case "processing": return t("Preparing photos…")
    case "processed": return t("Prepared photos are private and ready for on-device text recognition")
    case "ocr_deletion_pending": return t("Text saved privately; photo deletion is still in progress")
    case "recognized": return t("Text recognized privately; photo deleted")
    case "deletion_pending": return t("Deletion in progress")
    default: return t("Upload incomplete")
  }
}

export function CapturePhotosPanel({ householdId, isOnline, userId }: CapturePhotosPanelProps) {
  const { language, t } = useLanguage()
  const [files, setFiles] = useState<File[]>([])
  const [sessions, setSessions] = useState<CapturePhotoSession[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<{ sessionId: string; urls: string[] } | null>(null)
  const [ocrResults, setOcrResults] = useState<Record<string, StoredCaptureOcrResult>>({})
  const [shownOcrSession, setShownOcrSession] = useState<string | null>(null)
  const [ocrProgress, setOcrProgress] = useState<{ sessionId: string; page: number; pageCount: number; progress: number } | null>(null)
  const previewRef = useRef<{ sessionId: string; urls: string[] } | null>(null)

  const clearPreview = useCallback(() => {
    previewRef.current?.urls.forEach((url) => URL.revokeObjectURL(url))
    previewRef.current = null
    setPreview(null)
  }, [])

  const refresh = useCallback(async () => {
    if (!isOnline) return
    setLoading(true)
    setError("")
    try {
      setSessions(await listCapturePhotoSessions(householdId))
    } catch (loadError) {
      setError(messageForError(loadError, t))
    } finally {
      setLoading(false)
    }
  }, [householdId, isOnline, t])

  useEffect(() => {
    previewRef.current?.urls.forEach((url) => URL.revokeObjectURL(url))
    previewRef.current = null
    setPreview(null)
    setFiles([])
    setSessions([])
    setOcrResults({})
    setShownOcrSession(null)
    setOcrProgress(null)
    setMessage("")
    setError("")
    let active = true
    if (isOnline) {
      setLoading(true)
      void listCapturePhotoSessions(householdId)
        .then((items) => {
          if (active) setSessions(items)
        })
        .catch((loadError: unknown) => {
          if (active) setError(messageForError(loadError, t))
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }
    return () => {
      active = false
      previewRef.current?.urls.forEach((url) => URL.revokeObjectURL(url))
      previewRef.current = null
    }
  }, [householdId, isOnline, t, userId])

  const chooseFiles = (chosen: FileList | null) => {
    const nextFiles = chosen ? Array.from(chosen).slice(0, 3) : []
    const validation = validateCapturePhotoFiles(nextFiles)
    setFiles(validation ? [] : nextFiles)
    setError(validation ? messageForError(new CapturePhotoError(validation), t) : "")
    setMessage("")
  }

  const upload = async () => {
    if (!isOnline) {
      setError(messageForError(new CapturePhotoError("offline"), t))
      return
    }
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const result = await uploadCapturePhotos(householdId, files)
      setFiles([])
      setMessage(t(result.status === "processed"
        ? "Photos are private. Read the label text on this device, or delete the capture. Unread photos expire within 24 hours."
        : "Photos are still being prepared. Refresh to check their status."))
      await refresh()
    } catch (uploadError) {
      setFiles([])
      setError(messageForError(uploadError, t))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const prepare = async (sessionId: string) => {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const status = await processCapturePhotoSession(sessionId)
      setMessage(t(status === "processed"
        ? "Photos are private. Read the label text on this device, or delete the capture. Unread photos expire within 24 hours."
        : "Photos are still being prepared. Refresh to check their status."))
      await refresh()
    } catch (prepareError) {
      setError(messageForError(prepareError, t))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const togglePreview = async (sessionId: string) => {
    if (previewRef.current?.sessionId === sessionId) {
      clearPreview()
      return
    }
    setBusy(true)
    setError("")
    setMessage("")
    clearPreview()
    try {
      const photos = await listPreparedCapturePhotos(sessionId)
      const nextPreview = {
        sessionId,
        urls: photos.map((photo) => URL.createObjectURL(photo.blob)),
      }
      previewRef.current = nextPreview
      setPreview(nextPreview)
    } catch (previewError) {
      setError(messageForError(previewError, t))
    } finally {
      setBusy(false)
    }
  }

  const recognize = async (sessionId: string) => {
    setBusy(true)
    setError("")
    setMessage("")
    setOcrProgress({ sessionId, page: 1, pageCount: 1, progress: 0 })
    if (previewRef.current?.sessionId === sessionId) clearPreview()
    try {
      const photos = await listPreparedCapturePhotos(sessionId)
      const { recognizeCapturePhotosLocally } = await import("../data/captureOcr")
      const pages = await recognizeCapturePhotosLocally(photos, {
        onProgress: (progress) => setOcrProgress({ sessionId, ...progress }),
      })
      const saved = await saveCaptureOcrResult(sessionId, pages)
      setOcrResults((current) => ({ ...current, [sessionId]: { pages: saved.pages } }))
      setShownOcrSession(sessionId)
      setMessage(t(saved.state === "recognized"
        ? "Text recognized on this device and saved privately. The photo has been deleted."
        : "Text is saved privately. Photo deletion is still being retried; your cellar was not changed."))
      await refresh()
    } catch (recognitionError) {
      const displayError = recognitionError instanceof CapturePhotoError
        || (recognitionError instanceof Error && recognitionError.name === "CaptureOcrEmptyError")
        ? recognitionError
        : new CapturePhotoError("ocr")
      setError(messageForError(displayError, t))
      await refresh()
    } finally {
      setOcrProgress(null)
      setBusy(false)
    }
  }

  const toggleRecognizedText = async (sessionId: string) => {
    if (shownOcrSession === sessionId) {
      setShownOcrSession(null)
      return
    }
    const existing = ocrResults[sessionId]
    if (existing) {
      setShownOcrSession(sessionId)
      return
    }
    setBusy(true)
    setError("")
    try {
      const result = await listCaptureOcrResult(sessionId)
      setOcrResults((current) => ({ ...current, [sessionId]: result }))
      setShownOcrSession(sessionId)
    } catch (loadError) {
      setError(messageForError(loadError, t))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (sessionId: string) => {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      if (previewRef.current?.sessionId === sessionId) clearPreview()
      await deleteCapturePhotoSession(sessionId)
      setMessage(t("Photos deleted."))
      await refresh()
    } catch (deleteError) {
      setError(messageForError(deleteError, t))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const locale = language === "fr" ? "fr-FR" : "en-US"

  return (
    <section className="capture-photos" aria-labelledby="capture-photos-title">
      <div className="capture-photos__intro">
        <div>
          <h3 id="capture-photos-title">{t("Capture label photos")}</h3>
          <p>{t("Upload one or two label photos. Text recognition runs on this device; once the text is saved privately, the photo is deleted. Unread photos and saved text expire within 24 hours. No wine or bottle is added.")}</p>
        </div>
        <button type="button" className="button-secondary" onClick={() => void refresh()} disabled={!isOnline || loading || busy}>
          {loading ? t("Loading…") : t("Refresh photos")}
        </button>
      </div>

      {!isOnline ? <p className="capture-photos__offline">{t("Reconnect before uploading photos. Photos are not queued offline.")}</p> : null}

      <div className="capture-photos__pickers">
        <label>
          {t("Take a photo")}
          <input
            accept="image/jpeg,image/png"
            capture="environment"
            disabled={!isOnline || busy}
            onChange={(event) => {
              chooseFiles(event.currentTarget.files)
              event.currentTarget.value = ""
            }}
            type="file"
          />
        </label>
        <label>
          {t("Choose up to two photos")}
          <input
            accept="image/jpeg,image/png"
            disabled={!isOnline || busy}
            multiple
            onChange={(event) => {
              chooseFiles(event.currentTarget.files)
              event.currentTarget.value = ""
            }}
            type="file"
          />
        </label>
      </div>

      {files.length > 0 ? (
        <div className="capture-photos__selection">
          <span>{t(files.length === 1 ? "1 photo selected" : "{count} photos selected", { count: String(files.length) })}</span>
          <button type="button" className="button-secondary" disabled={busy} onClick={() => setFiles([])}>{t("Clear selection")}</button>
          <button type="button" disabled={busy || !isOnline} onClick={() => void upload()}>
            {busy ? t("Preparing and uploading…") : t("Prepare and upload photos")}
          </button>
        </div>
      ) : null}

      {message ? <p role="status" className="capture-photos__message">{message}</p> : null}
      {error ? <p role="alert" className="capture-photos__error">{error}</p> : null}

      {sessions.length > 0 ? (
        <div className="capture-photos__sessions">
          <h4>{t("Temporary photo captures")}</h4>
          {sessions.map((session) => (
            <article className="capture-photos__session" key={session.sessionId}>
              <div className="capture-photos__session-info">
                <div>
                  <strong>{sessionStateLabel(session, t)}</strong>
                  <p>{t(session.photoCount === 1 ? "1 photo" : "{count} photos", { count: String(session.photoCount) })} · {t("Expires {date}", {
                    date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.expiresAt)),
                  })}</p>
                </div>
                <div className="capture-photos__session-actions">
                  {session.state === "ready" ? (
                    <button type="button" disabled={busy || !isOnline} onClick={() => void prepare(session.sessionId)}>
                      {busy ? t("Preparing…") : t("Prepare photos")}
                    </button>
                  ) : null}
                  {session.state === "processed" ? (
                    <>
                      <button type="button" disabled={busy || !isOnline} onClick={() => void recognize(session.sessionId)}>
                        {ocrProgress?.sessionId === session.sessionId
                          ? t("Reading label text…")
                          : t("Read label text on this device")}
                      </button>
                      <button type="button" className="button-secondary" disabled={busy || !isOnline} onClick={() => void togglePreview(session.sessionId)}>
                        {preview?.sessionId === session.sessionId ? t("Hide prepared photos") : t("View prepared photos")}
                      </button>
                    </>
                  ) : null}
                  {session.state === "ocr_deletion_pending" || session.state === "recognized" ? (
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy || (!isOnline && !ocrResults[session.sessionId])}
                      onClick={() => void toggleRecognizedText(session.sessionId)}
                    >
                      {shownOcrSession === session.sessionId ? t("Hide recognized text") : t("View recognized text")}
                    </button>
                  ) : null}
                  {session.state !== "deletion_pending" && session.state !== "processing" ? (
                    <button type="button" className="button-secondary" disabled={busy || !isOnline} onClick={() => void remove(session.sessionId)}>
                      {t(session.state === "recognized" || session.state === "ocr_deletion_pending"
                        ? "Delete recognized text and photo"
                        : "Delete photos")}
                    </button>
                  ) : null}
                </div>
              </div>
              {ocrProgress?.sessionId === session.sessionId ? (
                <div className="capture-photos__ocr-progress" role="status">
                  <span>{t("Reading photo {page} of {pageCount} on this device…", {
                    page: String(ocrProgress.page),
                    pageCount: String(ocrProgress.pageCount),
                  })}</span>
                  <progress max={1} value={ocrProgress.progress} />
                </div>
              ) : null}
              {preview?.sessionId === session.sessionId ? (
                <div className="capture-photos__preview">
                  {preview.urls.map((url, index) => (
                    <img key={url} src={url} alt={t("Prepared label photo {number}", { number: String(index + 1) })} />
                  ))}
                </div>
              ) : null}
              {shownOcrSession === session.sessionId && ocrResults[session.sessionId] ? (
                <section className="capture-photos__recognized" aria-label={t("Recognized label text")}>
                  <h5>{t("Recognized label text")}</h5>
                  {ocrResults[session.sessionId].pages.map((page, index) => (
                    <div key={`${session.sessionId}-${index}`}>
                      <strong>{t("Photo {number}", { number: String(index + 1) })}</strong>
                      <pre>{page.text}</pre>
                    </div>
                  ))}
                  {session.state === "ocr_deletion_pending" ? (
                    <p>{t("Your recognized text is saved. The private photo will be removed automatically when deletion is available.")}</p>
                  ) : null}
                </section>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
