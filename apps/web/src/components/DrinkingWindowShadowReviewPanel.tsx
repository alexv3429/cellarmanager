import { useEffect, useMemo, useState } from "react"

import {
  getDrinkingWindowRolloutStatus,
  getShadowReport,
  listShadowReports,
  requestDrinkingWindowShadowReport,
  reviewShadowReport,
  type DrinkingWindowRolloutStatus,
  type ShadowReport,
  type ShadowReportListing,
} from "../data/drinkingWindowShadowReview"
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

function windowText(first: number | null, start: number | null, end: number | null) {
  return first === null || start === null || end === null
    ? "—"
    : `${first} / ${start}–${end}`
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
    default: return "Region"
  }
}

export function DrinkingWindowShadowReviewPanel({
  householdId, isOnline, onOpenWine, wines,
}: Props) {
  const { t } = useLanguage()
  const [list, setList] = useState<ShadowReportListing[] | null>(null)
  const [rollout, setRollout] = useState<DrinkingWindowRolloutStatus | null>(null)
  const [report, setReport] = useState<ShadowReport | null>(null)
  const [shown, setShown] = useState(30)
  const [rationale, setRationale] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

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
      .then(([next, status]) => {
        if (!cancelled) { setList(next); setRollout(status) }
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
    ? [...report.rows].sort((a, b) =>
      Number(a.comparisonStatus === "unchanged") - Number(b.comparisonStatus === "unchanged")
      || (names.get(a.wineId) ?? a.wineId).localeCompare(names.get(b.wineId) ?? b.wineId))
    : [], [report, names])
  const changedCount = report?.rows.filter((row) => row.comparisonStatus === "changed").length ?? 0
  const canApprove = (report?.versionStatus === "draft" || report?.versionStatus === "active")
    && report.draftIssueCount === 0
    && !report.rows.some((row) => row.draftStatus === "ambiguous" || row.draftStatus === "identity_conflict")

  async function prepareComparison() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const id = await requestDrinkingWindowShadowReport(householdId)
      const next = await listShadowReports(householdId)
      setList(next)
      const current = next.find((entry) => entry.reportId === id)
      if (current) await openReport(current)
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

  async function decide(verdict: "approve" | "reject") {
    if (!report) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await reviewShadowReport(report, verdict, rationale)
      const next = await listShadowReports(householdId)
      setList(next)
      setRollout(await getDrinkingWindowRolloutStatus(householdId))
      const current = next.find((entry) => entry.reportId === report.reportId)
      if (current) setReport(await getShadowReport(current))
      setRationale("")
      setMessage(t(report.versionStatus === "active"
        ? verdict === "approve"
          ? "These reference dates are now enabled for this cellar."
          : "This version will not be used in this cellar."
        : "Your review was recorded. Publication is a separate, controlled step."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!isOnline || (list?.length === 0 && rollout?.activeVersionNumber === null)) return null

  return <details className="drinking-window-shadow-review">
    <summary>{t("Review shared drinking-window dates")}</summary>
    <p>{t("Compare shared reference dates with your current cellar before using them.")}</p>
    {rollout?.activeVersionNumber ? <div>
      <p>{t("Latest reference version")}: {rollout.activeVersionNumber}.
        {rollout.selectedEnabled && rollout.selectedVersionNumber
          ? ` ${t("Your cellar uses version")} ${rollout.selectedVersionNumber}.`
          : ` ${t("Your cellar still uses its current model.")}`}</p>
      <button disabled={busy || !rollout.globalEnabled}
        onClick={() => void prepareComparison()} type="button">
        {t("Compare the latest reference with my cellar")}
      </button>
    </div> : null}
    {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {list === null ? <p>{t("Loading review reports…")}</p> : null}
    {list?.map((entry) => <button
      disabled={busy}
      key={entry.reportId}
      onClick={() => void openReport(entry)}
      type="button"
    >{t("Reference version")} {entry.versionNumber} · {entry.wineCount} {t("wines")}
      {` · ${t(entry.latestVerdict === "approve"
        ? "Approved"
        : entry.latestVerdict === "reject"
          ? "Rejected"
          : "Awaiting your review")}`}
    </button>)}

    {report ? <section aria-label={t("Detailed drinking-window comparison")}>
      <h3>{t("Reference version")} {report.versionNumber}</h3>
      <p>{report.wineCount} {t("wines")} · {changedCount} {t("changed windows")} · {report.draftIssueCount} {t("reference issues")}</p>
      <p>{t("The current dates are the ones you see in your cellar, including your personal timing choice.")}</p>
      {report.draftIssueCount > 0 ? <Notice tone="warning">{t("This draft still has reference issues and cannot be approved.")}</Notice> : null}
      <ol className="drinking-window-shadow-review__rows">
        {orderedRows.slice(0, shown).map((row) => <li key={row.wineId}>
          <button className="wine-detail-link" onClick={() => onOpenWine(row.wineId)} type="button">
            {names.get(row.wineId) ?? row.wineId}
          </button>
          <span>{t(comparisonLabel(row.comparisonStatus))}</span>
          <span>{t("Current")}: {windowText(row.currentFirstTrialYear, row.currentBestStartYear, row.currentBestEndYear)} ({t(sourceLabel(row.currentSource))})</span>
          <span>{t("Proposed")}: {windowText(row.proposedFirstTrialYear, row.proposedBestStartYear, row.proposedBestEndYear)}{row.matchedScope ? ` · ${t(scopeLabel(row.matchedScope))}` : ""}</span>
          {row.proposedGroupDefinition ? <span>{t("Reviewed ageing group")}: {row.proposedGroupDefinition}</span> : null}
          {row.proposedReferenceRationale ? <span>{t("Why these dates")}: {row.proposedReferenceRationale}</span> : null}
        </li>)}
      </ol>
      {shown < orderedRows.length ? <button onClick={() => setShown(shown + 30)} type="button">
        {t("Show more wines")}
      </button> : null}
      {report.versionStatus === "draft" || report.versionStatus === "active" ? <div className="drinking-window-shadow-review__decision">
        <label>{t("Reason for your decision")}
          <textarea minLength={10} onChange={(event) => setRationale(event.target.value)}
            rows={3} value={rationale} />
        </label>
        <div>
          <button disabled={busy || !canApprove || rationale.trim().length < 10}
            onClick={() => void decide("approve")} type="button">{t(report.versionStatus === "active"
              ? "Use these reference dates in my cellar"
              : "Approve this comparison")}</button>
          <button disabled={busy || rationale.trim().length < 10}
            onClick={() => void decide("reject")} type="button">{t(report.versionStatus === "active"
              ? "Do not use this version"
              : "Reject this comparison")}</button>
        </div>
        <small>{t("A changed cellar or reference invalidates this review; a new comparison will be needed.")}</small>
      </div> : null}
    </section> : null}
  </details>
}
