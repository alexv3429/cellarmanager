import { useState } from "react"

import { searchCurationTargets, type CurationTarget, type TargetKind } from "../data/drinkingWindowFallbackAuthoring"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  kind: TargetKind
  label: string
  value: CurationTarget | null
  onChange: (value: CurationTarget | null) => void
  isOnline: boolean
}

export function CurationTargetPicker({ kind, label, value, onChange, isOnline }: Props) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<CurationTarget[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    setBusy(true)
    setError(null)
    try { setOptions(await searchCurationTargets(kind, query)) }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to search") }
    finally { setBusy(false) }
  }

  return <div className="drinking-window-target-picker">
    <label>{label}
      <input value={query} disabled={!isOnline || busy} onChange={(event) => {
        setQuery(event.target.value)
        onChange(null)
        setOptions([])
      }} />
    </label>
    <button type="button" disabled={!isOnline || busy || query.trim().length < 2}
      onClick={() => void search()}>{busy ? t("Searching…") : t("Search shared reference")}</button>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {options.length ? <select aria-label={label} value={value?.id ?? ""}
      onChange={(event) => onChange(options.find((option) => option.id === event.target.value) ?? null)}>
      <option value="">{t("Choose an exact identity")}</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.detail}</option>)}
    </select> : null}
    {value ? <small>{t("Selected")}: {value.label} · {value.detail}</small> : null}
  </div>
}
