import { useEffect, useMemo, useState } from "react"

import {
  getHouseholdProducerSources,
  manageHouseholdProducerPreference,
  partitionProducerReferences,
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
  const [batchSelection, setBatchSelection] = useState<string[]>([])
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
  const { choices: unambiguousResults, ambiguousNames } = useMemo(
    () => partitionProducerReferences(results), [results],
  )
  const { choices: suggestedChoices, ambiguousNames: ambiguousSuggestions } = useMemo(
    () => partitionProducerReferences(selected?.suggestions ?? []), [selected],
  )
  const remainingNames = sources.filter((source) => !source.producerId).length
  const batchCandidates = useMemo(() => sources.filter((source) =>
    !source.producerId && source.suggestions.length === 1,
  ).sort((a, b) => b.wineCount - a.wineCount || a.sourceText.localeCompare(b.sourceText)), [sources])
  const batchWineCount = batchCandidates.reduce((count, source) => count + source.wineCount, 0)

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
      setBatchSelection([])
      setChoice(null)
      setMessage(t("Producer preference saved for this household only."))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSaving(false)
    }
  }

  async function saveBatch() {
    if (!isOnline || saving || !batchSelection.length) return
    setSaving(true)
    setError(null)
    setMessage(null)
    let saved = 0
    const failed: string[] = []
    for (const key of batchSelection) {
      const source = batchCandidates.find((candidate) => candidate.normalized === key)
      if (!source) continue
      try {
        await manageHouseholdProducerPreference(householdId, source, "set", source.suggestions[0].id)
        saved++
      } catch (cause) {
        failed.push(`${source.sourceText}: ${String(cause)}`)
      }
    }
    try {
      setSources(await getHouseholdProducerSources(householdId))
      setBatchSelection([])
      if (saved) setMessage(t("{count} producer name matches saved for this household only.", { count: String(saved) }))
      if (failed.length) setError(t("Some producer names could not be linked; refresh and check them again.") + " " + failed.join(" · "))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="producer-preferences" open={open} onToggle={(event) => {
      if (event.target !== event.currentTarget) return
      const nextOpen = event.currentTarget.open
      setOpen(nextOpen)
      if (nextOpen) { setLoading(isOnline); setError(null) }
    }}>
      <summary>{t("Producer names for this household")}</summary>
      <div className="producer-preferences__body">
        <p>{t("Link a name in your catalogue to a producer already in the shared base. A saved JSON profile may still be awaiting review and will not appear here yet. This choice affects only this household; it does not rename wines or change other cellars.")}</p>
        {!isOnline ? <Notice tone="warning">{t("Reconnect to review producer names.")}</Notice> : null}
        {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
        {message ? <Notice role="status" tone="success">{message}</Notice> : null}
        {loading ? <p>{t("Loading producer names…")}</p> : null}
        {isOnline && !loading ? (
          <>
            <p>{t("{count} local producer names still need a household match.", { count: String(remainingNames) })}</p>
            {batchCandidates.length ? <details className="producer-preferences__batch">
              <summary>{t("Review {count} possible producer links affecting {wines} wines", {
                count: String(batchCandidates.length), wines: String(batchWineCount),
              })}</summary>
              <p>{t("Select only the name pairs you recognize. Nothing is linked until you save; local wine names stay unchanged.")}</p>
              <div className="producer-preferences__batch-list">
                {batchCandidates.map((source) => <label key={source.normalized}>
                  <input type="checkbox" disabled={saving}
                    checked={batchSelection.includes(source.normalized)}
                    onChange={(event) => setBatchSelection((current) => event.target.checked
                      ? [...current, source.normalized] : current.filter((key) => key !== source.normalized))} />
                  <span><strong>{source.sourceText}</strong> → {source.suggestions[0].canonicalName}
                    {" · "}{source.wineCount} {source.wineCount === 1 ? t("wine") : t("wines")}
                    {" · "}{t(source.suggestions[0].matchKind === "exact" ? "Exact name"
                      : source.suggestions[0].matchKind === "alias" ? "Shared alias" : "Similar name — verify")}</span>
                </label>)}
              </div>
              <button type="button" disabled={saving || !batchSelection.length}
                onClick={() => void saveBatch()}>{t("Save selected producer links for this household")}</button>
            </details> : null}
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
                {suggestedChoices.length || ambiguousSuggestions.length ? <div>
                  <h4>{t("Possible shared producers — check before saving")}</h4>
                  <p>{t("These are name suggestions, not confirmed links or drinking dates.")}</p>
                  {ambiguousSuggestions.length ? <Notice tone="warning">
                    <strong>{ambiguousSuggestions.join(", ")}</strong> — {t("Several shared producer identities have the same name. They must be reconciled or distinguished before you can choose one.")}
                  </Notice> : null}
                  <div className="producer-preferences__results" role="group" aria-label={t("Suggested shared producers")}>
                    {suggestedChoices.map((producer) => <button
                      aria-pressed={choice?.id === producer.id}
                      className={choice?.id === producer.id ? "is-selected" : ""}
                      key={producer.id}
                      onClick={() => setChoice(producer)}
                      type="button"
                    >{producer.canonicalName} · {t(producer.matchKind === "exact" ? "Exact name" : producer.matchKind === "alias" ? "Shared alias" : "Similar name — verify")}</button>)}
                  </div>
                </div> : null}
                <label>{t("Search shared producer profiles")}
                  <input value={query} onChange={(event) => {
                    setQuery(event.target.value)
                    setChoice(null)
                    setResults([])
                    setSearching(event.target.value.trim().length >= 2)
                  }} />
                </label>
                {searching ? <p>{t("Searching…")}</p> : null}
                {query.trim().length >= 2 && !searching && results.length === 0 && !suggestedChoices.length ? <p>{t("No shared producer found. If a JSON profile exists, its producer identity still needs to be added to the shared base by a curator.")}</p> : null}
                {ambiguousNames.length > 0 ? <Notice tone="warning">
                  <strong>{ambiguousNames.join(", ")}</strong> — {t("Several shared producer identities have the same name. They must be reconciled or distinguished before you can choose one.")}
                </Notice> : null}
                <div className="producer-preferences__results" role="group" aria-label={t("Shared producers")}>
                  {unambiguousResults.map((producer) => (
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
