import { useEffect, useState } from "react"

import {
  getHouseholdWineIdentityStatus,
  manageHouseholdWineIdentity,
  requestSharedWineIdentity,
  searchHouseholdWineIdentities,
  type HouseholdWineIdentityStatus,
  type SharedWineIdentity,
} from "../data/householdWineIdentities"
import type { WineCatalogEntry } from "../data/wineCatalog"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  isOnline: boolean
  wines: WineCatalogEntry[]
}

function wineLabel(wine: WineCatalogEntry): string {
  return [wine.producer, wine.cuvee, wine.vintage ?? "NV"].join(" · ")
}

export function WineIdentityReviewPanel({ isOnline, wines }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [localSearch, setLocalSearch] = useState("")
  const [showLinked, setShowLinked] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
    <details className="wine-identity-review" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("Review shared wine identities")} ({unmatchedCount} {t("without a link")})</summary>
      <div className="wine-identity-review__body">
        <p>{t("Choose a wine from your catalogue, then confirm an existing shared wine with the same vintage. The link belongs only to this household; it does not rename your wine or change the shared library.")}</p>
        {!isOnline ? <Notice tone="warning">{t("Reconnect to review wine identities.")}</Notice> : null}
        {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
        {message ? <Notice role="status" tone="success">{message}</Notice> : null}
        <label>{t("Find a wine in your catalogue")}
          <input type="search" value={localSearch} onChange={(event) => setLocalSearch(event.target.value)} />
        </label>
        <label className="wine-identity-review__toggle">
          <input type="checkbox" checked={showLinked} onChange={(event) => setShowLinked(event.target.checked)} />
          {t("Include already linked wines")}
        </label>
        <div className="wine-identity-review__layout">
          <div className="wine-identity-review__wines" role="group" aria-label={t("Your catalogue wines")}>
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
          </div>
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
