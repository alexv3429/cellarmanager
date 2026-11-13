import { useState } from "react"

import { createCurationClimates, listCurationClimates, type CurationClimat, type CurationTarget } from "../data/drinkingWindowFallbackAuthoring"
import { useLanguage } from "../i18n/useLanguage"
import { CurationTargetPicker } from "./CurationTargetPicker"
import { Notice } from "./Notice"

export function CurationClimatCreation({ isOnline }: { isOnline: boolean }) {
  const { t } = useLanguage()
  const [appellation, setAppellation] = useState<CurationTarget | null>(null)
  const [existing, setExisting] = useState<CurationClimat[] | null>(null)
  const [names, setNames] = useState("")
  const [source, setSource] = useState("")
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const lines = names.split(/\r?\n/).map((name) => name.trim()).filter(Boolean)

  async function load() {
    if (!appellation) return
    setBusy(true); setError(null); setMessage(null)
    try { setExisting(await listCurationClimates(appellation.id)) }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to list climates") }
    finally { setBusy(false) }
  }

  async function create() {
    if (!appellation || existing === null) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const created = await createCurationClimates({ appellationId: appellation.id, names: lines,
        sourceUrl: source, reason, confirmed })
      setExisting([...existing, ...created].sort((a, b) => a.name.localeCompare(b.name)))
      setMessage(t("{count} shared climates created. No dates or cellar wines were changed.", { count: String(created.length) }))
      setNames(""); setConfirmed(false)
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to create climates") }
    finally { setBusy(false) }
  }

  return <details className="drinking-window-place-creation">
    <summary>{t("Add missing shared climates")}</summary>
    <p>{t("Choose an appellation, check existing names, then add the exact official names with their source. This does not add drinking dates or change cellar wines.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <CurationTargetPicker kind="appellation" label={t("Parent appellation")}
      value={appellation} onChange={(value) => { setAppellation(value); setExisting(null); setConfirmed(false) }} isOnline={isOnline && !busy} />
    <button type="button" disabled={!isOnline || busy || !appellation} onClick={() => void load()}>
      {t("Show existing climates")}
    </button>
    {existing !== null ? <>
      <p>{existing.length ? t("Existing shared climates:") : t("No shared climates yet for this appellation.")}</p>
      {existing.length ? <ul>{existing.map((item) => <li key={item.id}>{item.name}</li>)}</ul> : null}
      <label>{t("Exact climat names, one per line")}
        <textarea value={names} onChange={(event) => { setNames(event.target.value); setConfirmed(false) }} />
      </label>
      <label>{t("Official source URL")}
        <input type="url" value={source} onChange={(event) => { setSource(event.target.value); setConfirmed(false) }} />
      </label>
      <label>{t("Why are these the correct identities?")}
        <textarea value={reason} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} />
      </label>
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        {t("I checked each name, its appellation and the source, and avoided duplicates.")}</label>
      <button type="button" disabled={!isOnline || busy || !confirmed || lines.length < 1 || lines.length > 50
        || reason.trim().length < 20 || !/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/[^\s]*)?$/.test(source.trim())} onClick={() => void create()}>
        {busy ? t("Saving…") : t("Create shared climates")}
      </button>
    </> : null}
  </details>
}
