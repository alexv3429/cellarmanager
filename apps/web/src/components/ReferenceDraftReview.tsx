import { type FormEvent, useEffect, useState } from "react"

import {
  getReferenceDrafts,
  recordReferenceReview,
  type ReferenceDraftWorkspace,
  type ReferenceSubject,
  type ReferenceVerdict,
} from "../data/drinkingWindowReferenceDrafts"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props { isOnline: boolean }

function detailText(subject: ReferenceSubject): string {
  if (subject.kind === "row") {
    const values = subject.details
    return `${values.first_trial_year} → ${values.best_start_year}–${values.best_end_year}`
  }
  if (subject.kind === "membership") {
    const values = subject.details
    return `${values.member_kind} · ${values.first_vintage_year ?? "—"}–${values.last_vintage_year ?? "—"}`
  }
  return String(subject.details.scope ?? "")
}

export function ReferenceDraftReview({ isOnline }: Props) {
  const { t } = useLanguage()
  const [workspace, setWorkspace] = useState<ReferenceDraftWorkspace | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<ReferenceVerdict>("approve")
  const [rationale, setRationale] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function refresh() {
    if (!isOnline) return
    setLoading(true)
    setError(null)
    try {
      setWorkspace(await getReferenceDrafts())
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to load reference drafts")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    void getReferenceDrafts()
      .then((result) => { if (!cancelled) setWorkspace(result) })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load reference drafts")
      })
    return () => { cancelled = true }
  }, [isOnline])

  async function save(event: FormEvent<HTMLFormElement>, versionId: string, subject: ReferenceSubject) {
    event.preventDefault()
    if (!isOnline) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await recordReferenceReview({
        versionId, kind: subject.kind, subjectId: subject.id,
        expectedHash: subject.hash, verdict, rationale,
      })
      setMessage(t("Review recorded. The reference remains unpublished."))
      setRationale("")
      await refresh()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to record reference review")
    } finally {
      setSaving(false)
    }
  }

  if (workspace && !workspace.eligible) return null

  return <section className="drinking-window-reference-review">
    <div className="research-inbox__heading">
      <div>
        <h3>{t("Actual reference drafts")}</h3>
        <p>{t("Check each date, ageing-group boundary, exact wine membership and source before deciding. Approval records a curator decision; it does not publish advice or change any cellar.")}</p>
      </div>
      <button type="button" disabled={!isOnline || loading} onClick={() => void refresh()}>
        {loading ? t("Refreshing…") : t("Refresh drafts")}
      </button>
    </div>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {workspace?.drafts.length === 0 ? <p>{t("No reference version awaiting review.")}</p> : null}
    {workspace?.drafts.map((draft) => <div key={draft.versionId}>
      <h4>{t("Reference version")} {draft.versionNumber} · {t("Unpublished draft")}</h4>
      {draft.subjects.map((subject) => {
        const key = `${draft.versionId}:${subject.kind}:${subject.id}`
        return <details key={key} className="research-inbox" open={selected === key}>
          <summary onClick={() => {
            setSelected(selected === key ? null : key)
            setRationale("")
            setVerdict("approve")
          }}>
            <span><strong>{t(subject.kind === "row" ? "Window" : subject.kind === "group" ? "Ageing group" : "Exact membership")} · {subject.title}</strong>
              <small>{subject.issues.length ? subject.issues.map((issue) => t(issue)).join(", ") : t("Current approval recorded")}</small>
            </span>
          </summary>
          <div className="drinking-window-review-form">
            <p>{detailText(subject)}</p>
            <p>{subject.rationale}</p>
            <h5>{t("Linked sources")}</h5>
            {subject.evidence.length === 0 ? <p>{t("No source linked; do not approve before checking.")}</p> :
              <ul>{subject.evidence.map((evidence, index) => <li key={index}>
                {evidence.sourceUrl?.startsWith("https://") ?
                  <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.sourceName}</a> : evidence.sourceName}
                {` · ${evidence.claimPart} · ${evidence.reviewStatus} · ${evidence.reuseRight}`}
              </li>)}</ul>}
            {subject.reviews.length ? <p>{t("Current curator decisions")}: {subject.reviews.map((review) =>
              `${t(review.verdict === "approve" ? "Approved" : "Disputed")} — ${review.rationale}`).join("; ")}</p> : null}
            <form onSubmit={(event) => void save(event, draft.versionId, subject)}>
              <label>{t("Decision")}
                <select value={verdict} onChange={(event) => setVerdict(event.target.value as ReferenceVerdict)}>
                  <option value="approve">{t("Approve this exact draft")}</option>
                  <option value="disagree">{t("Disagree; needs correction")}</option>
                </select>
              </label>
              <label>{t("Why this decision?")}
                <textarea required minLength={10} maxLength={2000} value={rationale}
                  onChange={(event) => setRationale(event.target.value)} />
              </label>
              <button type="submit" disabled={!isOnline || saving || rationale.trim().length < 10}>
                {saving ? t("Saving…") : t("Record curator decision")}
              </button>
            </form>
          </div>
        </details>
      })}
    </div>)}
  </section>
}
