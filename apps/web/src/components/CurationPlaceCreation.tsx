import { useState } from "react"

import { createCurationPlace, type CurationTarget } from "../data/drinkingWindowFallbackAuthoring"
import { useLanguage } from "../i18n/useLanguage"
import { CurationTargetPicker } from "./CurationTargetPicker"
import { Notice } from "./Notice"

interface Props {
  initialRegionName?: string
  initialAppellationName?: string
  isOnline: boolean
  onCreated?: (kind: "region" | "appellation", target: CurationTarget) => void
}

export function CurationPlaceCreation({ initialRegionName = "", initialAppellationName = "",
  isOnline, onCreated }: Props) {
  const { t } = useLanguage()
  const [kind, setKind] = useState<"region" | "appellation">("region")
  const [regionName, setRegionName] = useState(initialRegionName)
  const [appellationName, setAppellationName] = useState(initialAppellationName)
  const [parent, setParent] = useState<CurationTarget | null>(null)
  const [countryCode, setCountryCode] = useState("FR")
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function create() {
    setBusy(true); setError(null); setMessage(null)
    try {
      const target = await createCurationPlace({ kind,
        parentRegionId: kind === "appellation" ? parent?.id ?? null : null,
        canonicalName: kind === "region" ? regionName : appellationName,
        countryCode, identityReason: reason, confirmed,
      })
      onCreated?.(kind, target)
      setMessage(t("Shared place created. No drinking dates or household wines were changed."))
      setReason(""); setConfirmed(false)
      if (kind === "region") { setParent(target); setKind("appellation") }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to create shared place")
    } finally { setBusy(false) }
  }

  return <details className="drinking-window-place-creation">
    <summary>{t("Region or appellation missing from the shared library?")}</summary>
    <p>{t("Search for an existing place first. Create a region, then its appellation with that exact parent. This creates identity only, not drinking dates.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <label>{t("Place to create")}
      <select value={kind} onChange={(event) => setKind(event.target.value as "region" | "appellation")}>
        <option value="region">{t("Region")}</option>
        <option value="appellation">{t("Appellation")}</option>
      </select>
    </label>
    {kind === "appellation" ? <CurationTargetPicker kind="region" label={t("Parent region")}
      value={parent} onChange={setParent} isOnline={isOnline} /> : null}
    <label>{t(kind === "region" ? "Canonical region name" : "Canonical appellation name")}
      <input required minLength={2} maxLength={200}
        value={kind === "region" ? regionName : appellationName}
        onChange={(event) => kind === "region" ? setRegionName(event.target.value)
          : setAppellationName(event.target.value)} />
    </label>
    <label>{t("Country code (two letters)")}
      <input required minLength={2} maxLength={2} autoCapitalize="characters"
        value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} />
    </label>
    <label>{t("Why is this the correct geographic identity?")}
      <textarea required minLength={20} maxLength={1000} value={reason}
        onChange={(event) => setReason(event.target.value)} />
    </label>
    <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
      {t("I checked the existing places and confirm this geographic identity.")}</label>
    <button type="button" disabled={!isOnline || busy || !confirmed || reason.trim().length < 20
      || (kind === "appellation" && !parent)
      || (kind === "region" ? regionName.trim().length < 2 : appellationName.trim().length < 2)
      || !/^[A-Z]{2}$/.test(countryCode)} onClick={() => void create()}>
      {busy ? t("Saving…") : t("Create shared place")}
    </button>
  </details>
}
