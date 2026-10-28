import { type FormEvent, useEffect, useState } from "react"

import {
  changeDraftRowEvidence,
  correctDraftRow,
  getDraftRowCorrection,
  type DraftRowCorrection,
} from "../data/drinkingWindowDraftCorrections"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  versionId: string
  rowId: string
  subjectHash: string
  isOnline: boolean
  onChanged: () => Promise<void>
}

function validYear(value: string): number {
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1800 || result > 2300) {
    throw new Error("Enter a valid year")
  }
  return result
}

export function DraftRowCorrectionEditor({ versionId, rowId, subjectHash, isOnline, onChanged }: Props) {
  const { t } = useLanguage()
  const [row, setRow] = useState<DraftRowCorrection | null>(null)
  const [first, setFirst] = useState("")
  const [bestStart, setBestStart] = useState("")
  const [bestEnd, setBestEnd] = useState("")
  const [rationale, setRationale] = useState("")
  const [selectedEvidence, setSelectedEvidence] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function reload() {
    const current = await getDraftRowCorrection(versionId, rowId)
    setRow(current)
    setFirst(String(current.firstTrialYear))
    setBestStart(String(current.bestStartYear))
    setBestEnd(String(current.bestEndYear))
    setRationale(current.rationale)
    return current
  }

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    void getDraftRowCorrection(versionId, rowId).then((current) => {
      if (cancelled) return
      setRow(current)
      setFirst(String(current.firstTrialYear))
      setBestStart(String(current.bestStartYear))
      setBestEnd(String(current.bestEndYear))
      setRationale(current.rationale)
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load draft correction")
    })
    return () => { cancelled = true }
  }, [versionId, rowId, subjectHash, isOnline])

  async function saveDates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!row || !isOnline) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await correctDraftRow({
        versionId, rowId, expectedHash: row.hash,
        firstTrialYear: validYear(first), bestStartYear: validYear(bestStart),
        bestEndYear: validYear(bestEnd), rationale,
      })
      await reload()
      await onChanged()
      setMessage(t("Draft corrected. Earlier approval must be reviewed again; no cellar advice changed."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to correct draft")
    } finally {
      setBusy(false)
    }
  }

  async function changeEvidence(action: "attach" | "remove", evidenceId: string) {
    if (!row || !isOnline) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await changeDraftRowEvidence({
        versionId, rowId, expectedHash: row.hash,
        action, evidenceId,
      })
      await reload()
      await onChanged()
      setMessage(t("Source links changed. Earlier approval must be reviewed again; no cellar advice changed."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to change draft sources")
    } finally {
      setBusy(false)
    }
  }

  return <section className="drinking-window-draft-correction">
    <h5>{t("Correct this unpublished window")}</h5>
    <p>{t("Only this draft changes. A correction cancels earlier approval for this row; it does not publish dates or change your cellar.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {!row ? <p>{t("Loading draft correction…")}</p> : <>
      <form onSubmit={(event) => void saveDates(event)}>
        <div className="drinking-window-review-years">
          <label>{t("Start tasting")}<input type="number" inputMode="numeric" required min="1800" max="2300" value={first} onChange={(event) => setFirst(event.target.value)} /></label>
          <label>{t("Optimum starts")}<input type="number" inputMode="numeric" required min="1800" max="2300" value={bestStart} onChange={(event) => setBestStart(event.target.value)} /></label>
          <label>{t("Optimum ends")}<input type="number" inputMode="numeric" required min="1800" max="2300" value={bestEnd} onChange={(event) => setBestEnd(event.target.value)} /></label>
        </div>
        <label>{t("Why these dates?")}
          <textarea required minLength={10} maxLength={2000} value={rationale}
            onChange={(event) => setRationale(event.target.value)} />
        </label>
        <button type="submit" disabled={!isOnline || busy}>{t("Save corrected dates")}</button>
      </form>
      <h5>{t("Date evidence")}</h5>
      <p>{t("Only reviewed, reusable sources for this exact wine appear here. A submitted URL alone is not verified evidence.")}</p>
      <p>{t("One reviewed source supports the whole three-date window.")}</p>
      {row.linked.length ? <ul>{row.linked.filter((link, index, links) =>
        links.findIndex((other) => other.evidenceId === link.evidenceId) === index).map((link) => <li key={link.evidenceId}>
        {link.sourceUrl ? <a href={link.sourceUrl} target="_self">{link.sourceName}</a> : link.sourceName}
        {" · "}{t(link.reviewStatus)} · {t(link.reuseRight)}
        {row.linked.some((other) => other.evidenceId === link.evidenceId
          && other.evidenceRole === "supports" && (other.claimPart === "first_trial" || other.claimPart === "optimal_period"))
          ? <> <button type="button" disabled={!isOnline || busy}
            onClick={() => void changeEvidence("remove", link.evidenceId)}>
            {t("Remove source link")}</button></> : null}
      </li>)}</ul> : <p>{t("No source is linked to this window yet.")}</p>}
      {row.available.length ? <div className="drinking-window-review-staging">
        <label>{t("Reviewed source")}
          <select value={selectedEvidence} onChange={(event) => setSelectedEvidence(event.target.value)}>
            <option value="">{t("Choose a reviewed source")}</option>
            {row.available.map((source) => <option key={source.evidenceId} value={source.evidenceId}>
              {source.sourceName}{source.sourceUrl ? ` · ${source.sourceUrl}` : ""}
            </option>)}
          </select>
        </label>
        <button type="button" disabled={!isOnline || busy || !selectedEvidence}
          onClick={() => void changeEvidence("attach", selectedEvidence)}>{t("Link reviewed source")}</button>
      </div> : <p>{t("No reviewed reusable source is available for this exact wine yet. Registering and verifying a new source is a separate step.")}</p>}
      {row.history.length ? <details><summary>{t("Correction history")}</summary>
        <ul>{row.history.map((event, index) => <li key={`${event.createdAt}:${index}`}>
          {new Date(event.createdAt).toLocaleString()} · {t(event.action)}
        </li>)}</ul>
      </details> : null}
    </>}
  </section>
}
