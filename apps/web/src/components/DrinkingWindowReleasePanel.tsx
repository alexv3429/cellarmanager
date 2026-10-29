import { useEffect, useState } from "react"

import {
  checkWorkingDraft,
  createWorkingDraft,
  getReleaseWorkspace,
  publishReviewedDraft,
  requestWorkingDraftPilot,
  type DraftPreflight,
  type ReleaseWorkspace,
} from "../data/drinkingWindowReleaseWorkflow"
import { useLanguage } from "../i18n/useLanguage"
import { FallbackProfileEditor } from "./FallbackProfileEditor"
import { Notice } from "./Notice"

interface Props { householdId: string; isOnline: boolean; onChanged: () => Promise<void> }

export function DrinkingWindowReleasePanel({ householdId, isOnline, onChanged }: Props) {
  const { t } = useLanguage()
  const [workspace, setWorkspace] = useState<ReleaseWorkspace | null>(null)
  const [selectedId, setSelectedId] = useState("")
  const [preflight, setPreflight] = useState<DraftPreflight | null>(null)
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

  async function act(action: "copy" | "check" | "pilot" | "publish") {
    if (!selectedId || !isOnline) return
    if (action === "publish" && !window.confirm(t("Publish this reviewed version for approved pilot cellars now? This changes their drinking-window advice."))) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (action === "copy") {
        const created = await createWorkingDraft(selectedId)
        await refresh()
        setSelectedId(created.versionId)
        setPreflight(null)
        setMessage(t("New unpublished working version {number} created. Earlier approvals were not copied.", { number: String(created.versionNumber) }))
        await onChanged()
      } else if (action === "check") {
        const checked = await checkWorkingDraft(selectedId)
        setPreflight(checked)
        setMessage(checked.issueCount === 0 ? t("Draft checks passed. Request and review a cellar pilot next.")
          : t("{count} issues still block this draft.", { count: String(checked.issueCount) }))
      } else if (action === "pilot") {
        await requestWorkingDraftPilot(selectedId, householdId)
        setMessage(t("A new whole-cellar comparison is ready below. Review and approve it before publication."))
      } else {
        const published = await publishReviewedDraft(selectedId)
        await refresh()
        setMessage(t("Reference published for {count} approved pilot cellars.", { count: String(published.reviewedHouseholdCount) }))
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
    <p>{t("Prepare one working version, review its proposed windows and sources, then check the whole draft. Publication remains separate and affects only cellars that approved a current comparison.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <label>{t("Reference version")}
      <select value={selectedId} disabled={!isOnline || busy} onChange={(event) => {
        setSelectedId(event.target.value)
        setPreflight(null)
      }}>
        {workspace?.versions.map((version) => <option key={version.versionId} value={version.versionId}>
          {version.versionNumber} · {t(version.status === "draft" ? "Unpublished draft" : "Published reference")} · {version.rowCount} {t("windows")}
        </option>)}
      </select>
    </label>
    {selected ? <div className="drinking-window-review-staging">
      <button type="button" disabled={!isOnline || busy} onClick={() => void act("copy")}>{t("Copy into a new working version")}</button>
      {selected.status === "draft" ? <>
        <FallbackProfileEditor versionId={selected.versionId} isOnline={isOnline} onChanged={onChanged} />
        <button type="button" disabled={!isOnline || busy} onClick={() => void act("check")}>{t("Check this draft")}</button>
        {preflight && preflight.issueCount > 0 ? <ul>{preflight.issues.map((issue, index) => <li key={`${issue.code}:${issue.subjectId}:${index}`}>
          {t(issue.code)} · {t(issue.subjectKind)}
        </li>)}</ul> : null}
        {preflight?.issueCount === 0 ? <button type="button" disabled={!isOnline || busy}
          onClick={() => void act("pilot")}>{t("Compare with my cellar")}</button> : null}
        {workspace?.canPublish ? <button type="button" disabled={!isOnline || busy || preflight?.issueCount !== 0}
          onClick={() => void act("publish")}>{t("Publish reviewed version")}</button>
          : <p>{t("Publication requires a separate one-time publisher authorization. Reviewing a draft does not grant it.")}</p>}
      </> : null}
    </div> : null}
  </section>
}
