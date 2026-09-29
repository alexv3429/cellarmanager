import { useCallback, useEffect, useRef, useState } from "react"

import {
  CapturePhotoError,
  CAPTURE_PREPROCESSING_LEASE_MS,
  deleteCapturePhotoSession,
  isCapturePhotoPreparationStale,
  listCaptureOcrResult,
  listPreparedCapturePhotos,
  listCapturePhotoSessions,
  processCapturePhotoSession,
  recognizeCapturePhotoSession,
  suggestCaptureWineCandidate,
  validateCapturePhotoFiles,
  uploadCapturePhotos,
  type CapturePhotoSession,
  type CaptureWineSuggestion,
  type CaptureWineTextField,
  type CaptureWineNumberField,
  type StoredCaptureOcrResult,
} from "../data/capturePhotos"
import { findCaptureWineMatchCandidates, findCaptureWineMatchesFromTranscript } from "../data/captureWineMatching"
import { formatWineVolume, type WineCatalogEntry } from "../data/wineCatalog"
import { useLanguage } from "../i18n/useLanguage"

interface CaptureWinePrefill {
  producer: string
  cuvee: string
  vintage: number | null
  color: string
  appellation: string
  area: string
  formatMl: number | null
}

interface CapturePhotosPanelProps {
  householdId: string
  isOnline: boolean
  userId: string
  wines: WineCatalogEntry[]
  onUseReviewedDetails: (details: CaptureWinePrefill) => void
}

function messageForError(error: unknown, t: (key: string) => string): string {
  if (error instanceof Error && error.name === "CaptureOcrEmptyError") {
    return t("We could not read any label text from this photo. Preview it and retry, or delete it; your cellar was not changed.")
  }
  if (!(error instanceof CapturePhotoError)) return t("Photo upload failed. Your cellar was not changed.")
  switch (error.kind) {
    case "invalid": return t("Choose one or two valid JPEG or PNG photos, each no larger than 6 MB.")
    case "count": return t("Select no more than two photos at a time.")
    case "size": return t("Each photo must be no larger than 6 MB. Choose a smaller file.")
    case "format": return t("This file could not be read as a JPEG or PNG image. Choose a different photo.")
    case "dimensions": return t("This photo is too large to prepare safely. Choose a smaller image.")
    case "server_photo": return t("The server rejected the prepared photo during a safety check. Refresh photo status; if it was removed, select it again. Your cellar was not changed.")
    case "processing": return t("Photo preparation was interrupted. Refresh the photo list; if it is still preparing after five minutes, you can retry. Your cellar was not changed.")
    case "ocr": return t("Label reading could not finish. Your cellar was not changed; you can retry later or delete the photo.")
    case "suggestion": return t("Could not suggest wine details from the saved text. Your cellar was not changed; review the label text or try again later.")
    case "limit": return t("The temporary photo limit has been reached. Delete an earlier capture or try again later.")
    case "permission": return t("Only the current household owner can upload these photos. Refresh your access and try again.")
    case "offline": return t("Reconnect before uploading photos. Photos are not queued offline.")
    case "upload_start": return t("Could not start the private photo upload. Refresh and try again. Your cellar was not changed.")
    case "upload_transfer": return t("The photo could not be transferred. Check your connection and try again. Your cellar was not changed.")
    case "upload_confirm": return t("The upload could not be confirmed. Refresh the photo list before retrying. Your cellar was not changed.")
    case "refresh": return t("Could not refresh photo status. Check your connection and try again.")
    case "delete": return t("Deletion is still pending. CellarManager will retry it automatically.")
    default: return t("Photo upload failed. Your cellar was not changed.")
  }
}

function sessionStateLabel(session: CapturePhotoSession, t: (key: string) => string): string {
  switch (session.state) {
    case "ready": return t("Ready to prepare privately")
    case "processing": return isCapturePhotoPreparationStale(session)
      ? t("Photo preparation appears stalled. Refresh photos to retry.")
      : t("Preparing photos…")
    case "processed": return t("Photos ready to read")
    case "ocr_deletion_pending": return t("Label ready; photo deletion pending")
    case "recognized": return t("Label ready to review")
    case "deletion_pending": return t("Deletion in progress")
    default: return t("Upload incomplete")
  }
}

function recognitionEngineLabel(engine: StoredCaptureOcrResult["engine"], t: (key: string) => string): string {
  switch (engine) {
    case "cloudflare": return t("Cloudflare Workers AI (Moondream)")
    case "tesseract": return t("On-device OCR (Tesseract)")
    default: return t("Recognition engine not recorded")
  }
}

function fieldConfidenceLabel(confidence: CaptureWineTextField["confidence"], t: (key: string) => string): string {
  switch (confidence) {
    case "high": return t("High confidence")
    case "medium": return t("Medium confidence")
    default: return t("Low confidence")
  }
}

function colorLabel(color: string, t: (key: string) => string): string {
  switch (color) {
    case "red": return t("Red")
    case "white": return t("White")
    case "rose": return t("Rosé")
    case "sparkling": return t("Sparkling")
    default: return t("Other")
  }
}

function fieldEvidence(label: string, field: CaptureWineTextField | CaptureWineNumberField, t: (key: string) => string) {
  return (
    <div className="capture-photos__field-meta" key={label}>
      <strong>{t(label)}</strong>
      <span>{fieldConfidenceLabel(field.confidence, t)}</span>
      {field.evidence.length > 0 ? (
        <span>{t("Label evidence")}: {field.evidence.map((line) => `“${line}”`).join(" · ")}</span>
      ) : (
        <span>{t("No supporting label text")}</span>
      )}
    </div>
  )
}

function prefillFromSuggestion(suggestion: CaptureWineSuggestion): CaptureWinePrefill {
  return {
    producer: suggestion.producer.value ?? "",
    cuvee: suggestion.cuvee.value ?? "",
    vintage: suggestion.vintage.status === "year" ? suggestion.vintage.value : null,
    color: suggestion.color.value ?? "",
    appellation: suggestion.appellation.value ?? "",
    area: suggestion.area.value ?? "",
    formatMl: suggestion.format_ml.value,
  }
}

function prefillFromWine(wine: WineCatalogEntry): CaptureWinePrefill {
  return {
    producer: wine.producer,
    cuvee: wine.cuvee,
    vintage: wine.vintage,
    color: wine.color,
    appellation: wine.appellation ?? "",
    area: wine.area ?? "",
    formatMl: wine.format_ml,
  }
}

export function CapturePhotosPanel({ householdId, isOnline, userId, wines, onUseReviewedDetails }: CapturePhotosPanelProps) {
  const { language, t } = useLanguage()
  const consentKey = `cellarmanager:photo-reading-consent:v1:${userId}`
  const [photoConsentForUser, setPhotoConsentForUser] = useState<string | null>(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem(consentKey) === "accepted" ? userId : null } catch { return null }
  })
  const photoConsent = photoConsentForUser === userId
  const [sessions, setSessions] = useState<CapturePhotoSession[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<{ sessionId: string; urls: string[] } | null>(null)
  const [ocrResults, setOcrResults] = useState<Record<string, StoredCaptureOcrResult>>({})
  const [shownOcrSession, setShownOcrSession] = useState<string | null>(null)
  const [ocrProgress, setOcrProgress] = useState<{ sessionId: string } | null>(null)
  const [ocrRetrySessions, setOcrRetrySessions] = useState<Record<string, boolean>>({})
  const [wineSuggestions, setWineSuggestions] = useState<Record<string, CaptureWineSuggestion>>({})
  const [suggestionProgress, setSuggestionProgress] = useState<string | null>(null)
  const previewRef = useRef<{ sessionId: string; urls: string[] } | null>(null)

  const clearPreview = useCallback(() => {
    previewRef.current?.urls.forEach((url) => URL.revokeObjectURL(url))
    previewRef.current = null
    setPreview(null)
  }, [])

  const refresh = useCallback(async ({ preserveError = false }: { preserveError?: boolean } = {}) => {
    if (!isOnline) return
    setLoading(true)
    if (!preserveError) setError("")
    try {
      setSessions(await listCapturePhotoSessions(householdId))
    } catch (loadError) {
      if (!preserveError) setError(messageForError(loadError, t))
    } finally {
      setLoading(false)
    }
  }, [householdId, isOnline, t])

  useEffect(() => {
    previewRef.current?.urls.forEach((url) => URL.revokeObjectURL(url))
    previewRef.current = null
    setPreview(null)
    try { setPhotoConsentForUser(window.localStorage.getItem(consentKey) === "accepted" ? userId : null) } catch { setPhotoConsentForUser(null) }
    setSessions([])
    setOcrResults({})
    setShownOcrSession(null)
    setOcrProgress(null)
    setWineSuggestions({})
    setSuggestionProgress(null)
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
  }, [consentKey, householdId, isOnline, t, userId])

  useEffect(() => {
    const now = Date.now()
    const retryAt = sessions
      .filter((session) => session.state === "processing" && session.processingStartedAt)
      .map((session) => Date.parse(session.processingStartedAt ?? "") + CAPTURE_PREPROCESSING_LEASE_MS)
      .filter((deadline) => Number.isFinite(deadline) && deadline > now)
      .sort((left, right) => left - right)[0]
    if (retryAt === undefined) return
    const timer = window.setTimeout(() => void refresh(), retryAt - now)
    return () => window.clearTimeout(timer)
  }, [sessions, refresh])

  const acceptPhotoConsent = () => {
    try { window.localStorage.setItem(consentKey, "accepted") } catch { /* The choice still applies to this visit. */ }
    setPhotoConsentForUser(userId)
  }

  const upload = async (chosen: FileList | null) => {
    const selected = chosen ? Array.from(chosen) : []
    if (selected.length === 0) return
    const validation = validateCapturePhotoFiles(selected)
    if (validation) {
      setError(messageForError(new CapturePhotoError(validation), t))
      return
    }
    if (!photoConsent) return
    if (!isOnline) {
      setError(messageForError(new CapturePhotoError("offline"), t))
      return
    }
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const result = await uploadCapturePhotos(householdId, selected)
      await refresh()
      let readyToRead = result.status === "processed"
      for (let attempt = 0; !readyToRead && attempt < 5; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000))
        try {
          const updated = await listCapturePhotoSessions(householdId)
          setSessions(updated)
          const state = updated.find((session) => session.sessionId === result.sessionId)?.state
          if (state === "processed") readyToRead = true
          else if (state !== "processing") break
        } catch { break }
      }
      if (readyToRead) {
        await recognize(result.sessionId)
      } else {
        setMessage(t("Photo preparation is taking longer than expected. Refresh the photos to continue reading this label."))
      }
    } catch (uploadError) {
      setError(messageForError(uploadError, t))
      await refresh({ preserveError: true })
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
        ? "Photo is ready. Continue reading this label below."
        : "Photos are still being prepared. Refresh to check their status."))
      await refresh()
    } catch (prepareError) {
      setError(messageForError(prepareError, t))
      await refresh({ preserveError: true })
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
    setOcrProgress({ sessionId })
    if (previewRef.current?.sessionId === sessionId) clearPreview()
    try {
      const saved = await recognizeCapturePhotoSession(sessionId)
      setOcrRetrySessions((current) => ({ ...current, [sessionId]: false }))
      setOcrResults((current) => ({ ...current, [sessionId]: { pages: saved.pages, engine: saved.engine } }))
      setShownOcrSession(sessionId)
      const directMatches = findCaptureWineMatchesFromTranscript(saved.pages, wines, householdId)
      setMessage(t(saved.state === "recognized"
        ? directMatches.length > 0
          ? "Possible catalogue match found. Check it before continuing."
          : "Label read. Review the suggested wine below."
        : "Text is saved privately. Photo deletion is still being retried; your cellar was not changed."))
      await refresh()
      if (saved.state === "recognized" && directMatches.length === 0) await suggestWineDetails(sessionId)
    } catch (recognitionError) {
      const noText = recognitionError instanceof Error && recognitionError.name === "CaptureOcrEmptyError"
      if (noText) setOcrRetrySessions((current) => ({ ...current, [sessionId]: true }))
      const displayError = recognitionError instanceof CapturePhotoError
        || noText
        ? recognitionError
        : new CapturePhotoError("ocr")
      setError(messageForError(displayError, t))
      await refresh({ preserveError: true })
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

  const suggestWineDetails = async (sessionId: string) => {
    setBusy(true)
    setError("")
    setMessage("")
    setSuggestionProgress(sessionId)
    try {
      const saved = await suggestCaptureWineCandidate(sessionId)
      setWineSuggestions((current) => ({ ...current, [sessionId]: saved.suggestion }))
      setMessage(t("Wine details were suggested from the saved label text. Review and correct them before using them."))
    } catch (suggestionError) {
      setError(messageForError(suggestionError, t))
    } finally {
      setSuggestionProgress(null)
      setBusy(false)
    }
  }

  const updateWineSuggestion = <K extends keyof CaptureWineSuggestion>(
    sessionId: string,
    field: K,
    update: Partial<CaptureWineSuggestion[K]>,
  ) => {
    setWineSuggestions((current) => {
      const suggestion = current[sessionId]
      if (!suggestion) return current
      return {
        ...current,
        [sessionId]: {
          ...suggestion,
          [field]: { ...suggestion[field], ...update },
        },
      }
    })
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
      await refresh({ preserveError: true })
    } finally {
      setBusy(false)
    }
  }

  const matchesBySession = Object.fromEntries(sessions.map((session) => {
    const direct = ocrResults[session.sessionId]
      ? findCaptureWineMatchesFromTranscript(ocrResults[session.sessionId].pages, wines, householdId)
      : []
    const inferred = wineSuggestions[session.sessionId]
      ? findCaptureWineMatchCandidates(wineSuggestions[session.sessionId], wines, householdId).map((match) => match.wine)
      : []
    return [session.sessionId, [...new Map([...direct, ...inferred].map((wine) => [wine.id, wine])).values()].slice(0, 3)]
  }))

  const locale = language === "fr" ? "fr-FR" : "en-US"

  return (
    <section className="capture-photos" aria-labelledby="capture-photos-title">
      <div className="capture-photos__intro">
        <div>
          <h3 id="capture-photos-title">{t("Add wine from a label")}</h3>
          <p>{t("Photograph one bottle at a time. You can use two photos when it has front and back labels.")}</p>
          <details className="capture-photos__privacy">
            <summary>{t("Photo privacy details")}</summary>
            <p>{t("After you choose a photo, CellarManager prepares it privately and sends it to Cloudflare AI to read the label. If no clear catalogue match is found, the recognized text is sent to the same service for editable suggestions. Cloudflare says it does not use submissions to train or improve its models. The text is saved privately, and the photo is deleted after a successful reading. Unread photos and saved text expire within 24 hours. No wine or bottle is added automatically.")}</p>
            {photoConsent ? (
              <button type="button" className="button-secondary" onClick={() => {
                try { window.localStorage.removeItem(consentKey) } catch { /* Consent still resets for this visit. */ }
                setPhotoConsentForUser(null)
              }}>{t("Forget my photo choice on this device")}</button>
            ) : null}
          </details>
        </div>
      </div>

      {!isOnline ? <p className="capture-photos__offline">{t("Reconnect before uploading photos. Photos are not queued offline.")}</p> : null}

      {!photoConsent ? (
        <div className="capture-photos__consent">
          <h4>{t("Before using a label photo")}</h4>
          <p>{t("Choosing a photo sends it to an external AI service to read this one bottle's label. If no clear match is found in your catalogue, its recognized text is also sent for editable suggestions. You review the result before adding bottles. Photos and text are temporary; no stock is changed automatically.")}</p>
          <button type="button" disabled={!isOnline} onClick={acceptPhotoConsent}>{t("I understand — continue with photos")}</button>
          <small>{t("This choice is remembered on this device for your account. You can review the photo privacy details above at any time.")}</small>
        </div>
      ) : (
        <>
          <div className="capture-photos__pickers">
            <label className="capture-photos__picker" aria-disabled={!isOnline || busy}>
              <span>{t("Take a photo of this bottle")}</span>
              <input
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                aria-label={t("Take a photo of this bottle")}
                capture="environment"
                disabled={!isOnline || busy}
                onChange={(event) => {
                  void upload(event.currentTarget.files)
                  event.currentTarget.value = ""
                }}
                type="file"
              />
            </label>
            <label className="capture-photos__picker" aria-disabled={!isOnline || busy}>
              <span>{t("Choose photos of this bottle")}</span>
              <input
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                aria-label={t("Choose photos of this bottle")}
                disabled={!isOnline || busy}
                multiple
                onChange={(event) => {
                  void upload(event.currentTarget.files)
                  event.currentTarget.value = ""
                }}
                type="file"
              />
            </label>
          </div>
          <p className="capture-photos__picker-help">{t("Choose one photo, or two photos of the front and back labels of the same bottle. Selecting photos starts the reading automatically.")}</p>
        </>
      )}

      {busy ? <p role="status">{t("Preparing and reading your label…")}</p> : null}

      {message ? <p role="status" className="capture-photos__message">{message}</p> : null}
      {error ? <p role="alert" className="capture-photos__error">{error}</p> : null}

      {sessions.length > 0 ? (
        <div className="capture-photos__sessions">
          <div className="capture-photos__sessions-heading">
            <h4>{t("Your label photos")}</h4>
            <button type="button" className="button-secondary" onClick={() => void refresh()} disabled={!isOnline || loading || busy}>
              {loading ? t("Loading…") : t("Refresh photos")}
            </button>
          </div>
          {sessions.map((session) => (
            <article className="capture-photos__session" key={session.sessionId}>
              <div className="capture-photos__session-info">
                <div>
                  <strong>{sessionStateLabel(session, t)}</strong>
                  <p>{session.state === "recognized" || session.state === "ocr_deletion_pending"
                    ? t("Label text expires {date}", {
                      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.expiresAt)),
                    })
                    : <>{t(session.photoCount === 1 ? "1 photo" : "{count} photos", { count: String(session.photoCount) })} · {t("Expires {date}", {
                      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.expiresAt)),
                    })}</>}</p>
                </div>
                <div className="capture-photos__session-actions">
                  {session.state === "ready" ? (
                    <button type="button" disabled={busy || !isOnline} onClick={() => void prepare(session.sessionId)}>
                      {busy ? t("Preparing…") : t("Prepare photos")}
                    </button>
                  ) : null}
                  {session.state === "processing" && isCapturePhotoPreparationStale(session) ? (
                    <button type="button" disabled={busy || !isOnline} onClick={() => void prepare(session.sessionId)}>
                      {busy ? t("Preparing…") : t("Retry preparation")}
                    </button>
                  ) : null}
                  {session.state === "processed" ? (
                    <>
                      <button type="button" disabled={busy || !isOnline || !photoConsent} onClick={() => void recognize(session.sessionId)}>
                        {ocrProgress?.sessionId === session.sessionId
                          ? t("Reading label…")
                          : t(ocrRetrySessions[session.sessionId] ? "Retry label reading" : "Continue reading label")}
                      </button>
                      <button type="button" className="button-secondary" disabled={busy || !isOnline} onClick={() => void togglePreview(session.sessionId)}>
                        {preview?.sessionId === session.sessionId ? t("Hide photos") : t("Preview photos")}
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
                      {shownOcrSession === session.sessionId ? t("Hide label review") : t("Review label")}
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
                  <span>{t("Reading label…")}</span>
                  <progress />
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
                <section className="capture-photos__recognized" aria-label={t("Review label")}>
                  {session.state === "ocr_deletion_pending" ? (
                    <p>{t("Your recognized text is saved. The private photo will be removed automatically when deletion is available.")}</p>
                  ) : null}
                  {session.state === "recognized" ? (
                    <div className="capture-photos__suggestion">
                      {matchesBySession[session.sessionId]?.length > 0 ? (
                        <div className="capture-photos__matches">
                          <h5>{t("Possible match in your catalogue")}</h5>
                          <p>{t("Check the name and vintage. Choosing a match fills the bottle form; it does not add stock.")}</p>
                          {matchesBySession[session.sessionId].map((match) => (
                            <article className="capture-photos__match" key={match.id}>
                              <div>
                                <strong>{match.producer} — {match.cuvee}</strong>
                                <span>{match.appellation ? `${match.appellation} · ` : ""}{match.vintage ?? t("NV")} · {colorLabel(match.color, t)} · {formatWineVolume(match.format_ml)}</span>
                              </div>
                              <button type="button" className="button-secondary" onClick={() => onUseReviewedDetails(prefillFromWine(match))}>
                                {t("Continue with this wine")}
                              </button>
                            </article>
                          ))}
                        </div>
                      ) : null}
                      {!wineSuggestions[session.sessionId] ? (
                        <>
                          {matchesBySession[session.sessionId]?.length > 0 ? (
                            <p>{t("Not the right wine? Ask for editable label details instead.")}</p>
                          ) : (
                            <>
                              <h5>{t("Find the wine on this label")}</h5>
                              <p>{t("We can suggest the producer, cuvée and vintage from the saved label text. Check everything before continuing.")}</p>
                            </>
                          )}
                          <button
                            type="button"
                            disabled={busy || !isOnline || !photoConsent}
                            onClick={() => void suggestWineDetails(session.sessionId)}
                          >
                            {suggestionProgress === session.sessionId ? t("Analyzing label text…") : t(matchesBySession[session.sessionId]?.length > 0 ? "Suggest other details" : "Suggest wine details")}
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="capture-photos__review-heading">
                            <h5>{t("Check the wine details")}</h5>
                            <p>{t("Suggestions can be wrong. Correct the fields before continuing.")}</p>
                          </div>
                          <h6>{t("Details from the label")}</h6>
                          <div className="capture-photos__suggestion-fields">
                            {([
                              ["producer", "Producer / winery"],
                              ["cuvee", "Cuvée"],
                            ] as const).map(([field, label]) => {
                              const value = wineSuggestions[session.sessionId][field]
                              return (
                                <label key={field}>
                                  {t(label)}
                                  <input
                                    value={value.value ?? ""}
                                    onChange={(event) => updateWineSuggestion(session.sessionId, field, {
                                      value: event.target.value || null,
                                      evidence: [],
                                      confidence: "low",
                                    })}
                                  />
                                </label>
                              )
                            })}
                            <label>
                              {t("Vintage")}
                              <select
                                value={wineSuggestions[session.sessionId].vintage.status}
                                onChange={(event) => {
                                  const status = event.target.value as CaptureWineSuggestion["vintage"]["status"]
                                  updateWineSuggestion(session.sessionId, "vintage", {
                                    status,
                                    value: status === "year" ? wineSuggestions[session.sessionId].vintage.value : null,
                                    evidence: [],
                                    confidence: "low",
                                  })
                                }}
                              >
                                <option value="year">{t("Year is visible")}</option>
                                <option value="non_vintage">{t("Explicitly non-vintage")}</option>
                                <option value="not_visible">{t("Not visible / unknown")}</option>
                              </select>
                              {wineSuggestions[session.sessionId].vintage.status === "year" ? (
                                <input
                                  aria-label={t("Vintage year")}
                                  inputMode="numeric"
                                  min="1800"
                                  max="2200"
                                  step="1"
                                  type="number"
                                  value={wineSuggestions[session.sessionId].vintage.value ?? ""}
                                  onChange={(event) => updateWineSuggestion(session.sessionId, "vintage", {
                                    value: /^\d{4}$/u.test(event.target.value)
                                      && Number(event.target.value) >= 1800
                                      && Number(event.target.value) <= 2200
                                      ? Number(event.target.value)
                                      : null,
                                    evidence: [],
                                    confidence: "low",
                                  })}
                                />
                              ) : null}
                            </label>
                            <label>
                              {t("Color")}
                              <select
                                value={wineSuggestions[session.sessionId].color.value ?? ""}
                                onChange={(event) => updateWineSuggestion(session.sessionId, "color", {
                                  value: (event.target.value || null) as CaptureWineSuggestion["color"]["value"],
                                  evidence: [],
                                  confidence: "low",
                                })}
                              >
                                <option value="">{t("Unknown")}</option>
                                <option value="red">{t("Red")}</option>
                                <option value="white">{t("White")}</option>
                                <option value="rose">{t("Rosé")}</option>
                                <option value="sparkling">{t("Sparkling")}</option>
                                <option value="other">{t("Other")}</option>
                              </select>
                            </label>
                            <label>
                              {t("Bottle format (ml)")}
                              <input
                                inputMode="numeric"
                                min="1"
                                max="20000"
                                step="1"
                                type="number"
                                value={wineSuggestions[session.sessionId].format_ml.value ?? ""}
                                onChange={(event) => updateWineSuggestion(session.sessionId, "format_ml", {
                                  value: /^\d+$/u.test(event.target.value)
                                    && Number(event.target.value) > 0
                                    && Number(event.target.value) <= 20000
                                    ? Number(event.target.value)
                                    : null,
                                  evidence: [],
                                  confidence: "low",
                                })}
                              />
                            </label>
                          </div>
                          <details className="capture-photos__more-details">
                            <summary>{t("More wine details")}</summary>
                            <div className="capture-photos__suggestion-fields">
                              {([
                                ["appellation", "Appellation"],
                                ["area", "Area / region"],
                              ] as const).map(([field, label]) => (
                                <label key={field}>
                                  {t(label)}
                                  <input
                                    value={wineSuggestions[session.sessionId][field].value ?? ""}
                                    onChange={(event) => updateWineSuggestion(session.sessionId, field, {
                                      value: event.target.value || null,
                                      evidence: [],
                                      confidence: "low",
                                    })}
                                  />
                                </label>
                              ))}
                            </div>
                          </details>
                          <button
                            type="button"
                            className="capture-photos__continue"
                            disabled={!wineSuggestions[session.sessionId].producer.value?.trim()
                              || !wineSuggestions[session.sessionId].cuvee.value?.trim()}
                            onClick={() => onUseReviewedDetails(prefillFromSuggestion(wineSuggestions[session.sessionId]))}
                          >
                            {t("Continue to add bottles")}
                          </button>
                          <p className="capture-photos__fine-print">{t("This fills the bottle form; no wine or bottle is saved until you confirm there.")}</p>
                          <details className="capture-photos__evidence">
                            <summary>{t("Why were these details suggested?")}</summary>
                            <p>{t("Compare the suggestions with the exact label text. Edited fields have no supporting quote.")}</p>
                            <div className="capture-photos__evidence-list">
                              {([
                                ["producer", "Producer / winery"],
                                ["cuvee", "Cuvée"],
                                ["appellation", "Appellation"],
                                ["area", "Area / region"],
                                ["vintage", "Vintage"],
                                ["color", "Color"],
                                ["format_ml", "Bottle format (ml)"],
                              ] as const).map(([field, label]) => fieldEvidence(label, wineSuggestions[session.sessionId][field], t))}
                            </div>
                          </details>
                        </>
                      )}
                    </div>
                  ) : null}
                  <details className="capture-photos__transcript">
                    <summary>{t("View exact label text")}</summary>
                    <p>{t("Recognition engine")}: {recognitionEngineLabel(ocrResults[session.sessionId].engine, t)}</p>
                    {ocrResults[session.sessionId].pages.map((page, index) => (
                      <div key={`${session.sessionId}-${index}`}>
                        <strong>{t("Photo {number}", { number: String(index + 1) })}</strong>
                        <pre>{page.text}</pre>
                      </div>
                    ))}
                  </details>
                </section>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
