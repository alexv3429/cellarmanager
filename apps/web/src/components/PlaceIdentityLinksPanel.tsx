import { useEffect, useMemo, useState } from "react"

import {
  getHouseholdPlaceGroups, manageHouseholdPlaceLink, searchHouseholdPlaces,
  type PlaceIdentityGroup, type PlaceIdentityGroups, type SharedPlace,
} from "../data/householdPlaceIdentities"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  householdId: string
  isOnline: boolean
}

function key(group: PlaceIdentityGroup): string {
  return JSON.stringify(group.kind === "region"
    ? [group.kind, group.sourceArea]
    : [group.kind, group.sourceArea, group.sourceAppellation])
}

export function PlaceIdentityLinksPanel({ householdId, isOnline }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<PlaceIdentityGroups>({ regions: [], appellations: [] })
  const [filter, setFilter] = useState("")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SharedPlace[]>([])
  const [choice, setChoice] = useState<SharedPlace | null>(null)
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const allGroups: PlaceIdentityGroup[] = [...groups.regions, ...groups.appellations]
  const selected = allGroups.find((group) => key(group) === selectedKey) ?? null
  const filtered = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase()
    const matches = (group: PlaceIdentityGroup) => !term ||
      `${group.sourceArea} ${group.kind === "appellation" ? group.sourceAppellation : ""} ${group.resolvedName ?? ""}`
        .toLocaleLowerCase().includes(term)
    return {
      regions: groups.regions.filter(matches),
      appellations: groups.appellations.filter(matches),
    }
  }, [groups, filter])

  useEffect(() => {
    if (!open || !isOnline) return
    let active = true
    void getHouseholdPlaceGroups(householdId)
      .then((next) => { if (active) setGroups(next) })
      .catch((cause) => { if (active) setError(String(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [householdId, isOnline, open])

  useEffect(() => {
    if (!open || !isOnline || !selected || (selected.kind === "appellation" && !selected.regionId)
        || query.trim().length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      void searchHouseholdPlaces(householdId, selected.kind, selected.sourceArea, query)
        .then((next) => { if (active) setResults(next) })
        .catch((cause) => { if (active) setError(String(cause)) })
        .finally(() => { if (active) setSearching(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [householdId, isOnline, open, query, selected])

  function select(group: PlaceIdentityGroup) {
    setSelectedKey(key(group))
    const text = group.kind === "region" ? group.sourceArea : group.sourceAppellation
    setQuery(group.resolvedName ?? text)
    setChoice(null)
    setResults([])
    setSearching(text.trim().length >= 2 && (group.kind === "region" || group.regionId !== null))
    setError(null)
    setMessage(null)
  }

  async function save(action: "set" | "remove") {
    if (!selected || !isOnline || saving || (action === "set" && !choice)) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await manageHouseholdPlaceLink(householdId, selected, action, choice?.id ?? null)
      setGroups(await getHouseholdPlaceGroups(householdId))
      setChoice(null)
      setMessage(t("Place link saved for this household only."))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSaving(false)
    }
  }

  return <details className="producer-preferences" onToggle={(event) => {
    const next = event.currentTarget.open
    setOpen(next)
    if (next) { setLoading(isOnline); setError(null) }
  }}>
    <summary>{t("Region and appellation names for this household")}</summary>
    <div className="producer-preferences__body">
      <p>{t("Link your cellar's region names first, then appellations inside each region. These choices are private to your household; they do not rename wines or create global aliases.")}</p>
      {!isOnline ? <Notice tone="warning">{t("Reconnect to review place names.")}</Notice> : null}
      {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
      {message ? <Notice role="status" tone="success">{message}</Notice> : null}
      {loading ? <p>{t("Loading place names…")}</p> : null}
      {isOnline && !loading ? <>
        <label>{t("Find a region or appellation in your catalogue")}
          <input value={filter} onChange={(event) => setFilter(event.target.value)} />
        </label>
        <h3>{t("Regions in your cellar")}</h3>
        <div className="producer-preferences__sources" role="group" aria-label={t("Cellar regions")}>
          {filtered.regions.slice(0, 50).map((group) => <button className={selectedKey === key(group) ? "is-selected" : ""}
            key={key(group)} onClick={() => select(group)} type="button">
            <strong>{group.sourceArea}</strong><span>{group.wineCount} {t("wines")}</span>
            <span>{group.resolvedName ?? t("No local match yet")}</span>
          </button>)}
          {filtered.regions.length > 50 ? <p>{t("Showing the first 50 places. Search to narrow the list.")}</p> : null}
        </div>
        <h3>{t("Appellations in your cellar")}</h3>
        <div className="producer-preferences__sources" role="group" aria-label={t("Cellar appellations")}>
          {filtered.appellations.slice(0, 50).map((group) => <button className={selectedKey === key(group) ? "is-selected" : ""}
            key={key(group)} onClick={() => select(group)} type="button">
            <strong>{group.sourceAppellation}</strong><span>{group.sourceArea} · {group.wineCount} {t("wines")}</span>
            <span>{!group.regionId ? t("Link the region first")
              : !group.valid ? t("Region and appellation disagree")
                : group.resolvedName ?? t("No local match yet")}</span>
          </button>)}
          {filtered.appellations.length > 50 ? <p>{t("Showing the first 50 places. Search to narrow the list.")}</p> : null}
        </div>
        {selected ? <div className="producer-preferences__editor">
          <h3>{selected.kind === "region" ? selected.sourceArea : `${selected.sourceAppellation} · ${selected.sourceArea}`}</h3>
          <p>{t("Current shared place")}: {selected.resolvedName ?? t("None")}
            {selected.chosenId ? ` · ${t("Household choice")}` : selected.resolvedId ? ` · ${t("Recognised common name")}` : ""}</p>
          {selected.kind === "appellation" && !selected.regionId ? <p>{t("Link this region above before choosing an appellation.")}</p> : <>
            <label>{selected.kind === "region" ? t("Search shared regions") : t("Search appellations in this region")}
              <input value={query} onChange={(event) => {
                setQuery(event.target.value); setChoice(null); setResults([])
                setSearching(event.target.value.trim().length >= 2)
              }} />
            </label>
            {searching ? <p>{t("Searching…")}</p> : null}
            {query.trim().length >= 2 && !searching && results.length === 0 ? <p>{t("No shared place found. A curator must add the missing place.")}</p> : null}
            <div className="producer-preferences__results" role="group" aria-label={t("Shared places")}>
              {results.map((place) => <button aria-pressed={choice?.id === place.id}
                className={choice?.id === place.id ? "is-selected" : ""}
                key={place.id} onClick={() => setChoice(place)} type="button">{place.name}</button>)}
            </div>
            {choice ? <p>{t("Selected shared place")}: <strong>{choice.name}</strong></p> : null}
            <div className="producer-preferences__actions">
              <button disabled={!choice || saving} onClick={() => void save("set")} type="button">
                {saving ? t("Saving…") : t("Save for this household")}
              </button>
              {selected.chosenId ? <button disabled={saving} onClick={() => void save("remove")} type="button">
                {t("Remove local match")}
              </button> : null}
            </div>
          </>}
        </div> : null}
      </> : null}
    </div>
  </details>
}
