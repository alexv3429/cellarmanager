import { useMemo, useRef, useState, type FormEvent } from "react"
import { familyLocationLabel, groupImportStorage, initialStorageChoices, isActiveStorage, saveImportStorageGroup, storageNameKey, suggestImportStorageFamilies, type ImportStorageChoices, type ImportStorageFamilyRule, type ImportStorageGroup, type ImportStorageSnapshot, type StorageTarget } from "../data/csvImportStorageSetup"
import type { CsvStorageReconciliationResult } from "../data/csvStorageReconciliation"
import { Notice } from "./Notice"
import { useLanguage } from "../i18n/useLanguage"

const PAGE_SIZE = 6

function StorageGroup({ group, snapshot, householdId, disabled, onSave }: {
  group: ImportStorageGroup; snapshot: ImportStorageSnapshot; householdId: string; disabled: boolean
  onSave: (group: ImportStorageGroup, choices: ImportStorageChoices) => Promise<void>
}) {
  const { t } = useLanguage()
  const [choices, setChoices] = useState(() => initialStorageChoices(group, snapshot, householdId))
  const [reviewed, setReviewed] = useState(false)
  const cellars = snapshot.cellars.filter((item) => item.household_id === householdId && isActiveStorage(item.is_active))
  const locations = snapshot.locations.filter((item) => choices.cellar.kind === "existing" &&
    item.household_id === householdId && item.cellar_id === choices.cellar.id && isActiveStorage(item.is_active))
  const rows = group.locations.reduce((count, location) => count + location.records.length, 0)
  const bottles = group.locations.reduce((count, location) => count + location.bottles, 0)
  function change(next: ImportStorageChoices) { setChoices(next); setReviewed(false) }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reviewed && !disabled) void onSave(group, choices)
  }
  return <form className="import-storage-group" aria-label={t("Storage for {value1}", { value1: String(group.sourceCellar || "rows without a cellar") })} onSubmit={submit}>
    <header><div><h4>{group.sourceCellar || t("No cellar in the file")}</h4><p>{rows} {rows === 1 ? t("row") : t("rows")} · {bottles} {bottles === 1 ? t("bottle") : t("bottles")} · {group.locations.length}{t(" ")}{t("source")}{t(" ")}{group.locations.length === 1 ? t("location") : t("locations")}</p>
      {group.sourceCellars.length > 1 ? <small>{t("Combined from file labels:")}{t(" ")}{group.sourceCellars.join(", ")}</small> : null}
    </div></header>
    <fieldset disabled={disabled}>
      <legend>{t("Destination cellar")}</legend>
      <div className="import-storage-group__fields">
        <label><span>{t("Use or create a cellar")}</span><select aria-label={t("Destination cellar")} value={choices.cellar.kind === "existing" ? choices.cellar.id : ""} onChange={(event) => {
          const cellar: StorageTarget = event.target.value ? { kind: "existing", id: event.target.value } : { kind: "new", name: group.sourceCellar }
          change(initialStorageChoices(group, snapshot, householdId, cellar))
        }}><option value="">{t("Create a new cellar")}</option>{cellars.map((cellar) => <option key={cellar.id} value={cellar.id}>{cellar.name}</option>)}</select></label>
        {choices.cellar.kind === "new" ? <label><span>{t("New cellar name")}</span><input required aria-label={t("New cellar name")} value={choices.cellar.name} onChange={(event) => change({ ...choices, cellar: { kind: "new", name: event.target.value } })} /></label> : null}
      </div>
      <div className="import-storage-group__locations">
        {group.locations.map((source) => {
          const target = choices.locations[source.key] ?? { kind: "new", name: source.sourceLocation || "General" }
          const setTarget = (target: StorageTarget) => change({ ...choices, locations: { ...choices.locations, [source.key]: target } })
          return <div className="import-storage-group__location" key={source.key}>
            <div><strong>{source.sourceLocation || "No location in the file"}</strong><small>{source.records.length} {source.records.length === 1 ? "row" : "rows"} · {source.bottles}{t(" ")}{t("bottles")}</small>
              {group.sourceCellars.length > 1 ? <small>{t("From")}{t(" ")}{source.sourceExamples.join(", ")}{source.records.length > source.sourceExamples.length ? ` and ${source.records.length - source.sourceExamples.length} more rows` : ""}</small> : null}
            </div>
            <div className="import-storage-group__fields">
              <label><span>{t("Destination location")}</span><select aria-label={`Destination for ${source.sourceLocation || "missing location"}`} value={target.kind === "existing" ? target.id : ""} onChange={(event) => setTarget(event.target.value ? { kind: "existing", id: event.target.value } : { kind: "new", name: source.sourceLocation || "General" })}>
                <option value="">{t("Create a new location")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}
              </select></label>
              {target.kind === "new" ? <label><span>{t("New location name")}</span><input required aria-label={`New location for ${source.sourceLocation || "missing location"}`} value={target.name} onChange={(event) => setTarget({ kind: "new", name: event.target.value })} /></label> : null}
            </div>
          </div>
        })}
      </div>
      <label className="import-storage-group__confirm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>{t("I reviewed these destinations. Create any missing storage and assign only these")}{t(" ")}{rows} {rows === 1 ? t("row") : t("rows")}.</span></label>
      <button type="submit" disabled={!reviewed}>{t("Confirm storage for")}{t(" ")}{group.sourceCellar || t("these rows")}</button>
    </fieldset>
  </form>
}

function ImportStorageFamilyEditor({ groups, results, rules, disabled, onRulesChange }: {
  groups: ImportStorageGroup[]
  results: CsvStorageReconciliationResult[]
  rules: ImportStorageFamilyRule[]
  disabled: boolean
  onRulesChange: (rules: ImportStorageFamilyRule[]) => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [destinationCellarName, setDestinationCellarName] = useState("")
  const [locationMode, setLocationMode] = useState<ImportStorageFamilyRule["locationMode"]>("suffix")
  const [error, setError] = useState<string | null>(null)
  const suggestions = useMemo(() => suggestImportStorageFamilies(groups), [groups])
  const sourceLabelCounts = useMemo(() => {
    const labels = new Map<string, { label: string; rows: number }>()
    for (const result of results) {
      if (result.status !== "unresolved" || result.row.issues.length || result.quantity === null || result.quantity <= 0) continue
      const label = result.row.fields.cellar?.trim() ?? ""
      if (!label) continue
      const key = storageNameKey(label)
      const entry = labels.get(key) ?? { label, rows: 0 }
      entry.rows += 1
      labels.set(key, entry)
    }
    return [...labels.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => a.label.localeCompare(b.label))
  }, [results])
  const assignedLabels = new Set(rules.flatMap((rule) => rule.sourceCellars.map(storageNameKey)))
  const availableLabels = sourceLabelCounts.filter((item) => !assignedLabels.has(item.key))
  const filteredLabels = availableLabels.filter((item) => item.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const selectedRows = selected.map((key) => sourceLabelCounts.find((item) => item.key === storageNameKey(key))).filter((item): item is NonNullable<typeof item> => Boolean(item))
  const previewRule: ImportStorageFamilyRule = { sourceCellars: selected, destinationCellarName, locationMode }

  function toggleLabel(label: string) {
    const key = storageNameKey(label)
    setSelected((current) => current.some((value) => storageNameKey(value) === key)
      ? current.filter((value) => storageNameKey(value) !== key)
      : [...current, label])
    setError(null)
  }

  function addRule() {
    const name = destinationCellarName.trim()
    if (selected.length < 2) { setError(t("Select at least two source labels to combine.")); return }
    if (!name) { setError(t("Enter a name for the destination cellar.")); return }
    const normalizedName = storageNameKey(name)
    if (rules.some((rule) => storageNameKey(rule.destinationCellarName) === normalizedName)) {
      setError(t("Each grouping rule needs a distinct destination cellar name.")); return
    }
    if (availableLabels.some((item) => !selected.some((label) => storageNameKey(label) === item.key) && item.key === normalizedName)) {
      setError(`Another source cellar is already named “${name}”. Include it in this rule or choose a different destination name.`); return
    }
    onRulesChange([...rules, { sourceCellars: selected, destinationCellarName: name, locationMode }])
    setSelected([]); setDestinationCellarName(""); setSearch(""); setError(null)
  }

  return <details className="import-storage-family-editor" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t("Combine source labels into cellars")}</summary>
    <p>{t("Use this when labels such as C1 and C2 are positions inside one cellar. This rule only changes the import preview. It does not create storage until you confirm a destination below.")}</p>
    {rules.length ? <ul className="import-storage-family-editor__rules">
      {rules.map((rule) => <li key={rule.sourceCellars.join("|")}>
        <span><strong>{rule.destinationCellarName}</strong><small>{rule.sourceCellars.join(", ")} → {rule.locationMode === "suffix" ? "ending number" : "full label"}</small></span>
        <button type="button" disabled={disabled} onClick={() => onRulesChange(rules.filter((candidate) => candidate !== rule))}>{t("Remove rule")}</button>
      </li>)}
    </ul> : null}
    {availableLabels.length ? <>
      {suggestions.filter((suggestion) => suggestion.sourceCellars.every((label) => availableLabels.some((item) => item.key === storageNameKey(label)))).length ? <div className="import-storage-family-editor__suggestions">
        <strong>{t("Suggested numeric groups")}</strong>
        {suggestions.filter((suggestion) => suggestion.sourceCellars.every((label) => availableLabels.some((item) => item.key === storageNameKey(label)))).map((suggestion) => <button type="button" key={suggestion.key} disabled={disabled} aria-label={`Select family ${suggestion.prefix} (${suggestion.sourceCellars.length} labels)`} onClick={() => { setSelected(suggestion.sourceCellars); setDestinationCellarName(suggestion.prefix); setError(null) }}>{t("Select")} {suggestion.prefix}: {suggestion.sourceCellars.join(", ")}
        </button>)}
      </div> : null}
      <label><span>{t("Find source cellar labels")}</span><input type="search" value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} /></label>
      <fieldset className="import-storage-family-editor__labels" disabled={disabled}>
        <legend>{t("Select labels to combine")}</legend>
        {filteredLabels.map((item) => <label key={item.key}>
          <input type="checkbox" checked={selected.some((label) => storageNameKey(label) === item.key)} onChange={() => toggleLabel(item.label)} />
          <span>{item.label}<small>{item.rows}{t(" ")}{t("stocked")}{t(" ")}{item.rows === 1 ? "row" : "rows"}</small></span>
        </label>)}
        {!filteredLabels.length ? <p>{t("No matching ungrouped cellar labels.")}</p> : null}
      </fieldset>
      <div className="import-storage-family-editor__fields">
        <label><span>{t("Destination cellar name")}</span><input value={destinationCellarName} disabled={disabled} onChange={(event) => { setDestinationCellarName(event.target.value); setError(null) }} /></label>
        <label><span>{t("Use as the location label")}</span><select value={locationMode} disabled={disabled} onChange={(event) => setLocationMode(event.target.value as ImportStorageFamilyRule["locationMode"])}>
          <option value="suffix">{t("Number at the end of the label")}</option>
          <option value="full-label">{t("Full source label")}</option>
        </select></label>
      </div>
      {selectedRows.length ? <div className="import-storage-family-editor__preview" aria-label={t("Storage grouping preview")}>
        <strong>{t("Preview")}</strong>
        {selectedRows.slice(0, 4).map((item) => {
          const sourceRow = results.find((result) => storageNameKey(result.row.fields.cellar ?? "") === item.key && result.quantity !== null && result.quantity > 0)
          const sourceLocation = sourceRow?.row.fields.location?.trim() ?? ""
          const destination = familyLocationLabel(item.label, sourceLocation, previewRule) || "General"
          return <p key={item.key}>{item.label}{sourceLocation ? ` / ${sourceLocation}` : ""}{t(" ")}{t("becomes")}{t(" ")}{destinationCellarName.trim() || "[cellar name]"} / {destination}</p>
        })}
        {selectedRows.length > 4 ? <small>{t("And")}{t(" ")}{selectedRows.length - 4}{t(" ")}{t("more source labels.")}</small> : null}
        <small>{t("Values from the source location column are kept after the generated label.")}</small>
      </div> : null}
      {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
      <button type="button" disabled={disabled || selected.length < 2 || !destinationCellarName.trim()} onClick={addRule}>{t("Add grouping rule")}</button>
    </> : <p>{t("All source labels are already included in grouping rules.")}</p>}
  </details>
}

export function ImportStorageGroups({ results, snapshot, householdId, disabled, isOnline, onBusy, onAssign }: {
  results: CsvStorageReconciliationResult[]; snapshot: ImportStorageSnapshot; householdId: string
  disabled: boolean; isOnline: boolean; onBusy: (busy: boolean) => void; onAssign: (assignments: Record<number, string>) => void
}) {
  const { t } = useLanguage()
  const sourceGroups = useMemo(() => groupImportStorage(results), [results])
  const [familyRules, setFamilyRules] = useState<ImportStorageFamilyRule[]>([])
  const groups = useMemo(() => groupImportStorage(results, familyRules), [results, familyRules])
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const saving = useRef(false)
  const filtered = groups.filter((group) => `${group.sourceCellar} ${group.locations.map((item) => item.sourceLocation).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1))
  async function save(group: ImportStorageGroup, choices: ImportStorageChoices) {
    if (disabled || !isOnline || saving.current) return
    saving.current = true
    onBusy(true); setError(null); setMessage(t("Saving cellar setup… No bottles are being imported."))
    try {
      const assignments = await saveImportStorageGroup(householdId, group, choices)
      onAssign(assignments)
      setMessage(`Storage confirmed for ${Object.keys(assignments).length} rows from ${group.sourceCellar || "the unnamed cellar group"}. Waiting for synchronized storage before import; no bottles have been added.`)
    } catch (cause: unknown) {
      setMessage(null)
      setError(`${cause instanceof Error ? cause.message : "Unable to confirm storage"} Some setup may already have been saved. No bottles were imported. Review and retry: matching active names are reused, not duplicated.`)
    } finally { saving.current = false; onBusy(false) }
  }
  return <div className="import-storage-groups" id="import-storage-groups">
    <header><h3>{t("Set up storage from your file")}</h3><p>{t("Review one cellar at a time. Create missing cellars and locations here, or map them to existing storage. Missing locations start with an editable “General” suggestion.")}</p>
      <p>{t("Confirmed setup is saved immediately and remains if you cancel the import. Bottles are added only at final confirmation. A matching active name is reused on retry; archived storage is never restored.")}</p></header>
    {sourceGroups.length > 1 ? <ImportStorageFamilyEditor groups={sourceGroups} results={results} rules={familyRules} disabled={disabled || !isOnline} onRulesChange={setFamilyRules} /> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
    {!isOnline ? <Notice>{t("Reconnect to confirm storage. Your review can wait here.")}</Notice> : null}
    {groups.length ? <>
      <label><span>{t("Find a source cellar or location")}</span><input type="search" value={search} disabled={disabled} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /></label>
      <p>{groups.length}{t(" ")}{t("cellar")}{t(" ")}{groups.length === 1 ? "group needs" : "groups need"}{t(" ")}{t("storage · Showing")}{t(" ")}{filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)}{t(" ")}{t("of")}{t(" ")}{filtered.length}{t(". Search does not change which rows will be imported.")}</p>
      {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((group) => <StorageGroup key={JSON.stringify(group)} group={group} snapshot={snapshot} householdId={householdId} disabled={disabled || !isOnline} onSave={save} />)}
      <div className="import-storage-groups__paging"><button type="button" disabled={disabled || currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("Previous cellars")}</button><button type="button" disabled={disabled || (currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>{t("Next cellars")}</button></div>
    </> : <p>{t("No grouped storage decisions remain. Catalog-only rows need no destination.")}</p>}
  </div>
}
