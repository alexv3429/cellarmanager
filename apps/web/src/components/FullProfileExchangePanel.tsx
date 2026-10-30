import { useEffect, useState } from "react"

import {
  exportFullProfileExchange,
  importFullProfileExchange,
  listFullProfileExchanges,
  previewProfileStaging,
  previewFullProfileExchange,
  stageProfileExchange,
  type FullProfileImport,
  type FullProfilePreview,
  type ProfileIdentityMap,
  type ProfileStagePreview,
} from "../data/drinkingWindowProfileExchange"
import { searchCurationTargets, type CurationTarget } from "../data/drinkingWindowFallbackAuthoring"
import { createWorkingDraft, getReleaseWorkspace, type ReferenceVersionSummary } from "../data/drinkingWindowReleaseWorkflow"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props { isOnline: boolean; onStaged?: () => void }

function CanonicalMappingSearch({ kind, suggestedName, selectedId, onSelect, disabled }: {
  kind: "producer" | "product"; suggestedName: string; selectedId: string
  onSelect: (id: string, label: string) => void; disabled: boolean
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState(suggestedName)
  const [results, setResults] = useState<CurationTarget[]>([])
  const [selectedLabel, setSelectedLabel] = useState("")
  const [error, setError] = useState("")
  async function search() {
    setError("")
    try { setResults(await searchCurationTargets(kind, query)) }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Search failed") }
  }
  return <div className="drinking-window-profile-mapping-search">
    <label>{kind === "producer" ? t("Shared producer") : t("Shared cuvée")}
      <input value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} />
    </label>
    <button type="button" disabled={disabled || query.trim().length < 2}
      onClick={() => void search()}>{t("Search canonical identities")}</button>
    {selectedId ? <p>{t("Selected")}: {selectedLabel || selectedId}</p> : null}
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {results.length ? <ul>{results.map((item) => <li key={item.id}>
      <button type="button" disabled={disabled} onClick={() => {
        setSelectedLabel(`${item.label} · ${item.detail}`)
        onSelect(item.id, item.label)
        setResults([])
      }}>{item.label} · {item.detail}</button>
    </li>)}</ul> : null}
  </div>
}

export function FullProfileExchangePanel({ isOnline, onStaged }: Props) {
  const { t } = useLanguage()
  const [imports, setImports] = useState<FullProfileImport[]>([])
  const [preview, setPreview] = useState<FullProfilePreview | null>(null)
  const [fileName, setFileName] = useState("")
  const [versions, setVersions] = useState<ReferenceVersionSummary[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState("")
  const [selectedDocument, setSelectedDocument] = useState<FullProfilePreview | null>(null)
  const [identityMap, setIdentityMap] = useState<ProfileIdentityMap>({})
  const [versionId, setVersionId] = useState("")
  const [stagingPreview, setStagingPreview] = useState<ProfileStagePreview | null>(null)
  const [reviewReason, setReviewReason] = useState("")
  const [adoptAndShare, setAdoptAndShare] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    void Promise.all([listFullProfileExchanges(), getReleaseWorkspace()]).then(([next, workspace]) => {
      if (!cancelled) {
        setImports(next)
        setVersions(workspace.versions)
        setVersionId((current) => current || workspace.versions.find((version) => version.status === "draft")?.versionId || "")
      }
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load profiles")
    })
    return () => { cancelled = true }
  }, [isOnline])

  async function choose(file: File | undefined) {
    setPreview(null)
    setError(null)
    setMessage(null)
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error("Profile file exceeds 2 MB")
      const parsed = JSON.parse(await file.text()) as unknown
      setPreview(previewFullProfileExchange(parsed))
      setFileName(file.name)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Invalid profile file")
    }
  }

  async function save() {
    if (!preview || !isOnline) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await importFullProfileExchange(preview.document)
      setImports(await listFullProfileExchanges())
      setPreview(null)
      setSelectedProfileId(saved.id)
      setSelectedDocument(preview)
      setIdentityMap({})
      setStagingPreview(null)
      setMessage(saved.name + (saved.submittedAt ? " · " : "")
        + t("Complete profile saved for review. No dates were published."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to save profile")
    } finally { setBusy(false) }
  }

  async function selectProfile(id: string) {
    setSelectedProfileId(id)
    setSelectedDocument(null)
    setIdentityMap({})
    setStagingPreview(null)
    if (!id) return
    setBusy(true); setError(null)
    try { setSelectedDocument(previewFullProfileExchange(await exportFullProfileExchange(id))) }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to read profile") }
    finally { setBusy(false) }
  }

  async function download(item: FullProfileImport) {
    setError(null)
    try {
      const document = await exportFullProfileExchange(item.id)
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement("a")
      anchor.href = url
      anchor.download = `cellarmanager-${item.kind}-${item.documentSha256.slice(0, 12)}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to export profile")
    }
  }

  async function createDraft() {
    const active = versions.find((version) => version.status === "active")
    if (!active) return
    setBusy(true); setError(null)
    try {
      const created = await createWorkingDraft(active.versionId)
      const workspace = await getReleaseWorkspace()
      setVersions(workspace.versions)
      setVersionId(created.versionId)
      setStagingPreview(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to create a draft")
    } finally { setBusy(false) }
  }

  async function inspect() {
    const profile = imports.find((item) => item.id === selectedProfileId)
    if (!profile || !versionId) return
    setBusy(true); setError(null); setMessage(null); setAdoptAndShare(false)
    try { setStagingPreview(await previewProfileStaging(profile, versionId, identityMap)) }
    catch (caught: unknown) {
      setStagingPreview(null)
      setError(caught instanceof Error ? caught.message : "Unable to preview the profile")
    } finally { setBusy(false) }
  }

  async function stage() {
    const profile = imports.find((item) => item.id === selectedProfileId)
    if (!profile || !stagingPreview) return
    setBusy(true); setError(null)
    try {
      const result = await stageProfileExchange(profile, stagingPreview, reviewReason, adoptAndShare, identityMap)
      setStagingPreview(await previewProfileStaging(profile, versionId, identityMap))
      setAdoptAndShare(false)
      setMessage(t("{staged} valid entries prepared; {quarantined} excluded for correction. Nothing has been published.", {
        staged: String(result.staged), quarantined: String(result.quarantined),
      }))
      onStaged?.()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to stage the profile")
    } finally { setBusy(false) }
  }

  return <details className="research-inbox drinking-window-profile-import">
    <summary><strong>{t("Complete profile exchange")}</strong></summary>
    <p>{t("Import a complete producer, appellation or region JSON profile for curator review. History, grapes, style, service, pairings and source pointers are retained. This does not approve or publish any dates.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <label>{t("Choose a complete JSON profile")}
      <input type="file" accept=".json,application/json" disabled={!isOnline || busy}
        onChange={(event) => void choose(event.target.files?.[0])} />
    </label>
    {preview ? <div>
      <p>{fileName} · {preview.name} · {t(preview.kind)} · {preview.datasetVersion}</p>
      <p>{preview.releaseCount} {t("proposed windows")} · {preview.factCount} {t("retained profile facts")} · {preview.sourceCount} {t("source pointers")}</p>
      <p>{t("The dates and source rights are still unreviewed. Importing cannot affect any cellar.")}</p>
      <button type="button" disabled={!isOnline || busy} onClick={() => void save()}>
        {busy ? t("Importing…") : t("Save complete profile for review")}
      </button>
    </div> : null}
    {imports.length ? <div>
      <h4>{t("Saved complete profiles")}</h4>
      <ul>{imports.map((item) => <li key={item.id}>
        {item.name} · {t(item.kind)} · {item.datasetVersion} · {item.releaseCount} {t("proposed windows")}
        <button type="button" disabled={!isOnline || busy} onClick={() => void download(item)}>{t("Export JSON")}</button>
      </li>)}</ul>
    </div> : null}
    {imports.length ? <div className="drinking-window-profile-staging">
      <h4>{t("Review identity mapping and proposed changes")}</h4>
      <label>{t("Complete profile")}
        <select value={selectedProfileId} disabled={!isOnline || busy}
          onChange={(event) => void selectProfile(event.target.value)}>
          <option value="">{t("Choose a profile")}</option>
          {imports.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.datasetVersion}</option>)}
        </select>
      </label>
      {selectedDocument?.kind === "producer" ? <details>
        <summary>{t("Map profile names to shared wine identities")}</summary>
        <p>{t("Exact names are matched automatically. For names that differ, select the existing shared producer and cuvée; the vintage is checked before any window can be staged.")}</p>
        <p>{String((selectedDocument.document.producer as Record<string, unknown>).name)}</p>
        <CanonicalMappingSearch key={selectedProfileId + ":producer"} kind="producer"
          suggestedName={String((selectedDocument.document.producer as Record<string, unknown>).name)}
          selectedId={identityMap.producer_id || ""} disabled={busy || !isOnline}
          onSelect={(id) => { setIdentityMap({ producer_id: id, cuvees: {} }); setStagingPreview(null) }} />
        {(selectedDocument.document.cuvees as Record<string, unknown>[]).map((cuvee) => <div key={String(cuvee.id)}>
          <strong>{String(cuvee.name)}</strong> · {String(cuvee.appellation)}
          <CanonicalMappingSearch key={selectedProfileId + ":" + String(cuvee.id)} kind="product" suggestedName={String(cuvee.name)}
            selectedId={identityMap.cuvees?.[String(cuvee.id)] || ""} disabled={busy || !isOnline}
            onSelect={(id) => {
              setIdentityMap((current) => ({ ...current,
                cuvees: { ...current.cuvees, [String(cuvee.id)]: id } }))
              setStagingPreview(null)
            }} />
        </div>)}
      </details> : null}
      <label>{t("Unpublished reference draft")}
        <select value={versionId} disabled={!isOnline || busy}
          onChange={(event) => { setVersionId(event.target.value); setStagingPreview(null) }}>
          <option value="">{t("Choose a draft")}</option>
          {versions.filter((version) => version.status === "draft").map((version) =>
            <option key={version.versionId} value={version.versionId}>#{version.versionNumber} · {version.rowCount} {t("windows")}</option>)}
        </select>
      </label>
      {!versions.some((version) => version.status === "draft") && versions.some((version) => version.status === "active")
        ? <button type="button" disabled={!isOnline || busy} onClick={() => void createDraft()}>{t("Create a working draft")}</button> : null}
      <button type="button" disabled={!isOnline || busy || !selectedProfileId || !versionId}
        onClick={() => void inspect()}>{t("Preview mapping and changes")}</button>
      {stagingPreview ? <div>
        <p>{stagingPreview.ready} {t("ready")} · {stagingPreview.unchanged} {t("unchanged")} · {stagingPreview.quarantined} {t("quarantined")}</p>
        <p>{t("Only unique exact canonical identities can be prepared. Unmatched or conflicting entries remain in the saved profile; they are not silently imported.")}</p>
        <ul>{stagingPreview.items.map((item) => <li key={item.key}>
          <strong>{item.name}</strong> · {t(item.status)}
          {item.canonicalId ? <> · {t("Canonical ID")}: <code>{item.canonicalId}</code></> : null}
          {item.reason ? <> · {item.reason}</> : null}
          {item.firstTrialYear ? <> · {item.firstTrialYear} / {item.bestStartYear}–{item.bestEndYear}</> : null}
          {item.rationale ? <p>{item.rationale}</p> : null}
          {item.children.length ? <ul>{item.children.map((child) => <li key={child.key}>
            {child.name}{child.firstTrialYear ? `: ${child.firstTrialYear} / ${child.bestStartYear}–${child.bestEndYear}` : ""}
            {child.canonicalId ? <> · {t("Canonical ID")}: <code>{child.canonicalId}</code></> : null}
            {child.reason ? <> · {child.reason}</> : null}
            {child.rationale ? <p>{child.rationale}</p> : null}
            {child.sourceUrls.length ? <details><summary>{t("Context links to review")}</summary>
              <ul>{child.sourceUrls.map((url) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>
            </details> : null}
          </li>)}</ul> : null}
          {item.sourceUrls.length ? <details><summary>{t("Context links to review")}</summary>
            <ul>{item.sourceUrls.map((url) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>
          </details> : null}
        </li>)}</ul>
        {stagingPreview.ready ? <div>
          <p>{t("The source pages are context, not proof that the producer published these exact dates. You adopt the three dates as your own shared editorial estimates.")}</p>
          <label>{t("Why I approve the ready entries")}
            <textarea minLength={30} maxLength={1000} value={reviewReason}
              onChange={(event) => setReviewReason(event.target.value)} />
          </label>
          <label><input type="checkbox" checked={adoptAndShare}
            onChange={(event) => setAdoptAndShare(event.target.checked)} />
            {t("I reviewed the ready entries and authorize their reuse across cellars")}</label>
          <button type="button" disabled={!isOnline || busy || !adoptAndShare || reviewReason.trim().length < 30}
            onClick={() => void stage()}>{t("Prepare valid entries in this draft")}</button>
          <p>{t("After this step, run the draft preflight and impact preview in the publication section before publishing.")}</p>
        </div> : null}
      </div> : null}
    </div> : null}
  </details>
}
