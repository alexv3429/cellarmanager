import { useEffect, useMemo, useState } from "react"

import {
  getHouseholdCuveeGroups, manageHouseholdCuveeLink, searchHouseholdCuveeProducts,
  type CuveeIdentityGroup, type CuveeProduct,
} from "../data/householdCuveeIdentities"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  householdId: string
  isOnline: boolean
}

function key(group: CuveeIdentityGroup): string {
  return [group.sourceProducer, group.sourceCuvee, group.sourceAppellation, group.sourceColor].join("\u0000")
}

export function CuveeIdentityLinksPanel({ householdId, isOnline }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<CuveeIdentityGroup[]>([])
  const [filter, setFilter] = useState("")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<CuveeProduct[]>([])
  const [choice, setChoice] = useState<CuveeProduct | null>(null)
  const [firstVintage, setFirstVintage] = useState("1800")
  const [lastVintage, setLastVintage] = useState("2200")
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const selected = groups.find((group) => key(group) === selectedKey) ?? null
  const filtered = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase()
    return groups.filter((group) => !term ||
      `${group.sourceProducer} ${group.sourceCuvee} ${group.sourceAppellation} ${group.producerName ?? ""}`
        .toLocaleLowerCase().includes(term))
  }, [groups, filter])

  useEffect(() => {
    if (!open || !isOnline) return
    let active = true
    void getHouseholdCuveeGroups(householdId)
      .then((next) => { if (active) setGroups(next) })
      .catch((cause) => { if (active) setError(String(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [householdId, isOnline, open])

  useEffect(() => {
    if (!open || !isOnline || !selected?.producerId || query.trim().length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      void searchHouseholdCuveeProducts(householdId, selected.sourceProducer, query)
        .then((next) => { if (active) setResults(next) })
        .catch((cause) => { if (active) setError(String(cause)) })
        .finally(() => { if (active) setSearching(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [householdId, isOnline, open, query, selected])

  function select(group: CuveeIdentityGroup) {
    setSelectedKey(key(group))
    setQuery(group.sourceCuvee)
    setResults([])
    setChoice(null)
    setSearching(group.producerId !== null && group.sourceCuvee.trim().length >= 2)
    setFirstVintage("1800")
    setLastVintage("2200")
    setError(null)
    setMessage(null)
  }

  async function save(action: "set" | "remove", first: number, last: number,
    productId: string | null, expected: string | null) {
    if (!selected || !isOnline || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await manageHouseholdCuveeLink(householdId, selected, action, first, last, productId, expected)
      setGroups(await getHouseholdCuveeGroups(householdId))
      setChoice(null)
      setMessage(t("Cuvée link saved for this household only."))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSaving(false)
    }
  }

  const first = Number(firstVintage)
  const last = Number(lastVintage)
  const validRange = Number.isInteger(first) && Number.isInteger(last) && first >= 1800 && last <= 2200 && first <= last
  const existingAtStart = selected?.links.find((link) => link.firstVintage === first) ?? null

  return (
    <details className="producer-preferences" onToggle={(event) => {
      const next = event.currentTarget.open
      setOpen(next)
      if (next) { setLoading(isOnline); setError(null) }
    }}>
      <summary>{t("Cuvée names for this household")}</summary>
      <div className="producer-preferences__body">
        <p>{t("First link a producer above, then link its cuvées here. A confirmed link applies to all selected vintages in this household without changing the names on your wine cards. It does not approve any drinking dates.")}</p>
        {!isOnline ? <Notice tone="warning">{t("Reconnect to review cuvée names.")}</Notice> : null}
        {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
        {message ? <Notice role="status" tone="success">{message}</Notice> : null}
        {loading ? <p>{t("Loading cuvée names…")}</p> : null}
        {isOnline && !loading ? <>
          <label>{t("Find a cuvée in your catalogue")}
            <input value={filter} onChange={(event) => setFilter(event.target.value)} />
          </label>
          <div className="producer-preferences__sources" role="group" aria-label={t("Catalogue cuvée names")}>
            {filtered.length === 0 ? <p>{t("No cuvées found.")}</p> : null}
            {filtered.slice(0, 50).map((group) => <button
              className={selectedKey === key(group) ? "is-selected" : ""}
              key={key(group)} onClick={() => select(group)} type="button"
            >
              <strong>{group.sourceProducer} · {group.sourceCuvee}</strong>
              <span>{group.sourceAppellation || "—"} · {group.sourceColor} · {group.wineCount} {t("wines")}</span>
              <span>{group.producerName ?? t("Link the producer first")}</span>
            </button>)}
            {filtered.length > 50 ? <p>{t("Showing the first 50 cuvées. Search to narrow the list.")}</p> : null}
          </div>
          {selected ? <div className="producer-preferences__editor">
            <h3>{selected.sourceProducer} · {selected.sourceCuvee}</h3>
            <p>{selected.sourceAppellation || "—"} · {selected.sourceColor} · {selected.firstSeenVintage}–{selected.lastSeenVintage}</p>
            <p>{t("Shared producer")}: {selected.producerName ?? t("None")}</p>
            {selected.links.map((link) => <div key={`${link.firstVintage}-${link.productId}`}>
              <p>{link.firstVintage}–{link.lastVintage} → <strong>{link.productName}</strong>{!link.active ? ` · ${t("Inactive: producer link changed")}` : ""}</p>
              <button disabled={saving} onClick={() => void save("remove", link.firstVintage, link.lastVintage, null, link.productId)} type="button">
                {t("Remove this cuvée link")}
              </button>
            </div>)}
            {selected.producerId ? <>
              <label>{t("Search this producer's shared cuvées")}
                <input value={query} onChange={(event) => { setQuery(event.target.value); setResults([]); setChoice(null); setSearching(event.target.value.trim().length >= 2) }} />
              </label>
              {searching ? <p>{t("Searching…")}</p> : null}
              {query.trim().length >= 2 && !searching && results.length === 0 ? <p>{t("No shared cuvée found yet. A curator must add missing identities from the profile.")}</p> : null}
              <div className="producer-preferences__results" role="group" aria-label={t("Shared cuvées")}>
                {results.map((product) => <button aria-pressed={choice?.id === product.id}
                  className={choice?.id === product.id ? "is-selected" : ""}
                  key={product.id} onClick={() => setChoice(product)} type="button">{product.name}</button>)}
              </div>
              {choice ? <p>{t("Selected shared cuvée")}: <strong>{choice.name}</strong></p> : null}
              <p>{t("Use all vintages unless this cuvée was renamed or its identity changed. For a name-change exception, limit the years to the applicable era.")}</p>
              <div className="producer-preferences__actions">
                <label>{t("From vintage")}<input type="number" min="1800" max="2200" value={firstVintage} onChange={(event) => setFirstVintage(event.target.value)} /></label>
                <label>{t("Through vintage")}<input type="number" min="1800" max="2200" value={lastVintage} onChange={(event) => setLastVintage(event.target.value)} /></label>
              </div>
              <button disabled={!choice || !validRange || saving} onClick={() => void save("set", first, last, choice?.id ?? null, existingAtStart?.productId ?? null)} type="button">
                {saving ? t("Saving…") : t("Save this cuvée link")}
              </button>
            </> : <p>{t("Link this producer in the section above before choosing a shared cuvée.")}</p>}
          </div> : null}
        </> : null}
      </div>
    </details>
  )
}
