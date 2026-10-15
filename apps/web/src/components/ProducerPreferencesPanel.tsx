import { useEffect, useMemo, useState } from "react"

import {
  getHouseholdProducerSources,
  manageHouseholdProducerPreference,
  searchHouseholdReferenceProducers,
  type ProducerReference,
  type ProducerSource,
} from "../data/householdProducerPreferences"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  householdId: string
  isOnline: boolean
}

export function ProducerPreferencesPanel({ householdId, isOnline }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [sources, setSources] = useState<ProducerSource[]>([])
  const [sourceFilter, setSourceFilter] = useState("")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ProducerReference[]>([])
  const [choice, setChoice] = useState<ProducerReference | null>(null)
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const selected = sources.find((source) => source.normalized === selectedKey) ?? null
  const filtered = useMemo(() => {
    const term = sourceFilter.trim().toLocaleLowerCase()
    return sources.filter((source) =>
      !term || source.sourceText.toLocaleLowerCase().includes(term) ||
      (source.canonicalName?.toLocaleLowerCase().includes(term) ?? false),
    )
  }, [sources, sourceFilter])

  useEffect(() => {
    if (!open || !isOnline) return
    let active = true
    void getHouseholdProducerSources(householdId)
      .then((next) => { if (active) setSources(next) })
      .catch((cause) => { if (active) setError(String(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [householdId, isOnline, open])

  useEffect(() => {
    if (!open || !isOnline || !selectedKey || query.trim().length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      void searchHouseholdReferenceProducers(householdId, query)
        .then((next) => { if (active) setResults(next) })
        .catch((cause) => { if (active) setError(String(cause)) })
        .finally(() => { if (active) setSearching(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [householdId, isOnline, open, query, selectedKey])

  function selectSource(source: ProducerSource) {
    setSelectedKey(source.normalized)
    setQuery(source.canonicalName ?? source.sourceText)
    setChoice(null)
    setResults([])
    setSearching((source.canonicalName ?? source.sourceText).trim().length >= 2)
    setMessage(null)
    setError(null)
  }

  async function save(action: "set" | "remove") {
    if (!selected || !isOnline || saving || (action === "set" && !choice)) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await manageHouseholdProducerPreference(householdId, selected, action, choice?.id ?? null)
      const next = await getHouseholdProducerSources(householdId)
      setSources(next)
      setChoice(null)
      setMessage(t("Producer preference saved for this household only."))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="producer-preferences" open={open} onToggle={(event) => {
      const nextOpen = event.currentTarget.open
      setOpen(nextOpen)
      if (nextOpen) { setLoading(isOnline); setError(null) }
    }}>
      <summary>{t("Producer names for this household")}</summary>
      <div className="producer-preferences__body">
        <p>{t("Link a producer name in your catalogue to a shared producer profile. This choice applies only to this household; it does not rename your wines or change other cellars.")}</p>
        {!isOnline ? <Notice tone="warning">{t("Reconnect to review producer names.")}</Notice> : null}
        {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
        {message ? <Notice role="status" tone="success">{message}</Notice> : null}
        {loading ? <p>{t("Loading producer names…")}</p> : null}
        {isOnline && !loading ? (
          <>
            <label>{t("Find a name in your catalogue")}
              <input value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} />
            </label>
            <div className="producer-preferences__sources" role="group" aria-label={t("Catalogue producer names")}>
              {filtered.length === 0 ? <p>{t("No producer names found.")}</p> : null}
              {filtered.map((source) => (
                <button
                  className={selectedKey === source.normalized ? "is-selected" : ""}
                  key={source.normalized}
                  onClick={() => selectSource(source)}
                  type="button"
                >
                  <strong>{source.sourceText}</strong>
                  <span>{source.wineCount} {source.wineCount === 1 ? t("wine") : t("wines")}</span>
                  <span>{source.canonicalName ?? t("No local match yet")}</span>
                </button>
              ))}
            </div>
            {selected ? (
              <div className="producer-preferences__editor">
                <h3>{selected.sourceText}</h3>
                <p>{t("Current shared producer")}: {selected.canonicalName ?? t("None")}</p>
                <label>{t("Search shared producer profiles")}
                  <input value={query} onChange={(event) => {
                    setQuery(event.target.value)
                    setChoice(null)
                    setResults([])
                    setSearching(event.target.value.trim().length >= 2)
                  }} />
                </label>
                {searching ? <p>{t("Searching…")}</p> : null}
                {query.trim().length >= 2 && !searching && results.length === 0 ? <p>{t("No shared producer found. This screen does not create a new shared profile.")}</p> : null}
                <div className="producer-preferences__results" role="group" aria-label={t("Shared producers")}>
                  {results.map((producer) => (
                    <button
                      aria-pressed={choice?.id === producer.id}
                      className={choice?.id === producer.id ? "is-selected" : ""}
                      key={producer.id}
                      onClick={() => setChoice(producer)}
                      type="button"
                    >{producer.canonicalName}</button>
                  ))}
                </div>
                {choice ? <p>{t("Selected shared producer")}: <strong>{choice.canonicalName}</strong></p> : null}
                <div className="producer-preferences__actions">
                  <button disabled={!choice || saving} onClick={() => void save("set")} type="button">
                    {saving ? t("Saving…") : t("Save for this household")}
                  </button>
                  {selected.producerId ? (
                    <button disabled={saving} onClick={() => void save("remove")} type="button">
                      {t("Remove local match")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  )
}
