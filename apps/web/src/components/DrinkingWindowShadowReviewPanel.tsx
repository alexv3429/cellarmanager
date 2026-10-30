import { useEffect, useMemo, useState } from "react"

import {
  getDrinkingWindowRolloutStatus,
  getShadowReport,
  listShadowReports,
  refreshDrinkingWindowDraftShadowReport,
  requestDrinkingWindowShadowReport,
  type DrinkingWindowRolloutStatus,
  type ShadowComparisonRow,
  type ShadowReport,
  type ShadowReportListing,
} from "../data/drinkingWindowShadowReview"
import { orderShadowComparisonRows } from "../data/shadowComparisonOrdering"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface WineLabel {
  id: string
  producer: string
  cuvee: string
  vintage: number | null
}

interface Props {
  householdId: string
  isOnline: boolean
  onOpenWine: (wineId: string) => void
  wines: WineLabel[]
}

function comparisonLabel(status: string): string {
  switch (status) {
    case "changed": return "Proposed dates differ"
    case "unchanged": return "Same dates"
    case "manual_preserved": return "Your manual dates stay"
    case "new_reference_no_baseline": return "New proposed dates"
    case "expired_baseline": return "Previous estimate expired"
    case "no_match": return "No reviewed match"
    case "missing_key": return "Not enough confirmed details"
    case "ambiguous": return "Several possible matches"
    case "identity_conflict": return "Wine details conflict"
    default: return "Needs review"
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case "manual_override": return "Manual window"
    case "model": return "Model estimate"
    case "personalized_model": return "Model estimate with your timing"
    case "expired_model": return "Previous model estimate"
    case "expired_personalized_model": return "Previous model estimate with your timing"
    case "reviewed_reference": return "Current reviewed reference"
    default: return "No previous window"
  }
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "release": return "Exact wine and vintage"
    case "producer_appellation": return "Producer and appellation"
    case "producer_region": return "Producer and region"
    case "appellation": return "Appellation"
    case "region": return "Regional profile; check eligibility below"
    default: return "Reference profile"
  }
}

const backgroundComparisonStatuses = new Set([
  "manual_preserved", "no_match", "missing_key", "unchanged",
])

function reviewOpenKey(householdId: string): string {
  return `cellarmanager:drinking-window-review-open:${householdId}`
}

function wasReviewOpen(householdId: string): boolean {
  try { return sessionStorage.getItem(reviewOpenKey(householdId)) === "true" }
  catch { return false }
}

function rememberReviewOpen(householdId: string, open: boolean): void {
  try { sessionStorage.setItem(reviewOpenKey(householdId), String(open)) }
  catch { /* Storage may be unavailable in private browsing. */ }
}

function WindowMilestones({
  first, start, end, t,
}: {
  first: number | null
  start: number | null
  end: number | null
  t: (key: string) => string
}) {
  if (first === null || start === null || end === null) {
    return <p>{t("No three-date window available")}</p>
  }
  return <dl className="drinking-window-shadow-review__milestones">
    <div><dt>{t("Start tasting")}</dt><dd>{first}</dd></div>
    <div><dt>{t("Probable optimal period starts")}</dt><dd>{start}</dd></div>
    <div><dt>{t("Probable optimal period ends")}</dt><dd>{end}</dd></div>
  </dl>
}

export function DrinkingWindowShadowReviewPanel({
  householdId, isOnline, onOpenWine, wines,
}: Props) {
  const { t } = useLanguage()
  const [list, setList] = useState<ShadowReportListing[] | null>(null)
  const [rollout, setRollout] = useState<DrinkingWindowRolloutStatus | null>(null)
  const [report, setReport] = useState<ShadowReport | null>(null)
  const [shown, setShown] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(() => wasReviewOpen(householdId))
  const currentListing = list?.find((entry) => entry.versionStatus !== "withdrawn")
  const history = list?.filter((entry) => entry.reportId !== currentListing?.reportId) ?? []

  useEffect(() => {
    setList(null)
    setRollout(null)
    setReport(null)
    setError(null)
    if (!isOnline) return
    let cancelled = false
    void Promise.all([
      listShadowReports(householdId),
      getDrinkingWindowRolloutStatus(householdId),
    ])
      .then(async ([next, status]) => {
        if (cancelled) return
        setList(next)
        setRollout(status)
        const latest = next.find((entry) => entry.versionStatus !== "withdrawn")
        if (latest && wasReviewOpen(householdId)) {
          const loaded = await getShadowReport(latest)
          if (!cancelled) setReport(loaded)
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        const text = caught instanceof Error ? caught.message : String(caught)
        // Other household members have no owner report to inspect.
        if (text.includes("Only the household owner")) setList([])
        else setError(text)
      })
    return () => { cancelled = true }
  }, [householdId, isOnline])

  const names = useMemo(() => new Map(wines.map((wine) => [
    wine.id,
    `${wine.producer} · ${wine.cuvee} · ${wine.vintage ?? "NV"}`,
  ])), [wines])
  const orderedRows = useMemo(() => report
    ? orderShadowComparisonRows(report.rows, names)
    : [], [report, names])
  const focusRows = orderedRows.filter((row) =>
    !backgroundComparisonStatuses.has(row.comparisonStatus))
  const otherRows = orderedRows.filter((row) =>
    backgroundComparisonStatuses.has(row.comparisonStatus))
  const changedCount = report?.rows.filter((row) => row.comparisonStatus === "changed").length ?? 0
  const conflictingIdentityCount = report?.rows.filter((row) =>
    row.draftStatus === "ambiguous" || row.draftStatus === "identity_conflict").length ?? 0

  async function prepareComparison(draft: boolean) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const id = draft
        ? await refreshDrinkingWindowDraftShadowReport(householdId)
        : await requestDrinkingWindowShadowReport(householdId)
      const next = await listShadowReports(householdId)
      setList(next)
      const current = next.find((entry) => entry.reportId === id)
      if (current) await openReport(current)
      if (draft) setMessage(t(id === currentListing?.reportId
        ? "Nothing changed in this comparison."
        : "A new comparison is ready to inspect."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function openReport(listing: ShadowReportListing) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      setReport(await getShadowReport(listing))
      setShown(30)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  function renderComparisonRow(row: ShadowComparisonRow) {
    if (!report) return null
    return <li key={row.wineId}>
      <button className="wine-detail-link" onClick={() => {
        setExpanded(true)
        rememberReviewOpen(householdId, true)
        onOpenWine(row.wineId)
      }} type="button">
        {names.get(row.wineId) ?? row.wineId}
      </button>
      <span>{t(comparisonLabel(row.comparisonStatus))}</span>
      {row.draftStatus === "identity_conflict" ? <p>{t(row.reason === "appellation_outside_region"
        ? "The appellation and region disagree. Check both against the bottle before editing this wine."
        : "This wine has conflicting details. Check its identity against the bottle before editing.")}</p> : null}
      {row.draftStatus === "ambiguous" ? <p>{t("Several wine identities match. Review this wine before approving the comparison.")}</p> : null}
      <div className="drinking-window-shadow-review__comparison">
        <section>
          <h4>{t("Dates currently used in your cellar")}</h4>
          <WindowMilestones first={row.currentFirstTrialYear}
            start={row.currentBestStartYear} end={row.currentBestEndYear} t={t} />
          <small>{t(sourceLabel(row.currentSource))}</small>
          {row.currentSource === "model" || row.currentSource === "personalized_model"
            ? <p>{t("These current dates come from the existing model, not this draft. Open the wine above, then ‘When to drink’ → ‘Why this estimate?’ to see the contributing profiles.")}</p>
            : null}
        </section>
        <section>
          <h4>{t(report.versionStatus === "draft"
            ? "Draft dates — not in use"
            : "Compared shared-reference dates")}</h4>
          <WindowMilestones first={row.proposedFirstTrialYear}
            start={row.proposedBestStartYear} end={row.proposedBestEndYear} t={t} />
        </section>
      </div>
      {row.matchedScope ? <p><strong>{t("Reference level")}:</strong> {t(scopeLabel(row.matchedScope))}</p> : null}
      {row.proposedGroupDefinition ? <p><strong>{t("Which wines qualify?")}</strong> {t(row.proposedGroupDefinition)}</p> : null}
      {row.proposedReferenceRationale ? <p><strong>{t("Where do these dates come from?")}</strong> {t(row.proposedReferenceRationale)}</p> : null}
    </li>
  }

  if (!isOnline || (list?.length === 0 && rollout?.activeVersionNumber === null)) return null

  return <details className="drinking-window-shadow-review"
    open={expanded}
    onToggle={(event) => {
      const open = event.currentTarget.open
      setExpanded(open)
      rememberReviewOpen(householdId, open)
    }}>
    <summary>{t("Compare shared drinking-window dates")}</summary>
    <p>{t("This optional comparison does not approve or switch dates. Published dates are available to all cellars; your private dates still take priority.")}</p>
    {rollout?.activeVersionNumber ? <div>
      <p>{t("Latest reference version")}: {rollout.activeVersionNumber}.
        {rollout.selectedEnabled && rollout.selectedVersionNumber
          ? ` ${t("Shared dates are available from version")} ${rollout.selectedVersionNumber}.`
          : ` ${t("Shared reference is currently paused.")}`}</p>
      <button disabled={busy || !rollout.globalEnabled}
        onClick={() => void prepareComparison(false)} type="button">
        {t("Compare the latest reference with my cellar")}
      </button>
    </div> : null}
    {currentListing?.versionStatus === "draft" ? <div>
      <button disabled={busy} onClick={() => void prepareComparison(true)} type="button">
        {t("Refresh this draft comparison")}
      </button>
      <p>{t("After editing a wine card, refresh to see the new result. This does not approve dates or change your cellar.")}</p>
    </div> : null}
    {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {list === null ? <p>{t("Loading review reports…")}</p> : null}
    {currentListing ? <button
      disabled={busy}
      onClick={() => void openReport(currentListing)}
      type="button"
    >{t("Latest comparison")} · {t("Reference version")} {currentListing.versionNumber}
      {` · ${t(currentListing.versionStatus === "draft" && currentListing.draftIssueCount > 0
        ? "Draft under review — no action needed"
        : currentListing.versionStatus === "draft"
          ? "Unpublished proposal"
          : "Published reference")}`}
    </button> : null}
    {history.length > 0 ? <details className="drinking-window-shadow-review__history">
      <summary>{t("Earlier comparisons and withdrawn versions")}</summary>
      <p>{t("These are saved snapshots, not wines to approve. Their counts do not update after you edit a wine.")}</p>
      {history.map((entry) => <button disabled={busy} key={entry.reportId}
        onClick={() => void openReport(entry)} type="button">
        {t("Reference version")} {entry.versionNumber} · {t("Comparison from")} {new Date(entry.recordedAt).toLocaleDateString()}
        {` · ${t(entry.versionStatus === "withdrawn"
          ? "Withdrawn — no review needed"
          : entry.latestVerdict === "approve" || entry.latestVerdict === "reject"
            ? "Earlier pilot decision — history only"
              : "Older snapshot")}`}
      </button>)}
    </details> : null}

    {report ? <section aria-label={t("Detailed drinking-window comparison")}>
      <h3>{t("Reference version")} {report.versionNumber}
        {report.versionStatus === "draft" ? ` · ${t("Unpublished draft")}` : ""}</h3>
      <p>{report.wineCount} {t("wines")} · {changedCount} {t(changedCount === 1
        ? "proposal with different dates"
        : "proposals with different dates")} · {report.draftIssueCount} {t("pending reference checks")}</p>
      <p>{conflictingIdentityCount} {t("wine cards with conflicting details in this comparison")}. {t("The wine total is how many cards were compared, not how many dates need approval.")}</p>
      <p>{t("Comparison from")} {new Date(report.recordedAt).toLocaleDateString()}. {t("This is a saved snapshot. Edits to wine cards appear only in a newer comparison.")}</p>
      {report.versionStatus === "withdrawn" ? <Notice tone="warning">
        {t("This reference version has been withdrawn. Keep it only as history; there is nothing to approve.")}
      </Notice> : null}
      {report.versionStatus === "draft" ? <p>{t("This draft is not in use. Your cellar still shows its current dates.")}</p>
        : <p>{t("The current dates are the ones you see in your cellar, including your personal timing choice.")}</p>}
      {report.draftIssueCount > 0 ? <Notice tone="warning">
        {t("{count} reference checks are still pending. This draft cannot be published yet.", { count: String(report.draftIssueCount) })}
      </Notice> : null}
      {conflictingIdentityCount > 0 ? <Notice tone="warning">
        {t("{count} wine cards have conflicting details in this comparison. These are not date proposals to approve. Check them against the bottles; after editing, use a newer comparison.", { count: String(conflictingIdentityCount) })}
      </Notice> : null}
      <h4>{t("Comparison results")}</h4>
      <p>{t("A wine name opens its card. This report is informational; it does not control publication.")}</p>
      {focusRows.length > 0 ? <ol className={`drinking-window-shadow-review__rows${focusRows.length <= 5
        ? " drinking-window-shadow-review__rows--short" : ""}`}>
        {focusRows.map(renderComparisonRow)}
      </ol> : <p>{t("No individual wine result needs closer review in this comparison.")}</p>}
      {report.latestDecision ? <small>{t("Earlier pilot decision (history only)")}: {report.latestDecision.rationale}</small> : null}
      {otherRows.length > 0 ? <details className="drinking-window-shadow-review__other-results">
        <summary>{t("Other comparison results ({count})", { count: String(otherRows.length) })}</summary>
        <p>{t("These wines have unchanged dates, no reviewed match, or insufficient confirmed details. They remain part of the whole-cellar comparison.")}</p>
        <ol className="drinking-window-shadow-review__rows">
          {otherRows.slice(0, shown).map(renderComparisonRow)}
        </ol>
        {shown < otherRows.length ? <button onClick={() => setShown(shown + 30)} type="button">
          {t("Show more wines")}
        </button> : null}
      </details> : null}
    </section> : null}
  </details>
}
