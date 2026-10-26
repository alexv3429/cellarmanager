import { type FormEvent, useEffect, useState } from "react"

import {
  getReferenceDrafts,
  recordReferenceReview,
  type ReferenceDraftWorkspace,
  type ReferenceEvidence,
  type ReferenceSubject,
  type ReferenceVerdict,
} from "../data/drinkingWindowReferenceDrafts"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props { isOnline: boolean }

function subjectDetails(subject: ReferenceSubject, t: (key: string, values?: Record<string, string>) => string) {
  if (subject.kind === "row") {
    const scope = String(subject.details.scope ?? "")
    const format = subject.details.format_ml
    return <>
      <p>{t("Reference level")}: {t(scope === "release" ? "Exact wine and vintage" : {
        producer_appellation: "Producer and appellation", producer_region: "Producer and region",
        appellation: "Appellation", region: "Region",
      }[scope] ?? scope)}{typeof format === "number" ? <> · {t("Bottle size: {size} ml", { size: String(format) })}</> : null}</p>
      <dl className="drinking-window-review-milestones">
        <div><dt>{t("Start tasting")}</dt><dd>{String(subject.details.first_trial_year)}</dd></div>
        <div><dt>{t("Optimum starts")}</dt><dd>{String(subject.details.best_start_year)}</dd></div>
        <div><dt>{t("Optimum ends")}</dt><dd>{String(subject.details.best_end_year)}</dd></div>
      </dl>
    </>
  }
  if (subject.kind === "membership") return <p>{t("Eligible wine and vintage")}: {subject.title}
    {subject.details.first_vintage_year === subject.details.last_vintage_year
      ? ""
      : ` · ${subject.details.first_vintage_year ?? "—"}–${subject.details.last_vintage_year ?? "—"}`}</p>
  const scope = String(subject.details.scope ?? "")
  const scopeLabel = {
    release: "Exact wine and vintage", producer_appellation: "Producer and appellation",
    producer_region: "Producer and region", appellation: "Appellation", region: "Region",
  }[scope] ?? scope
  return <p>{t("Reference level")}: {t(scopeLabel)} · {t("Color")}: {t(String(subject.details.wine_color ?? ""))}</p>
}

function groupedEvidence(evidence: ReferenceEvidence[]) {
  const groups = new Map<string, { source: ReferenceEvidence; claimParts: string[] }>()
  for (const source of evidence) {
    const key = [source.sourceUrl, source.sourceName, source.evidenceRole, source.reviewStatus, source.reuseRight].join("\u0000")
    const group = groups.get(key)
    if (group) {
      if (!group.claimParts.includes(source.claimPart)) group.claimParts.push(source.claimPart)
    } else {
      groups.set(key, { source, claimParts: [source.claimPart] })
    }
  }
  return [...groups.values()]
}

export function ReferenceDraftReview({ isOnline }: Props) {
  const { t } = useLanguage()
  const [workspace, setWorkspace] = useState<ReferenceDraftWorkspace | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<ReferenceVerdict | "">("")
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
    if (!isOnline || !verdict) return
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
      setVerdict("")
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
        <p>{t("You have permission to review proposals for the shared wine reference. Check the dates, the exact wine and the evidence. Your decision does not publish advice or change any cellar.")}</p>
      </div>
      <button type="button" disabled={!isOnline || loading} onClick={() => void refresh()}>
        {loading ? t("Refreshing…") : t("Refresh drafts")}
      </button>
    </div>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {workspace?.drafts.length === 0 ? <p>{t("No reference version awaiting review.")}</p> : null}
    {workspace?.drafts.map((draft) => {
      const pendingCount = draft.subjects.filter((subject) => subject.issues.length > 0).length
      return <div key={draft.versionId}>
        <h4>{t("Reference version")} {draft.versionNumber} · {t("Unpublished draft")}</h4>
        <p>{pendingCount} {t(pendingCount === 1
          ? "draft item still needs review"
          : "draft items still need review")}</p>
        {[...draft.subjects].sort((a, b) => Number(b.issues.length > 0) - Number(a.issues.length > 0)).map((subject) => {
        const key = `${draft.versionId}:${subject.kind}:${subject.id}`
        return <details key={key} className="research-inbox" open={selected === key}>
          <summary onClick={() => {
            setSelected(selected === key ? null : key)
            setRationale("")
            setVerdict("")
          }}>
            <span><strong>{t(subject.kind === "row" ? "Window" : subject.kind === "group" ? "Ageing group" : "Exact membership")} · {subject.title}</strong>
              <small>{subject.issues.length ? subject.issues.map((issue) => t(issue)).join(", ") : t("Current approval recorded")}</small>
            </span>
          </summary>
          <div className="drinking-window-review-form">
            {subjectDetails(subject, t)}
            {subject.evidence.some((evidence) => evidence.sourceName === "Owner-reviewed first shared drinking-window estimate") ?
              <p>{t("Here, owner means the CellarManager cellar owner who proposed the dates, not the wine producer.")}</p> : null}
            <h5>{t(subject.kind === "row" ? "Why these dates?" : "Why this draft?")}</h5>
            <p>{t(subject.rationale)}</p>
            {subject.kind === "row" ? <p>{t("Before approving, check that the evidence supports each proposed year. A general ageing claim or an owner's estimate is not a producer-published optimum window.")}</p> : null}
            <h5>{t("Linked sources")}</h5>
            {subject.evidence.length === 0 ? <p>{t("No source linked; do not approve before checking.")}</p> :
              <ul>{groupedEvidence(subject.evidence).map(({ source, claimParts }, index) => <li key={index}>
                {source.sourceUrl?.startsWith("https://") ?
                  <a href={source.sourceUrl} target="_self">{t(source.sourceName)}</a> : t(source.sourceName)}
                <span> · {claimParts.map((claimPart) => t(claimPart)).join(", ")}</span>
                <small className="drinking-window-review-source-status">{source.reviewStatus === "reviewed" ? t("Source record reviewed") : `${t("Source record")}: ${t(source.reviewStatus)}`} · {t(source.reuseRight)}</small>
                {source.sourceUrl?.startsWith("https://") ? <small className="drinking-window-review-source-status">{t("Opens the source in this tab; use Back to return to the review.")}</small> : null}
              </li>)}</ul>}
            {subject.reviews.length ? <p>{t("Current reviewer decisions")}: {subject.reviews.map((review) =>
              `${t(review.verdict === "approve" ? "Approved" : "Disputed")} — ${review.rationale}`).join("; ")}</p> : null}
            <form onSubmit={(event) => void save(event, draft.versionId, subject)}>
              <label>{t("Decision")}
                <select required value={verdict} onChange={(event) => setVerdict(event.target.value as ReferenceVerdict | "")}>
                  <option disabled value="">{t("Choose a decision")}</option>
                  <option value="approve">{t("Approve this exact draft")}</option>
                  <option value="disagree">{t("Flag a disagreement; block publication")}</option>
                </select>
              </label>
              {verdict === "disagree" ? <p role="status">{t("A disagreement blocks publication but does not change these dates. Explain what should change, including your proposed dates if you have them. A revised draft must then be prepared and reviewed.")}</p> : null}
              <label>{t(verdict === "disagree" ? "What should be corrected?" : "Why this decision?")}
                <textarea required minLength={10} maxLength={2000} value={rationale}
                  onChange={(event) => setRationale(event.target.value)} />
              </label>
              <button type="submit" disabled={!isOnline || saving || !verdict || rationale.trim().length < 10}>
                {saving ? t("Saving…") : t(verdict === "disagree" ? "Record disagreement" : "Record review decision")}
              </button>
            </form>
          </div>
        </details>
        })}
      </div>
    })}
  </section>
}
