import { useEffect, useState } from "react"

import {
  confirmWineIdentityReconciliation,
  getHouseholdWineIdentityStatus,
  manageHouseholdWineIdentity,
  previewWineIdentityReconciliation,
  requestSharedWineIdentity,
  searchHouseholdWineIdentities,
  type HouseholdWineIdentityStatus,
  type SharedWineIdentity,
  type WineIdentityReconciliationItem,
} from "../data/householdWineIdentities"
import type { WineCatalogEntry } from "../data/wineCatalog"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  compact?: boolean
  initialWineId?: string
  isOnline: boolean
  onChanged?: () => void
  wines: WineCatalogEntry[]
}

function wineLabel(wine: WineCatalogEntry): string {
  return [wine.producer, wine.cuvee, wine.vintage ?? "NV"].join(" · ")
}

export function WineIdentityReviewPanel({ compact = false, initialWineId = "", isOnline, onChanged, wines }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [localSearch, setLocalSearch] = useState("")
  const [showLinked, setShowLinked] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(initialWineId || null)
  const [status, setStatus] = useState<HouseholdWineIdentityStatus | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SharedWineIdentity[]>([])
  const [choice, setChoice] = useState<SharedWineIdentity | null>(null)
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [requested, setRequested] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [localLinks, setLocalLinks] = useState<Record<string, string | null>>({})
  const [reconciliation, setReconciliation] = useState<WineIdentityReconciliationItem[] | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchSelected, setBatchSelected] = useState<string[]>([])

  const selected = wines.find((wine) => wine.id === selectedId) ?? null
  const isLinked = (wine: WineCatalogEntry) =>
    Object.prototype.hasOwnProperty.call(localLinks, wine.id)
      ? localLinks[wine.id] !== null
      : wine.wine_reference_id !== null && wine.wine_reference_id !== undefined
  const unmatchedCount = wines.filter((wine) => !isLinked(wine)).length
  const term = localSearch.trim().toLocaleLowerCase()
  const filtered = wines.filter((wine) =>
    (showLinked || !isLinked(wine)) &&
    (!term || wineLabel(wine).toLocaleLowerCase().includes(term) ||
      (wine.appellation ?? "").toLocaleLowerCase().includes(term)),
  )
  const uniqueSuggestions = reconciliation?.filter((item) => item.candidateCount === 1) ?? []
  const ambiguousSuggestions = reconciliation?.filter((item) => item.candidateCount > 1) ?? []
  const missingSuggestions = reconciliation?.filter((item) => item.candidateCount === 0) ?? []

  async function findCellarMatches() {
    if (!isOnline || reconciling) return
    setReconciling(true)
    setError(null)
    setMessage(null)
    setReconciliation(null)
    setBatchSelected([])
    try {
      const ids = wines.filter((wine) => !isLinked(wine) && !wine.merged_into_wine_id).map((wine) => wine.id)
      const all: WineIdentityReconciliationItem[] = []
      for (let index = 0; index < ids.length; index += 100) {
        all.push(...await previewWineIdentityReconciliation(ids.slice(index, index + 100)))
      }
      setReconciliation(all)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setReconciling(false)
    }
  }

  async function confirmBatch() {
    if (!reconciliation || batchSaving || !isOnline) return
    const chosen = uniqueSuggestions.filter((item) => batchSelected.includes(item.wineId)).slice(0, 50)
    if (chosen.length === 0) return
    setBatchSaving(true)
    setError(null)
    setMessage(null)
    try {
      await confirmWineIdentityReconciliation(chosen.map((item) => ({
        wineId: item.wineId,
        referenceId: item.candidates[0].referenceId,
        sourceFingerprint: item.sourceFingerprint,
      })))
      setLocalLinks((current) => Object.fromEntries([
        ...Object.entries(current),
        ...chosen.map((item) => [item.wineId, item.candidates[0].referenceId]),
      ]))
      setReconciliation((current) => current?.filter((item) => !chosen.some((done) => done.wineId === item.wineId)) ?? null)
      setBatchSelected((current) => current.filter((id) => !chosen.some((done) => done.wineId === id)))
      setMessage(t("Wine links confirmed for this cellar. Your wine descriptions were not changed."))
      onChanged?.()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBatchSaving(false)
    }
  }

  useEffect(() => {
    if (!open || !isOnline || !selectedId) return
    let active = true
    setLoading(true)
    setStatus(null)
    void getHouseholdWineIdentityStatus(selectedId)
      .then((next) => { if (active) setStatus(next) })
      .catch((cause) => { if (active) setError(String(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isOnline, open, selectedId])

  function selectWine(wine: WineCatalogEntry) {
    setSelectedId(wine.id)
    setStatus(null)
    setQuery("")
    setResults([])
    setChoice(null)
    setSearched(false)
    setRequested(false)
    setError(null)
    setMessage(null)
  }

  async function search() {
    if (!selected || !isOnline || searching) return
    setSearching(true)
    setSearched(false)
    setError(null)
    setChoice(null)
    setResults([])
    try {
      setResults(await searchHouseholdWineIdentities(selected.id, query))
      setSearched(true)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSearching(false)
    }
  }

  async function save(action: "link" | "remove") {
    if (!selected || !status || !isOnline || saving || (action === "link" && !choice)) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const nextId = await manageHouseholdWineIdentity(
        selected.id, action, choice, status.sourceFingerprint,
        status.matchedReference?.referenceId ?? null,
      )
      setLocalLinks((current) => ({ ...current, [selected.id]: nextId }))
      // A confirmed identity can immediately change the model projection.
      // Refresh the wine card without waiting for the secondary status lookup.
      onChanged?.()
      setStatus(await getHouseholdWineIdentityStatus(selected.id))
      setChoice(null)
      setMessage(action === "link"
        ? t("Shared wine linked for this household. Your wine description was not changed.")
        : t("Shared wine link removed. Your wine description was not changed."))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSaving(false)
    }
  }

  async function requestMissing() {
    if (!selected || !status || !isOnline || requesting || requested || status.requestStatus !== null) return
    setRequesting(true)
    setError(null)
    try {
      await requestSharedWineIdentity(selected.id, status.sourceFingerprint)
      setRequested(true)
      setStatus(await getHouseholdWineIdentityStatus(selected.id))
      setMessage(t("Request recorded for review. No shared wine or cellar data was changed."))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setRequesting(false)
    }
  }

  return (
    <details
      className={compact ? "wine-identity-review wine-identity-review--compact" : "wine-identity-review"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{compact
        ? t("Review this wine’s shared identity")
        : <>{t("Review shared wine identities")} ({unmatchedCount} {t("without a link")})</>}</summary>
      <div className="wine-identity-review__body">
        <p>{t(compact
          ? "Confirm this wine against the shared library. The link stays in your cellar and does not change the shared wine."
          : "Choose a wine from your catalogue, then confirm an existing shared wine with the same vintage. The link belongs only to this household; it does not rename your wine or change the shared library.")}</p>
        {!isOnline ? <Notice tone="warning">{t("Reconnect to review wine identities.")}</Notice> : null}
        {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
        {message ? <Notice role="status" tone="success">{message}</Notice> : null}
        {!compact ? <section className="wine-identity-review__batch" aria-label={t("Find shared matches for my cellar")}>
          <button type="button" disabled={!isOnline || reconciling || batchSaving || unmatchedCount === 0}
            onClick={() => void findCellarMatches()}>
            {reconciling ? t("Looking for matches…") : t("Find shared matches for my cellar")}
          </button>
          <p>{t("This checks your cellar against the shared library. It does not rename wines or apply dates. Review suggestions before linking.")}</p>
          {reconciliation ? <>
            <p>{uniqueSuggestions.length} {t("one possible match")} · {ambiguousSuggestions.length} {t("several possible matches")} · {missingSuggestions.length} {t("no match yet")}</p>
            {uniqueSuggestions.length > 0 ? <>
              <button type="button" disabled={batchSaving} onClick={() => setBatchSelected(uniqueSuggestions.map((item) => item.wineId))}>
                {t("Select all single matches for review")}
              </button>
              <div className="wine-identity-review__batch-list">
                {uniqueSuggestions.slice(0, 100).map((item) => {
                  const wine = wines.find((entry) => entry.id === item.wineId)
                  const candidate = item.candidates[0]
                  return <label key={item.wineId}>
                    <input type="checkbox" checked={batchSelected.includes(item.wineId)} disabled={batchSaving}
                      onChange={(event) => setBatchSelected((current) => event.target.checked
                        ? [...current, item.wineId] : current.filter((id) => id !== item.wineId))} />
                    <span><strong>{wine ? wineLabel(wine) : item.wineId}</strong> → {candidate.producerName} · {candidate.productName} · {candidate.vintageYear ?? t("NV")}
                      <small>{candidate.matchBasis === "exact_or_curated_alias" ? t("Same name or reviewed alias") : t("Name overlap — check carefully")}</small></span>
                  </label>
                })}
              </div>
              {uniqueSuggestions.length > 100 ? <p>{t("Showing the first 100 suggestions. Select all to include the rest.")}</p> : null}
              <button type="button" disabled={batchSaving || batchSelected.length === 0} onClick={() => void confirmBatch()}>
                {batchSaving ? t("Saving…") : `${t("Confirm selected links")} (${Math.min(batchSelected.length, 50)})`}
              </button>
              {batchSelected.length > 50 ? <p>{t("Links are saved in batches of 50. Confirm again for the rest.")}</p> : null}
            </> : null}
            {ambiguousSuggestions.length > 0 ? <div>
              <h3>{t("Several possible matches — review individually")}</h3>
              {ambiguousSuggestions.slice(0, 50).map((item) => {
                const wine = wines.find((entry) => entry.id === item.wineId)
                return wine ? <button key={item.wineId} type="button" onClick={() => selectWine(wine)}>{wineLabel(wine)} · {item.candidateCount} {t("candidates")}</button> : null
              })}
            </div> : null}
            {missingSuggestions.length > 0 ? <p>{t("Wines with no match stay unchanged. You can request a shared entry from their individual review.")}</p> : null}
          </> : null}
        </section> : null}
        {!compact ? <>
          <label>{t("Find a wine in your catalogue")}
            <input type="search" value={localSearch} onChange={(event) => setLocalSearch(event.target.value)} />
          </label>
          <label className="wine-identity-review__toggle">
            <input type="checkbox" checked={showLinked} onChange={(event) => setShowLinked(event.target.checked)} />
            {t("Include already linked wines")}
          </label>
        </> : null}
        <div className="wine-identity-review__layout">
          {!compact ? <div className="wine-identity-review__wines" role="group" aria-label={t("Your catalogue wines")}>
            {filtered.length === 0 ? <p>{t("No wines to review here.")}</p> : null}
            {filtered.slice(0, 60).map((wine) => (
              <button
                type="button" key={wine.id} onClick={() => selectWine(wine)} disabled={saving || searching}
                className={wine.id === selectedId ? "is-selected" : ""}
                aria-pressed={wine.id === selectedId}
              >
                <strong>{wineLabel(wine)}</strong>
                <span>{wine.appellation ?? wine.area ?? "—"} · {t(wine.color)}</span>
                <span>{isLinked(wine) ? t("Linked") : t("No shared link")}</span>
              </button>
            ))}
            {filtered.length > 60 ? <p>{t("Showing 60 wines. Narrow the catalogue search to find another.")}</p> : null}
          </div> : null}
          {selected ? (
            <div className="wine-identity-review__editor">
              <h3>{wineLabel(selected)}</h3>
              <p>{t("Your wine")}: {selected.appellation ?? "—"} · {selected.area ?? "—"} · {t(selected.color)}</p>
              {loading ? <p>{t("Loading current link…")}</p> : null}
              {status?.matchedReference ? (
                <p>{t("Current shared wine")}: <strong>{status.matchedReference.producerName} · {status.matchedReference.productName}</strong>
                  <button type="button" disabled={saving || !isOnline} onClick={() => void save("remove")}>{t("Remove local link")}</button>
                </p>
              ) : null}
              <label>{t("Search existing shared wines")}
                <input type="search" value={query} disabled={searching} onChange={(event) => {
                  setQuery(event.target.value)
                  setChoice(null)
                  setResults([])
                  setSearched(false)
                }} placeholder={t("Producer or cuvée")} />
              </label>
              <button type="button" disabled={!status || !isOnline || searching || query.trim().length < 2} onClick={() => void search()}>
                {searching ? t("Searching…") : t("Search shared wines")}
              </button>
              {searched && results.length === 0 ? (
                <div className="wine-identity-review__confirm">
                  <p>{t("No shared wine for this vintage was found. Nothing was linked; a shared entry requires separate review.")}</p>
                  {!status?.matchedReference ? <button type="button" disabled={!status || !isOnline || requesting || requested || status.requestStatus !== null} onClick={() => void requestMissing()}>
                    {requested || status?.requestStatus !== null ? t("Request recorded") : requesting ? t("Saving…") : t("Request a shared wine entry")}
                  </button> : null}
                </div>
              ) : null}
              <div className="wine-identity-review__results" role="group" aria-label={t("Shared wine results")}>
                {results.map((identity) => (
                  <button type="button" key={identity.referenceId}
                    className={choice?.referenceId === identity.referenceId ? "is-selected" : ""}
                    aria-pressed={choice?.referenceId === identity.referenceId}
                    onClick={() => setChoice(identity)}>
                    <strong>{identity.producerName} · {identity.productName}</strong>
                    <span>{identity.vintageYear ?? t("NV")}{identity.releaseDesignator ? ` · ${identity.releaseDesignator}` : ""}</span>
                  </button>
                ))}
              </div>
              {choice ? (
                <div className="wine-identity-review__confirm">
                  <p>{t("Confirm the producer, cuvée and vintage before linking")}: <strong>{choice.producerName} · {choice.productName} · {choice.vintageYear ?? t("NV")}</strong></p>
                  <p>{t("The shared identity may not specify color or appellation. Check your bottle before confirming.")}</p>
                  <button type="button" disabled={saving || !status} onClick={() => void save("link")}>
                    {saving ? t("Saving…") : t("Confirm this shared wine")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </details>
  )
}
