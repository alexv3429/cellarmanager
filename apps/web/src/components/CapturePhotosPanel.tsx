import { useCallback, useEffect, useState } from "react"

import {
  CapturePhotoError,
  deleteCapturePhotoSession,
  listCapturePhotoSessions,
  validateCapturePhotoFiles,
  uploadCapturePhotos,
  type CapturePhotoSession,
} from "../data/capturePhotos"
import { useLanguage } from "../i18n/useLanguage"

interface CapturePhotosPanelProps {
  householdId: string
  isOnline: boolean
  userId: string
}

function messageForError(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof CapturePhotoError)) return t("Photo upload failed. Your cellar was not changed.")
  switch (error.kind) {
    case "invalid": return t("Choose one or two JPEG or PNG photos, each no larger than 6 MB.")
    case "limit": return t("The temporary photo limit has been reached. Delete an earlier capture or try again later.")
    case "permission": return t("Only the current household owner can upload these photos. Refresh your access and try again.")
    case "offline": return t("Reconnect before uploading photos. Photos are not queued offline.")
    case "delete": return t("Deletion is still pending. CellarManager will retry it automatically.")
    default: return t("Photo upload failed. Your cellar was not changed.")
  }
}

function sessionStateLabel(session: CapturePhotoSession, t: (key: string) => string): string {
  switch (session.state) {
    case "ready": return t("Photos stored privately; image processing is not available yet.")
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
    setFiles([])
    setSessions([])
    setMessage("")
    setError("")
    if (!isOnline) return
    let active = true
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
    return () => { active = false }
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
      await uploadCapturePhotos(householdId, files)
      setFiles([])
      setMessage(t("Photos uploaded. They are private and will be deleted after 24 hours unless processed sooner."))
      await refresh()
    } catch (uploadError) {
      setFiles([])
      setError(messageForError(uploadError, t))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (sessionId: string) => {
    setBusy(true)
    setError("")
    setMessage("")
    try {
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
          <p>{t("Upload one or two label photos for a later wine-identification step. Photos stay private, are not shown or analyzed yet, and expire after 24 hours. No wine or bottle is added.")}</p>
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
            {busy ? t("Uploading…") : t("Upload photos")}
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
              <div>
                <strong>{sessionStateLabel(session, t)}</strong>
                <p>{t(session.photoCount === 1 ? "1 photo" : "{count} photos", { count: String(session.photoCount) })} · {t("Expires {date}", {
                  date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.expiresAt)),
                })}</p>
              </div>
              {session.state !== "deletion_pending" ? (
                <button type="button" className="button-secondary" disabled={busy || !isOnline} onClick={() => void remove(session.sessionId)}>
                  {t("Delete photos")}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
