import { type FormEvent, useEffect, useState } from "react"

import {
  getDrinkingWindowReviewWorkspace,
  saveDrinkingWindowCandidateReview,
  type CandidateReviewDraft,
  type DrinkingWindowCandidate,
  type DrinkingWindowReviewWorkspace as Workspace,
  type ReviewDisposition,
  type ReviewScope,
  type RightsStatus,
} from "../data/drinkingWindowReview"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"
import { ReferenceDraftReview } from "./ReferenceDraftReview"

interface Props { isOnline: boolean }

interface FormState {
  scope: ReviewScope | ""
  first: string
  bestStart: string
  bestEnd: string
  group: string
  rationale: string
  urls: string
  rights: RightsStatus
  disposition: ReviewDisposition
}

function formFor(candidate: DrinkingWindowCandidate): FormState {
  const review = candidate.review
  return {
    scope: review?.proposedScope ?? (candidate.candidateScope === "quarantine" ? "" : candidate.candidateScope as ReviewScope),
    first: String(review?.firstTrialYear ?? candidate.firstTrialYear ?? ""),
    bestStart: String(review?.bestStartYear ?? candidate.bestStartYear ?? ""),
    bestEnd: String(review?.bestEndYear ?? candidate.bestEndYear ?? ""),
    group: review?.ageingGroupNote ?? String(candidate.sourceIdentity.historical_bin ?? ""),
    rationale: review?.rationale ?? "",
    urls: review?.evidenceUrls.join("\n") ?? "",
    rights: review?.rightsStatus ?? "unverified",
    disposition: review?.disposition ?? "investigate",
  }
}

function optionalYear(value: string): number | null {
  if (!value.trim()) return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1800 || number > 2300) throw new Error("Enter a valid year or leave it blank")
  return number
}

function label(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "—"
}

export function DrinkingWindowReviewWorkspace({ isOnline }: Props) {
  const { t } = useLanguage()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function refresh() {
    if (!isOnline) return
    setLoading(true)
    setError(null)
    try {
      const next = await getDrinkingWindowReviewWorkspace()
      setWorkspace(next)
      if (selectedId) {
        const candidate = next.candidates.find((item) => item.id === selectedId)
        if (candidate) setForm(formFor(candidate))
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to load drinking-window reviews")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setWorkspace(null)
    if (!isOnline) return
    let cancelled = false
    void getDrinkingWindowReviewWorkspace()
      .then((next) => { if (!cancelled) setWorkspace(next) })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load drinking-window reviews")
      })
    return () => { cancelled = true }
  }, [isOnline])

  const selected = workspace?.candidates.find((item) => item.id === selectedId) ?? null
  if (!workspace?.eligible) return null

  function select(candidate: DrinkingWindowCandidate) {
    setSelectedId(candidate.id)
    setForm(formFor(candidate))
    setError(null)
    setMessage(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !form || !isOnline) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (!form.scope) throw new Error(t("Choose a proposal scope before saving"))
      const draft: CandidateReviewDraft = {
        candidateId: selected.id,
        expectedReviewId: selected.review?.id ?? null,
        proposedScope: form.scope,
        firstTrialYear: optionalYear(form.first),
        bestStartYear: optionalYear(form.bestStart),
        bestEndYear: optionalYear(form.bestEnd),
        ageingGroupNote: form.group.trim(),
        rationale: form.rationale.trim(),
        evidenceUrls: form.urls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
        rightsStatus: form.rights,
        disposition: form.disposition,
      }
      await saveDrinkingWindowCandidateReview(draft)
      setMessage(t("Review draft saved. No drinking-window advice changed."))
      await refresh()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to save review draft")
    } finally {
      setSaving(false)
    }
  }

  return <details className="research-inbox drinking-window-review-workspace">
    <summary>
      <span>
        <strong>{t("Shared drinking-window review")}</strong>
        <small>{t("Curator workspace · drafts only")}</small>
      </span>
      <span aria-hidden="true" className="research-inbox__chevron">▾</span>
    </summary>
    <div className="research-inbox__heading">
      <div>
        <h2>{t("Shared drinking-window review")}</h2>
        <p>{t("Review missing wine identities and source candidates. Nothing here publishes advice or changes a household wine.")}</p>
      </div>
      <button type="button" disabled={!isOnline || loading} onClick={() => void refresh()}>{loading ? t("Refreshing…") : t("Refresh")}</button>
    </div>
    {!isOnline ? <Notice tone="warning">{t("Reconnect to review shared drinking windows.")}</Notice> : null}
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}

    <h3>{t("Missing shared wine identities")} ({workspace.identityRequests.length})</h3>
    <p>{t("These owner requests need identity research. This queue cannot rename or link their wines.")}</p>
    {workspace.identityRequests.length === 0 ? <p>{t("No pending identity requests.")}</p> :
      <ul className="drinking-window-review-list">{workspace.identityRequests.map((request) =>
        <li key={request.id}>
          <strong>{request.producer ?? "—"} · {request.cuvee ?? "—"} · {request.vintage ?? t("No vintage")}</strong>
          <span>{request.appellation ?? "—"} · {request.region ?? "—"} · {request.color ?? "—"}</span>
          {request.sourceChanged ? <small>{t("Owner data changed since this request; verify before acting.")}</small> : null}
        </li>
      )}</ul>}

    <ReferenceDraftReview isOnline={isOnline} />

    <h3>{t("Reference candidates")} ({workspace.candidates.length})</h3>
    <p>{t("Workbook dates are historical candidates, not approved advice. Supply a coherent three-date proposal and traceable evidence.")}</p>
    {workspace.candidates.length === 0 ? <p>{t("No staged reference candidates yet.")}</p> :
      <div className="drinking-window-review-layout">
        <ul className="drinking-window-review-list">{workspace.candidates.map((candidate) =>
          <li key={candidate.id}>
            <button type="button" aria-pressed={selectedId === candidate.id} onClick={() => select(candidate)}>
              {label(candidate.sourceIdentity.producer || candidate.sourceIdentity.region)} · {label(candidate.sourceIdentity.cuvee)} · {candidate.vintageYear ?? "—"}
            </button>
            <small>{candidate.sourceLocator} · {candidate.review?.disposition ?? t("Not reviewed")}</small>
          </li>
        )}</ul>
        {selected && form ? <form className="drinking-window-review-form" onSubmit={(event) => void save(event)}>
          <h4>{t("Review candidate")}: {selected.sourceLocator}</h4>
          <p>{t("Original source")}: {label(selected.sourceIdentity.producer)} · {label(selected.sourceIdentity.cuvee)} · {label(selected.sourceIdentity.appellation)} · {label(selected.sourceIdentity.region)} · {selected.vintageYear ?? "—"} · {selected.wineColor ?? "—"}</p>
          <p>{t("Original ageing category")}: {label(selected.sourceIdentity.historical_bin)} · {t("Original dates")}: {selected.bestStartYear ?? "—"}–{selected.bestEndYear ?? "—"}</p>
          {selected.reviewReason ? <p>{t("Review issue")}: {selected.reviewReason}</p> : null}
          <label>{t("Proposed scope")}
            <select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as ReviewScope })}>
              <option value="">{t("Choose a scope")}</option>
              <option value="release">{t("Exact wine and vintage")}</option>
              <option value="producer_appellation">{t("Producer and appellation")}</option>
              <option value="producer_region">{t("Producer and region")}</option>
              <option value="appellation">{t("Appellation")}</option>
              <option value="region">{t("Region")}</option>
            </select>
          </label>
          <div className="drinking-window-review-years">
            <label>{t("Start tasting")}<input inputMode="numeric" type="number" min="1800" max="2300" value={form.first} onChange={(event) => setForm({ ...form, first: event.target.value })} /></label>
            <label>{t("Optimum starts")}<input inputMode="numeric" type="number" min="1800" max="2300" value={form.bestStart} onChange={(event) => setForm({ ...form, bestStart: event.target.value })} /></label>
            <label>{t("Optimum ends")}<input inputMode="numeric" type="number" min="1800" max="2300" value={form.bestEnd} onChange={(event) => setForm({ ...form, bestEnd: event.target.value })} /></label>
          </div>
          <label>{t("Ageing category / applicability to verify")}
            <input maxLength={500} value={form.group} onChange={(event) => setForm({ ...form, group: event.target.value })} />
          </label>
          <label>{t("Evidence links (one HTTPS URL per line)")}
            <textarea value={form.urls} onChange={(event) => setForm({ ...form, urls: event.target.value })} />
          </label>
          <label>{t("Evidence and date rationale")}
            <textarea required minLength={10} maxLength={2000} value={form.rationale} onChange={(event) => setForm({ ...form, rationale: event.target.value })} />
          </label>
          <label>{t("Source reuse rights")}
            <select value={form.rights} onChange={(event) => setForm({ ...form, rights: event.target.value as RightsStatus })}>
              <option value="unverified">{t("Not verified")}</option>
              <option value="reuse-allowed">{t("Reuse checked")}</option>
              <option value="restricted">{t("Restricted")}</option>
            </select>
          </label>
          <label>{t("Draft disposition")}
            <select value={form.disposition} onChange={(event) => setForm({ ...form, disposition: event.target.value as ReviewDisposition })}>
              <option value="investigate">{t("Needs research")}</option>
              <option value="propose">{t("Complete proposal")}</option>
              <option value="reject">{t("Reject candidate")}</option>
            </select>
          </label>
          <button type="submit" disabled={!isOnline || saving}>{saving ? t("Saving…") : t("Save review draft")}</button>
          <small>{t("Saving a draft does not publish or change drinking-window advice.")}</small>
        </form> : null}
      </div>}
  </details>
}
