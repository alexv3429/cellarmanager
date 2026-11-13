import { useState } from "react"
import { reuseProfileLwin, searchProfileLwin, type ProfileLwinCandidate } from "../data/drinkingWindowProfileExchange"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

export function ProfileLwinSearch({ profileId, cuveeId, producerId, disabled, onSelect }: {
  profileId: string; cuveeId: string; producerId: string; disabled: boolean
  onSelect: (id: string, label: string) => void
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ProfileLwinCandidate[] | null>(null)
  const [selected, setSelected] = useState<ProfileLwinCandidate | null>(null)
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function search() {
    setBusy(true); setError(""); setSelected(null); setConfirmed(false)
    try { setResults(await searchProfileLwin(profileId, cuveeId, producerId, query)) }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Search failed") }
    finally { setBusy(false) }
  }
  async function reuse() {
    if (!selected) return
    setBusy(true); setError("")
    try {
      const id = await reuseProfileLwin(profileId, cuveeId, producerId, selected.lwin7, reason, confirmed)
      onSelect(id, selected.name)
      setSelected(null); setResults(null); setReason(""); setConfirmed(false)
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to reuse LWIN wine") }
    finally { setBusy(false) }
  }
  return <details>
    <summary>{t("Find this cuvée in LWIN")}</summary>
    <p>{t("Search for an exact wine from the selected producer. Check the appellation, classification and colour before reuse; no cellar or drinking dates are changed.")}</p>
    {!producerId ? <p>{t("First select the shared producer above.")}</p> : null}
    <label>{t("Cuvée or climat to search")}
      <input value={query} disabled={disabled || busy} onChange={(event) => setQuery(event.target.value)} />
    </label>
    <button type="button" disabled={disabled || busy || !producerId || query.trim().length < 3}
      onClick={() => void search()}>{t("Search LWIN")}</button>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {results?.length === 0 ? <p>{t("No exact LWIN cuvée was found for this producer.")}</p> : null}
    {results?.length ? <ul>{results.map((item) => <li key={item.lwin7}>
      <button type="button" disabled={disabled || busy} onClick={() => { setSelected(item); setConfirmed(false) }}>
        {item.name} · LWIN7 {item.lwin7} · {[item.region, item.appellation, item.site, item.parcel, item.classification, item.color].filter(Boolean).join(" · ")}
      </button>
    </li>)}</ul> : null}
    {selected ? <div>
      <p>{t("Selected LWIN wine")}: {selected.name} · LWIN7 {selected.lwin7}</p>
      <label>{t("Why this is the same wine (at least 30 characters)")}
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        {t("I checked the producer, cuvée, appellation and colour. No drinking dates are approved.")}</label>
      <button type="button" disabled={disabled || busy || !confirmed || reason.trim().length < 30}
        onClick={() => void reuse()}>{t("Reuse this LWIN wine")}</button>
    </div> : null}
  </details>
}
