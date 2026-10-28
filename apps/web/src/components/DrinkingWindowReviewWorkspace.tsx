import { type FormEvent, useEffect, useState } from "react"

import {
  getDrinkingWindowReviewWorkspace,
  saveDrinkingWindowCandidateReview,
  stageDrinkingWindowCandidateAsDraft,
  type CandidateReviewDraft,
  type DrinkingWindowCandidate,
  type DrinkingWindowReviewWorkspace as Workspace,
  type ReviewDisposition,
  type ReviewScope,
  type RightsStatus,
} from "../data/drinkingWindowReview"
import { getReferenceDrafts, type ReferenceDraft } from "../data/drinkingWindowReferenceDrafts"
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
  const ownerProposal = candidate.sourceIdentity.origin === "cellar-owner-proposal"
  const ownerRationale = ownerProposal && typeof candidate.sourceIdentity.rationale === "string"
    ? candidate.sourceIdentity.rationale : ""
  const ownerUrls = ownerProposal && Array.isArray(candidate.sourceIdentity.evidence_urls)
    ? candidate.sourceIdentity.evidence_urls.filter((url): url is string => typeof url === "string") : []
  return {
    scope: review?.proposedScope ?? (candidate.candidateScope === "quarantine" ? "" : candidate.candidateScope as ReviewScope),
    first: String(review?.firstTrialYear ?? candidate.firstTrialYear ?? ""),
    bestStart: String(review?.bestStartYear ?? candidate.bestStartYear ?? ""),
    bestEnd: String(review?.bestEndYear ?? candidate.bestEndYear ?? ""),
    group: review?.ageingGroupNote ?? String(candidate.sourceIdentity.historical_bin ?? ""),
    rationale: review?.rationale ?? ownerRationale,
    urls: review?.evidenceUrls.join("\n") ?? ownerUrls.join("\n"),
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

function sourceLabel(candidate: DrinkingWindowCandidate): string {
  return candidate.sourceIdentity.origin === "cellar-owner-proposal"
    ? "Cellar owner suggestion" : candidate.sourceLocator
}

export function DrinkingWindowReviewWorkspace({ isOnline }: Props) {
  const { t } = useLanguage()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [staging, setStaging] = useState(false)
  const [baseDrafts, setBaseDrafts] = useState<ReferenceDraft[]>([])
  const [baseVersionId, setBaseVersionId] = useState("")
  const [draftRefreshKey, setDraftRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function refresh() {
    if (!isOnline) return
    setLoading(true)
    setError(null)
    try {
      const [next, references] = await Promise.all([
        getDrinkingWindowReviewWorkspace(), getReferenceDrafts(),
      ])
      setWorkspace(next)
      setBaseDrafts(references.drafts)
      setBaseVersionId((previous) => references.drafts.some((draft) => draft.versionId === previous) ? previous : "")
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
    void Promise.all([getDrinkingWindowReviewWorkspace(), getReferenceDrafts()])
      .then(([next, references]) => {
        if (!cancelled) {
          setWorkspace(next)
          setBaseDrafts(references.drafts)
        }
      })
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

  async function stage() {
    if (!selected?.review || !baseVersionId || !isOnline) return
    setStaging(true)
    setError(null)
    setMessage(null)
    try {
      const result = await stageDrinkingWindowCandidateAsDraft({
        candidateId: selected.id,
        expectedReviewId: selected.review.id,
        baseVersionId,
      })
      setMessage(t("Shared draft version {version} created. Dates are not published; evidence and all subjects still need review.", {
        version: String(result.versionNumber),
      }))
      setBaseVersionId("")
      await refresh()
      setDraftRefreshKey((value) => value + 1)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to create a shared draft")
    } finally {
      setStaging(false)
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

    <ReferenceDraftReview key={draftRefreshKey} isOnline={isOnline} />

    <h3>{t("Reference candidates")} ({workspace.candidates.length})</h3>
    <p>{t("Workbook and cellar-owner suggestions are unverified candidates, not approved advice. Check the exact wine, three dates, evidence and reuse rights.")}</p>
    {workspace.candidates.length === 0 ? <p>{t("No staged reference candidates yet.")}</p> :
      <div className="drinking-window-review-layout">
        <ul className="drinking-window-review-list">{workspace.candidates.map((candidate) =>
          <li key={candidate.id}>
            <button type="button" aria-pressed={selectedId === candidate.id} onClick={() => select(candidate)}>
              {label(candidate.sourceIdentity.producer || candidate.sourceIdentity.region)} · {label(candidate.sourceIdentity.cuvee)} · {candidate.vintageYear ?? "—"}
            </button>
            <small>{t(sourceLabel(candidate))} · {candidate.review?.disposition ?? t("Not reviewed")}</small>
          </li>
        )}</ul>
        {selected && form ? <form className="drinking-window-review-form" onSubmit={(event) => void save(event)}>
          <h4>{t("Review candidate")}: {t(sourceLabel(selected))}</h4>
          <p>{t("Original source")}: {label(selected.sourceIdentity.producer)} · {label(selected.sourceIdentity.cuvee)} · {label(selected.sourceIdentity.appellation)} · {label(selected.sourceIdentity.region)} · {selected.vintageYear ?? "—"} · {selected.wineColor ?? "—"}</p>
          {selected.sourceIdentity.origin === "cellar-owner-proposal"
            ? <p>{t("Original dates")}: {selected.firstTrialYear ?? "—"} / {selected.bestStartYear ?? "—"}–{selected.bestEndYear ?? "—"} · {t("Bottle size: {size} ml", { size: String(selected.sourceIdentity.format_ml ?? "—") })}</p>
            : <p>{t("Original ageing category")}: {label(selected.sourceIdentity.historical_bin)} · {t("Original dates")}: {selected.bestStartYear ?? "—"}–{selected.bestEndYear ?? "—"}</p>}
          {selected.sourceIdentity.origin === "cellar-owner-proposal"
            ? <p>{t("Submitted reasoning to verify")}: {label(selected.sourceIdentity.rationale)}</p> : null}
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
          {selected.review?.disposition === "propose" && selected.review.proposedScope === "release"
            && selected.sourceIdentity.origin === "cellar-owner-proposal" ? <div className="drinking-window-review-staging">
              <h4>{t("Prepare a new shared draft")}</h4>
              <p>{t("The saved proposal will be added to a copy of the selected draft. The current draft and cellar advice stay unchanged. Sources must still be linked and every subject reviewed before publication.")}</p>
              <label>{t("Copy this draft version")}
                <select value={baseVersionId} onChange={(event) => setBaseVersionId(event.target.value)}>
                  <option value="">{t("Choose a draft version")}</option>
                  {baseDrafts.map((draft) => <option key={draft.versionId} value={draft.versionId}>
                    {t("Reference version {number}", { number: String(draft.versionNumber) })} · {draft.subjects.length} {t("subjects")}
                  </option>)}
                </select>
              </label>
              <button type="button" disabled={!isOnline || staging || saving || !baseVersionId
                || JSON.stringify(form) !== JSON.stringify(formFor(selected))}
                onClick={() => void stage()}>
                {staging ? t("Preparing…") : t("Create a new unpublished draft")}
              </button>
              {JSON.stringify(form) !== JSON.stringify(formFor(selected))
                ? <small>{t("Save your changes before preparing the draft.")}</small> : null}
            </div> : null}
        </form> : null}
      </div>}
  </details>
}
