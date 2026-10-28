import { type FormEvent, useEffect, useState } from "react"

import {
  getSourceIntakes, reviewSourceIntake, submitSourceIntake,
  type SourceIntake, type SourceKind,
} from "../data/drinkingWindowSourceIntake"
import { changeDraftRowEvidence } from "../data/drinkingWindowDraftCorrections"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  versionId: string
  rowId: string
  rowHash: string
  linkedEvidenceIds: string[]
  isOnline: boolean
  onChanged: () => Promise<void>
}

export function DraftSourceIntakePanel({ versionId, rowId, rowHash, linkedEvidenceIds, isOnline, onChanged }: Props) {
  const { t } = useLanguage()
  const [items, setItems] = useState<SourceIntake[]>([])
  const [sourceName, setSourceName] = useState("")
  const [sourceKind, setSourceKind] = useState<SourceKind>("producer")
  const [sourceUrl, setSourceUrl] = useState("")
  const [claimNote, setClaimNote] = useState("")
  const [rightsUrl, setRightsUrl] = useState("")
  const [rightsNote, setRightsNote] = useState("")
  const [reviewNote, setReviewNote] = useState("")
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [datesChecked, setDatesChecked] = useState(false)
  const [rightsChecked, setRightsChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function reload() {
    setItems(await getSourceIntakes(versionId, rowId))
  }

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    void getSourceIntakes(versionId, rowId).then((result) => {
      if (!cancelled) setItems(result)
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load source intake")
    })
    return () => { cancelled = true }
  }, [versionId, rowId, isOnline])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline || busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await submitSourceIntake({ versionId, rowId, expectedHash: rowHash,
        sourceName, sourceKind, sourceUrl, claimNote,
        rightsEvidenceUrl: rightsUrl, rightsNote })
      await reload()
      setMessage(t("Source recorded for review. It is not linked to the draft."))
      setSourceName("")
      setSourceUrl("")
      setClaimNote("")
      setRightsUrl("")
      setRightsNote("")
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to record source")
    } finally {
      setBusy(false)
    }
  }

  async function review(item: SourceIntake, verdict: "approve" | "reject") {
    if (!isOnline || busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await reviewSourceIntake({ intakeId: item.id, expectedHash: rowHash,
        verdict, reviewNote, datesChecked, rightsChecked })
      await reload()
      if (verdict === "approve") {
        await onChanged()
        setMessage(t("Source verified. Link it to the draft window below, then review the window again."))
      } else {
        setMessage(t("Source rejected. The draft and cellar advice are unchanged."))
      }
      setReviewNote("")
      setDatesChecked(false)
      setRightsChecked(false)
      setReviewingId(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to review source")
    } finally {
      setBusy(false)
    }
  }

  async function link(evidenceId: string) {
    if (!isOnline || busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await changeDraftRowEvidence({ versionId, rowId, expectedHash: rowHash,
        action: "attach", evidenceId })
      await onChanged()
      setMessage(t("Source linked. The draft needs a fresh review; no cellar advice changed."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to link verified source")
    } finally {
      setBusy(false)
    }
  }

  return <details className="drinking-window-source-intake">
    <summary>{t("Register and verify a new source")}</summary>
    <p>{t("Use this only when the source itself states all three exact years for this wine. A general ageing description or a research synthesis is not direct evidence for these dates.")}</p>
    <p>{t("Record a citation first. A reviewer then checks the dates and reuse rights separately. Nothing is linked or published automatically.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <form onSubmit={(event) => void submit(event)}>
      <label>{t("Source name")}<input required minLength={3} maxLength={160} value={sourceName}
        onChange={(event) => setSourceName(event.target.value)} /></label>
      <label>{t("Source type")}
        <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as SourceKind)}>
          <option value="producer">{t("Producer")}</option>
          <option value="critic">{t("Critic")}</option>
          <option value="provider">{t("Other publisher")}</option>
          <option value="vintage-report">{t("Vintage report")}</option>
        </select>
      </label>
      <label>{t("Exact source page (HTTPS)")}<input required type="url" value={sourceUrl}
        onChange={(event) => setSourceUrl(event.target.value)} /></label>
      <label>{t("Where does this page state the three dates?")}
        <textarea required minLength={20} maxLength={2000} value={claimNote}
          onChange={(event) => setClaimNote(event.target.value)} /></label>
      <label>{t("Rights or terms page (HTTPS)")}<input required type="url" value={rightsUrl}
        onChange={(event) => setRightsUrl(event.target.value)} /></label>
      <label>{t("Why may we display, store and reuse this citation and these facts?")}
        <textarea required minLength={20} maxLength={2000} value={rightsNote}
          onChange={(event) => setRightsNote(event.target.value)} /></label>
      <button type="submit" disabled={!isOnline || busy}>{t("Record source for review")}</button>
    </form>
    <h5>{t("Source assessments for this draft")}</h5>
    {items.length === 0 ? <p>{t("No source has been submitted for this draft.")}</p> :
      <ul>{items.map((item) => <li key={item.id}>
        <strong>{item.sourceName}</strong> · {t(item.status)} · {item.firstTrialYear} / {item.bestStartYear}–{item.bestEndYear}
        <p><a href={item.sourceUrl} target="_self">{t("Open source page")}</a> · <a href={item.rightsEvidenceUrl} target="_self">{t("Open rights page")}</a></p>
        <p>{t("Date assessment")}: {item.claimNote}</p>
        <p>{t("Rights assessment")}: {item.rightsNote}</p>
        {item.reviewNote ? <p>{t("Review reason")}: {item.reviewNote}</p> : null}
        {item.status === "approved" && item.evidenceId && !linkedEvidenceIds.includes(item.evidenceId)
          ? <button type="button" disabled={!isOnline || busy}
            onClick={() => void link(item.evidenceId!)}>{t("Link this verified source to the draft")}</button> : null}
        {item.status === "pending" ? <div className="drinking-window-source-review">
          {item.rowHash !== rowHash ? <p role="status">{t("The draft changed. Submit a new source assessment for its current dates.")}</p> : null}
          <button type="button" disabled={!isOnline || busy} aria-expanded={reviewingId === item.id}
            onClick={() => {
              setReviewingId(reviewingId === item.id ? null : item.id)
              setReviewNote("")
              setDatesChecked(false)
              setRightsChecked(false)
            }}>{t(reviewingId === item.id ? "Hide source review" : "Review this source")}</button>
          {reviewingId === item.id ? <>
            {item.rowHash === rowHash ? <>
            <label><input type="checkbox" checked={datesChecked}
              onChange={(event) => setDatesChecked(event.target.checked)} />
              {t("I checked that this page explicitly states all three dates for this exact wine")}</label>
            <label><input type="checkbox" checked={rightsChecked}
              onChange={(event) => setRightsChecked(event.target.checked)} />
              {t("I checked the documented rights to display, store and reuse the citation and facts across households")}</label>
            </> : null}
            <label>{t("Review reason")}<textarea minLength={20} maxLength={2000} value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)} /></label>
            <div className="drinking-window-source-actions">
              {item.rowHash === rowHash ? <button type="button" disabled={!isOnline || busy || !datesChecked || !rightsChecked || reviewNote.trim().length < 20}
                onClick={() => void review(item, "approve")}>{t("Verify this source")}</button> : null}
              <button type="button" disabled={!isOnline || busy || reviewNote.trim().length < 20}
                onClick={() => void review(item, "reject")}>{t("Reject this source")}</button>
            </div>
          </> : null}
        </div> : null}
      </li>)}</ul>}
  </details>
}
