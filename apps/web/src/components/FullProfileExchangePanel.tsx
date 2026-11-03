import { useEffect, useState } from "react"

import {
  createProfileIdentityBatch,
  exportFullProfileExchange,
  importFullProfileExchange,
  listFullProfileExchanges,
  previewProfileIdentityBatch,
  previewProfileStaging,
  previewFullProfileExchange,
  stageProfileExchange,
  type FullProfileImport,
  type FullProfilePreview,
  type ProfileIdentityMap,
  type ProfileIdentityBatchPreview,
  type ProfileStagePreview,
} from "../data/drinkingWindowProfileExchange"
import { searchCurationTargets, type CurationTarget } from "../data/drinkingWindowFallbackAuthoring"
import { createWorkingDraft, getReleaseWorkspace, type ReferenceVersionSummary } from "../data/drinkingWindowReleaseWorkflow"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props { isOnline: boolean; onStaged?: (versionId: string) => void }

function profileReleaseChoices(document: FullProfilePreview | null) {
  if (document?.kind !== "producer") return []
  const cuvees = new Map(((document.document.cuvees || []) as Record<string, unknown>[])
    .map((cuvee) => [String(cuvee.id), String(cuvee.name)]))
  const releases = (document.document.exact_release_calibrations || []) as Record<string, unknown>[]
  const choices = new Map<string, { key: string; label: string; formats: Set<number> }>()
  for (const release of releases) {
    const key = `${release.cuvee_id}|${release.vintage}`
    const existing = choices.get(key) || {
      key, label: `${cuvees.get(String(release.cuvee_id)) || String(release.cuvee_id)} · ${release.vintage}`,
      formats: new Set<number>(),
    }
    existing.formats.add(Number(release.format_ml))
    choices.set(key, existing)
  }
  return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function CanonicalMappingSearch({ kind, suggestedName, selectedId, onSelect, disabled }: {
  kind: "producer" | "product" | "region" | "appellation"; suggestedName: string; selectedId: string
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
    <label>{kind === "producer" ? t("Shared producer") : kind === "product" ? t("Shared cuvée")
      : kind === "region" ? t("Shared region") : t("Shared appellation")}
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
  const [pendingProfiles, setPendingProfiles] = useState<{ fileName: string; preview: FullProfilePreview }[]>([])
  const [versions, setVersions] = useState<ReferenceVersionSummary[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState("")
  const [selectedDocument, setSelectedDocument] = useState<FullProfilePreview | null>(null)
  const [identityMap, setIdentityMap] = useState<ProfileIdentityMap>({})
  const [selectedReleaseKeys, setSelectedReleaseKeys] = useState<string[]>([])
  const [identityPreview, setIdentityPreview] = useState<ProfileIdentityBatchPreview | null>(null)
  const [identityReason, setIdentityReason] = useState("")
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
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

  async function choose(files: FileList | null) {
    setPendingProfiles([])
    setError(null)
    setMessage(null)
    if (!files?.length) return
    try {
      if (files.length > 30) throw new Error(t("Choose at most 30 profile files at a time."))
      const next: { fileName: string; preview: FullProfilePreview }[] = []
      for (const file of Array.from(files)) {
        if (file.size > 2_000_000) throw new Error(`${file.name}: ${t("Profile file exceeds 2 MB")}`)
        try {
          next.push({ fileName: file.name,
            preview: previewFullProfileExchange(JSON.parse(await file.text()) as unknown) })
        } catch (caught) {
          throw new Error(`${file.name}: ${caught instanceof Error ? caught.message : String(caught)}`)
        }
      }
      setPendingProfiles(next)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Invalid profile file")
    }
  }

  async function save() {
    if (!pendingProfiles.length || !isOnline) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const saved: { profile: FullProfileImport; preview: FullProfilePreview }[] = []
      const failed: { fileName: string; preview: FullProfilePreview }[] = []
      const errors: string[] = []
      for (const entry of pendingProfiles) {
        try {
          saved.push({ profile: await importFullProfileExchange(entry.preview.document),
            preview: entry.preview })
        } catch (caught) {
          failed.push(entry)
          errors.push(`${entry.fileName}: ${caught instanceof Error ? caught.message : String(caught)}`)
        }
      }
      setPendingProfiles(failed)
      let refreshError = ""
      try { setImports(await listFullProfileExchanges()) }
      catch (caught) { refreshError = caught instanceof Error ? caught.message : String(caught) }
      if (saved.length === 1) {
        setSelectedProfileId(saved[0].profile.id)
        setSelectedDocument(saved[0].preview)
        setIdentityMap({})
        setSelectedReleaseKeys([])
        setIdentityPreview(null)
        setStagingPreview(null)
      }
      if (saved.length) setMessage(saved.length === 1
        ? t("Complete profile saved for review. No dates were published.")
        : t("{count} complete profiles saved for review. No dates were published.",
          { count: String(saved.length) }))
      if (errors.length || refreshError) setError([
        ...(errors.length ? [(errors.length === 1
          ? t("One profile could not be saved. It remains selected for retry:")
          : t("{count} profiles could not be saved. They remain selected for retry:",
            { count: String(errors.length) })) + " " + errors.join(" · ")] : []),
        ...(refreshError ? [`${t("Unable to refresh saved profiles.")} ${refreshError}`] : []),
      ].join(" · "))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to save profile")
    } finally { setBusy(false) }
  }

  async function selectProfile(id: string) {
    setSelectedProfileId(id)
    setSelectedDocument(null)
    setIdentityMap({})
    setSelectedReleaseKeys([])
    setIdentityPreview(null)
    setIdentityConfirmed(false)
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

  async function inspectIdentities() {
    const profile = imports.find((item) => item.id === selectedProfileId)
    if (!profile || !selectedReleaseKeys.length) return
    setBusy(true); setError(null); setMessage(null); setIdentityConfirmed(false)
    try { setIdentityPreview(await previewProfileIdentityBatch(profile, identityMap, selectedReleaseKeys)) }
    catch (caught: unknown) {
      setIdentityPreview(null)
      setError(caught instanceof Error ? caught.message : "Unable to preview identities")
    } finally { setBusy(false) }
  }

  async function createIdentities() {
    const profile = imports.find((item) => item.id === selectedProfileId)
    if (!profile || !identityPreview) return
    setBusy(true); setError(null)
    try {
      const result = await createProfileIdentityBatch(profile, identityMap, selectedReleaseKeys,
        identityPreview, identityReason, identityConfirmed)
      setMessage(t("Shared identities created: {producers} producers, {cuvees} cuvées, {releases} vintages. No dates were approved and no cellar wine was linked.", {
        producers: String(result.createdProducers), cuvees: String(result.createdProducts),
        releases: String(result.createdReleases),
      }))
      setIdentityPreview(null)
      setSelectedReleaseKeys([])
      setIdentityConfirmed(false)
      setIdentityReason("")
      setStagingPreview(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to create identities")
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
      onStaged?.(stagingPreview.versionId)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to stage the profile")
    } finally { setBusy(false) }
  }

  const quarantineReasons = stagingPreview?.items.reduce((counts, item) => {
    if (item.status === "quarantined" && item.reason) {
      counts.set(item.reason, (counts.get(item.reason) || 0) + 1)
    }
    return counts
  }, new Map<string, number>())
  const profileCuvees = selectedDocument?.kind === "producer"
    ? selectedDocument.document.cuvees as Record<string, unknown>[] : []
  const profileRegions = [...new Set(profileCuvees.map((cuvee) => String(cuvee.region)))].sort()
  const profileAppellations = [...new Set(profileCuvees.map((cuvee) => String(cuvee.appellation)))].sort()
  const releaseChoices = profileReleaseChoices(selectedDocument)

  function updateIdentityMap(update: (current: ProfileIdentityMap) => ProfileIdentityMap) {
    setIdentityMap(update)
    setIdentityPreview(null)
    setIdentityConfirmed(false)
    setStagingPreview(null)
  }

  return <details className="research-inbox drinking-window-profile-import">
    <summary><strong>{t("Complete profile exchange")}</strong></summary>
    <p>{t("Import a complete producer, appellation or region JSON profile for curator review. History, grapes, style, service, pairings and source pointers are retained. This does not approve or publish any dates.")}</p>
    <p>{t("Saving a profile does not match it to wines already in a cellar. Shared wine identities and proposed dates require separate review.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <label>{t("Choose complete JSON profiles")}
      <input type="file" accept=".json,application/json" multiple disabled={!isOnline || busy}
        onChange={(event) => void choose(event.target.files)} />
    </label>
    {pendingProfiles.length ? <div>
      <ul>{pendingProfiles.map(({ fileName, preview }, index) => <li key={`${fileName}:${index}`}>
        {fileName} · {preview.name} · {t(preview.kind)} · {preview.datasetVersion} · {preview.releaseCount} {t("proposed windows")} · {preview.factCount} {t("retained profile facts")} · {preview.sourceCount} {t("source pointers")}
      </li>)}</ul>
      <p>{t("The dates and source rights are still unreviewed. Importing cannot affect any cellar.")}</p>
      <button type="button" disabled={!isOnline || busy} onClick={() => void save()}>
        {busy ? t("Importing…") : pendingProfiles.length === 1
          ? t("Save complete profile for review")
          : t("Save {count} complete profiles for review", { count: String(pendingProfiles.length) })}
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
        <p>{t("Exact names are matched automatically. For names that differ, select the existing shared producer, cuvée, region and appellation; the vintage and place relationship are checked before any window can be staged.")}</p>
        <p>{String((selectedDocument.document.producer as Record<string, unknown>).name)}</p>
        <CanonicalMappingSearch key={selectedProfileId + ":producer"} kind="producer"
          suggestedName={String((selectedDocument.document.producer as Record<string, unknown>).name)}
          selectedId={identityMap.producer_id || ""} disabled={busy || !isOnline}
          onSelect={(id) => updateIdentityMap((current) => ({ ...current, producer_id: id }))} />
        <h5>{t("Places named in this profile")}</h5>
        <p>{t("A place mapping is a curator decision for this import only. It does not rename a region or change another cellar.")}</p>
        {profileRegions.map((name) => <div key={`region:${name}`}>
          <strong>{name}</strong>
          <CanonicalMappingSearch key={`${selectedProfileId}:region:${name}`} kind="region" suggestedName={name}
            selectedId={identityMap.regions?.[name] || ""} disabled={busy || !isOnline}
            onSelect={(id) => {
              updateIdentityMap((current) => ({ ...current, regions: { ...current.regions, [name]: id } }))
            }} />
        </div>)}
        {profileAppellations.map((name) => <div key={`appellation:${name}`}>
          <strong>{name}</strong>
          <CanonicalMappingSearch key={`${selectedProfileId}:appellation:${name}`} kind="appellation" suggestedName={name}
            selectedId={identityMap.appellations?.[name] || ""} disabled={busy || !isOnline}
            onSelect={(id) => {
              updateIdentityMap((current) => ({ ...current, appellations: { ...current.appellations, [name]: id } }))
            }} />
        </div>)}
        <h5>{t("Cuvées named in this profile")}</h5>
        {profileCuvees.map((cuvee) => <div key={String(cuvee.id)}>
          <strong>{String(cuvee.name)}</strong> · {String(cuvee.appellation)}
          <CanonicalMappingSearch key={selectedProfileId + ":" + String(cuvee.id)} kind="product" suggestedName={String(cuvee.name)}
            selectedId={identityMap.cuvees?.[String(cuvee.id)] || ""} disabled={busy || !isOnline}
            onSelect={(id) => {
              updateIdentityMap((current) => ({ ...current,
                cuvees: { ...current.cuvees, [String(cuvee.id)]: id } }))
            }} />
        </div>)}
      </details> : null}
      {selectedDocument?.kind === "producer" ? <details>
        <summary>{t("Prepare missing shared wine identities")}</summary>
        <p>{t("Choose only releases whose producer, cuvée, place and vintage you have checked. This creates shared identities, not drinking dates, and does not link any cellar wine.")}</p>
        <p>{t("Search for an existing shared producer or cuvée in the mapping section first. If the profile names a place differently, map it there before previewing.")}</p>
        <div className="drinking-window-profile-identity-choices">
          {releaseChoices.map((choice) => <label key={choice.key}>
            <input type="checkbox" disabled={busy || !isOnline}
              checked={selectedReleaseKeys.includes(choice.key)}
              onChange={(event) => {
                setSelectedReleaseKeys((current) => event.target.checked
                  ? [...current, choice.key] : current.filter((key) => key !== choice.key))
                setIdentityPreview(null); setIdentityConfirmed(false)
              }} />
            {choice.label} · {[...choice.formats].sort((a, b) => a - b).join(" / ")} ml
          </label>)}
        </div>
        <button type="button" disabled={busy || !isOnline || !releaseChoices.length}
          onClick={() => {
            setSelectedReleaseKeys(releaseChoices.map((choice) => choice.key))
            setIdentityPreview(null); setIdentityConfirmed(false)
          }}>{t("Select all for identity review (not approval)")}</button>
        <button type="button" disabled={busy || !isOnline || !selectedReleaseKeys.length}
          onClick={() => void inspectIdentities()}>{t("Preview selected identities")}</button>
        {identityPreview ? <div>
          <p>{identityPreview.entries.length} {t("selected releases")} · {t(identityPreview.status)}</p>
          <p>{identityPreview.producerName} · {t(identityPreview.producerStatus)}</p>
          {identityPreview.status === "blocked" && identityPreview.entries.some((entry) => !entry.reason)
            ? <button type="button" disabled={busy || !isOnline} onClick={() => {
              setSelectedReleaseKeys(identityPreview.entries.filter((entry) => !entry.reason).map((entry) => entry.key))
              setIdentityPreview(null)
              setIdentityConfirmed(false)
            }}>{t("Keep only unblocked identities, then preview again")}</button> : null}
          <ul className="drinking-window-profile-identity-results">{identityPreview.entries.map((entry) => <li key={entry.key}>
            <strong>{entry.cuveeName || entry.key} · {entry.vintage || "?"}</strong>
            {entry.reason ? <> · {t(entry.reason)}</> : <> · {t("Cuvée")}: {t(entry.productStatus)} · {t("Vintage")}: {t(entry.releaseStatus)}</>}
            {entry.sourceUrls.length ? <details><summary>{t("Release existence sources to check")}</summary>
              <ul>{entry.sourceUrls.map((url) => <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
              </li>)}</ul>
            </details> : null}
          </li>)}</ul>
          {identityPreview.status === "ready" ? <div>
            <label>{t("Why these shared wine identities are correct")}
              <textarea minLength={30} maxLength={1000} value={identityReason}
                onChange={(event) => setIdentityReason(event.target.value)} />
            </label>
            <label className="drinking-window-profile-identity-confirm"><input type="checkbox" checked={identityConfirmed}
              onChange={(event) => setIdentityConfirmed(event.target.checked)} />
              {t("I checked these identities and their existence sources; I understand this does not approve drinking dates")}</label>
            <button type="button" disabled={busy || !isOnline || !identityConfirmed || identityReason.trim().length < 30}
              onClick={() => void createIdentities()}>{t("Create the reviewed shared identities")}</button>
          </div> : <p>{t("Resolve the blocked entries or select a smaller batch, then preview again.")}</p>}
        </div> : null}
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
        {quarantineReasons?.size ? <Notice tone="warning">
          <strong>{t("Why entries were set aside")}</strong>
          <ul>{[...quarantineReasons].map(([reason, count]) => <li key={reason}>
            {count} · {t(reason)}
          </li>)}</ul>
          {quarantineReasons.has("Producer has no unique canonical identity")
            ? <p>{t("Select the existing shared producer under name mapping, then preview again. Other identity checks follow after that first match.")}</p>
            : null}
          {quarantineReasons.has("Region has no unique canonical identity")
            ? <p>{t("Select the matching shared region under place mapping, then preview again. No date will be approved by this selection.")}</p>
            : null}
        </Notice> : null}
        <p>{t("Only unique exact canonical identities can be prepared. Unmatched or conflicting entries remain in the saved profile; they are not silently imported.")}</p>
        <ul>{stagingPreview.items.map((item) => <li key={item.key}>
          <strong>{item.name}</strong> · {t(item.status)}
          {item.canonicalId ? <> · {t("Canonical ID")}: <code>{item.canonicalId}</code></> : null}
          {item.reason ? <> · {t(item.reason)}</> : null}
          {item.firstTrialYear ? <> · {item.firstTrialYear} / {item.bestStartYear}–{item.bestEndYear}</> : null}
          {item.rationale ? <p>{item.rationale}</p> : null}
          {item.children.length ? <ul>{item.children.map((child) => <li key={child.key}>
            {child.name}{child.firstTrialYear ? `: ${child.firstTrialYear} / ${child.bestStartYear}–${child.bestEndYear}` : ""}
            {child.canonicalId ? <> · {t("Canonical ID")}: <code>{child.canonicalId}</code></> : null}
            {child.reason ? <> · {t(child.reason)}</> : null}
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
