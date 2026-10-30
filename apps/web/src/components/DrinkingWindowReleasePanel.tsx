import { useEffect, useState } from "react"

import {
  checkWorkingDraft,
  createWorkingDraft,
  getReleaseWorkspace,
  previewPublicationImpact,
  publishReviewedDraft,
  requestWorkingDraftPilot,
  type DraftPreflight,
  type PublicationImpact,
  type ReleaseWorkspace,
} from "../data/drinkingWindowReleaseWorkflow"
import { useLanguage } from "../i18n/useLanguage"
import { FallbackProfileEditor } from "./FallbackProfileEditor"
import { ExactReleaseDraftEditor } from "./ExactReleaseDraftEditor"
import { Notice } from "./Notice"

interface Props { householdId: string; isOnline: boolean; onChanged: () => Promise<void> }

export function DrinkingWindowReleasePanel({ householdId, isOnline, onChanged }: Props) {
  const { t } = useLanguage()
  const [workspace, setWorkspace] = useState<ReleaseWorkspace | null>(null)
  const [selectedId, setSelectedId] = useState("")
  const [preflight, setPreflight] = useState<DraftPreflight | null>(null)
  const [impact, setImpact] = useState<PublicationImpact | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function refresh() {
    if (!isOnline) return
    const next = await getReleaseWorkspace()
    setWorkspace(next)
    setSelectedId((current) => next.versions.some((version) => version.versionId === current)
      ? current : next.versions[0]?.versionId ?? "")
  }

  async function draftChanged() {
    setPreflight(null)
    setImpact(null)
    await refresh()
    await onChanged()
  }

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    void getReleaseWorkspace().then((next) => {
      if (!cancelled) {
        setWorkspace(next)
        setSelectedId((current) => current || next.versions[0]?.versionId || "")
      }
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load versions")
    })
    return () => { cancelled = true }
  }, [isOnline])

  async function act(action: "copy" | "check" | "impact" | "pilot" | "publish") {
    if (!selectedId || !isOnline) return
    if (action === "publish" && !window.confirm(t("Publish this checked version for all cellars now? Eligible wines may show new dates; private dates still take priority."))) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (action === "copy") {
        const created = await createWorkingDraft(selectedId)
        await refresh()
        setSelectedId(created.versionId)
        setPreflight(null)
        setImpact(null)
        setMessage(t("New unpublished working version {number} created. Earlier approvals were not copied.", { number: String(created.versionNumber) }))
        await onChanged()
      } else if (action === "check") {
        const checked = await checkWorkingDraft(selectedId)
        setPreflight(checked)
        setImpact(null)
        setMessage(checked.issueCount === 0 ? t("Draft checks passed. You can preview it in your cellar, then publish it for all cellars.")
          : t("{count} issues still block this draft.", { count: String(checked.issueCount) }))
      } else if (action === "impact") {
        const preview = await previewPublicationImpact(selectedId)
        setImpact(preview)
        setMessage(t("Publication impact preview recorded. Check the counts before publishing."))
      } else if (action === "pilot") {
        await requestWorkingDraftPilot(selectedId, householdId)
        setMessage(t("A comparison is ready below. It is optional and does not approve or publish dates."))
      } else {
        await publishReviewedDraft(selectedId)
        await refresh()
        setPreflight(null)
        setImpact(null)
        setMessage(t("Reviewed reference published for all cellars. Existing private dates still take priority."))
        await onChanged()
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to complete reference action")
    } finally {
      setBusy(false)
    }
  }

  const selected = workspace?.versions.find((version) => version.versionId === selectedId)
  return <section className="drinking-window-release-panel">
    <h3>{t("Shared reference versions")}</h3>
    <p>{t("Prepare a working version, review its dates and sources, then run the final check. A curator can publish it for all cellars without a second approval. Private dates still take priority.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <label>{t("Reference version")}
      <select value={selectedId} disabled={!isOnline || busy} onChange={(event) => {
        setSelectedId(event.target.value)
        setPreflight(null)
        setImpact(null)
      }}>
        {workspace?.versions.map((version) => <option key={version.versionId} value={version.versionId}>
          {version.versionNumber} · {t(version.status === "draft" ? "Unpublished draft" : "Published reference")} · {version.rowCount} {t("windows")}
        </option>)}
      </select>
    </label>
    {selected ? <div className="drinking-window-review-staging">
      <button type="button" disabled={!isOnline || busy} onClick={() => void act("copy")}>{t("Copy into a new working version")}</button>
      {selected.status === "draft" ? <>
        <ExactReleaseDraftEditor versionId={selected.versionId} isOnline={isOnline} onChanged={draftChanged} />
        <FallbackProfileEditor versionId={selected.versionId} isOnline={isOnline} onChanged={draftChanged} />
        <button type="button" disabled={!isOnline || busy} onClick={() => void act("check")}>{t("Check this draft")}</button>
        {preflight && preflight.issueCount > 0 ? <ul>{preflight.issues.map((issue, index) => <li key={`${issue.code}:${issue.subjectId}:${index}`}>
          {t(issue.code)} · {t(issue.subjectKind)}
        </li>)}</ul> : null}
        {preflight?.issueCount === 0 ? <button type="button" disabled={!isOnline || busy}
          onClick={() => void act("pilot")}>{t("Preview dates in my cellar (optional)")}</button> : null}
        {preflight?.issueCount === 0 ? <button type="button" disabled={!isOnline || busy}
          onClick={() => void act("impact")}>{t("Preview impact across cellars")}</button> : null}
        {impact ? <p role="status">{t("Across {wines} wine cards: {matches} match this draft; {changed} may show different dates, {unchanged} already have the same dates, and {private} keep private dates. {unresolved} have unconfirmed identities. This comparison does not include each member’s personal timing shift.", {
          wines: String(impact.wineCount), matches: String(impact.matchedCount),
          changed: String(impact.changedCount), unchanged: String(impact.unchangedCount),
          private: String(impact.privatePreservedCount), unresolved: String(impact.unresolvedCount),
        })}</p> : null}
        {preflight?.issueCount === 0 ? <p>{t("Publishing makes this version available to every cellar. Check the draft and impact preview first; explicit cellar dates remain unchanged.")}</p> : null}
        {workspace?.canPublish ? <button type="button" disabled={!isOnline || busy || preflight?.issueCount !== 0
          || impact?.contentSha256 !== preflight.contentSha256}
          onClick={() => void act("publish")}>{t("Publish reviewed version")}</button>
          : <p>{t("Only a current drinking-window curator can publish a reviewed reference.")}</p>}
      </> : null}
    </div> : null}
  </section>
}
