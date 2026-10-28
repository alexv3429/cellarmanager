import { type FormEvent, useEffect, useState } from "react"

import {
  getMySharedWindowCandidates,
  submitSharedWindowCandidate,
  type SharedWindowCandidateStatus,
} from "../data/drinkingWindowCandidateSubmission"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  formatMl: number
  isOnline: boolean
  vintage: number
  wineId: string
}

function statusLabel(candidate: SharedWindowCandidateStatus): string {
  if (candidate.reviewStatus === "rejected" || candidate.reviewDisposition === "reject") return "Not retained for the shared reference"
  if (candidate.reviewDisposition === "propose") return "Reviewed as a candidate — not published"
  if (candidate.reviewDisposition === "investigate") return "Needs more research"
  return "Awaiting shared-reference review"
}

export function SharedWindowCandidatePanel({ formatMl, isOnline, vintage, wineId }: Props) {
  const { t } = useLanguage()
  const [first, setFirst] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [rationale, setRationale] = useState("")
  const [urls, setUrls] = useState("")
  const [candidates, setCandidates] = useState<SharedWindowCandidateStatus[]>([])
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isOnline) return
    let active = true
    void getMySharedWindowCandidates(wineId)
      .then((items) => {
        if (!active) return
        setAvailable(items !== null)
        if (items) setCandidates(items)
      })
      .catch((caught: unknown) => {
        if (active) {
          setAvailable(true)
          setError(caught instanceof Error ? caught.message : "Unable to load shared-date suggestions")
        }
      })
    return () => { active = false }
  }, [isOnline, wineId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline || busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await submitSharedWindowCandidate(wineId, vintage, {
        firstTrialYear: Number(first),
        bestStartYear: Number(start),
        bestEndYear: Number(end),
        rationale,
        evidenceUrls: urls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
      })
      setCandidates(await getMySharedWindowCandidates(wineId) ?? [])
      setMessage(t("Suggestion sent for shared-reference review. No cellar dates changed."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? t(caught.message) : t("Could not send this suggestion"))
    } finally {
      setBusy(false)
    }
  }

  if (!available) return null

  return <details className="research-inbox shared-window-candidate-panel">
    <summary>{t("Suggest dates for the shared reference")}</summary>
    <p>{t("For this exact wine, vintage and bottle size ({size} ml). This sends a proposal for review; it does not change your cellar or publish dates for anyone.", { size: String(formatMl) })}</p>
    {!isOnline ? <Notice tone="warning">{t("Reconnect to suggest shared dates.")}</Notice> : null}
    {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {candidates.length > 0 ? <div>
      <h3>{t("Your earlier suggestions")}</h3>
      <ul>{candidates.slice(0, 5).map((candidate) => <li key={candidate.id}>
        {candidate.firstTrialYear} / {candidate.bestStartYear}–{candidate.bestEndYear}
        {" · "}{t(statusLabel(candidate))}
      </li>)}</ul>
    </div> : null}
    <form onSubmit={(event) => void submit(event)}>
      <div className="drinking-window-review-years">
        <label>{t("Start tasting")}
          <input required inputMode="numeric" type="number" min={vintage} max="2300" value={first}
            onChange={(event) => setFirst(event.target.value)} />
        </label>
        <label>{t("Probable optimal period starts")}
          <input required inputMode="numeric" type="number" min={vintage} max="2300" value={start}
            onChange={(event) => setStart(event.target.value)} />
        </label>
        <label>{t("Probable optimal period ends")}
          <input required inputMode="numeric" type="number" min={vintage} max="2300" value={end}
            onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>
      <label>{t("Why these exact dates?")}
        <textarea required minLength={20} maxLength={2000} value={rationale}
          onChange={(event) => setRationale(event.target.value)} />
      </label>
      <label>{t("Sources, if available (one HTTPS link per line)")}
        <textarea value={urls} onChange={(event) => setUrls(event.target.value)} />
      </label>
      <p>{t("A reviewer must verify identity, evidence and reuse rights before any shared reference can be published. Your suggestion is not an approval.")}</p>
      <button disabled={!isOnline || busy} type="submit">{busy ? t("Sending…") : t("Send suggestion")}</button>
    </form>
  </details>
}
