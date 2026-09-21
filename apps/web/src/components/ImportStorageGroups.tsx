import { useMemo, useRef, useState, type FormEvent } from "react"
import { groupImportStorage, initialStorageChoices, isActiveStorage, saveImportStorageGroup, type ImportStorageChoices, type ImportStorageGroup, type ImportStorageSnapshot, type StorageTarget } from "../data/csvImportStorageSetup"
import type { CsvStorageReconciliationResult } from "../data/csvStorageReconciliation"
import { Notice } from "./Notice"

const PAGE_SIZE = 6

function StorageGroup({ group, snapshot, householdId, disabled, onSave }: {
  group: ImportStorageGroup; snapshot: ImportStorageSnapshot; householdId: string; disabled: boolean
  onSave: (group: ImportStorageGroup, choices: ImportStorageChoices) => Promise<void>
}) {
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
  return <form className="import-storage-group" aria-label={`Storage for ${group.sourceCellar || "rows without a cellar"}`} onSubmit={submit}>
    <header><div><h4>{group.sourceCellar || "No cellar in the file"}</h4><p>{rows} {rows === 1 ? "row" : "rows"} · {bottles} {bottles === 1 ? "bottle" : "bottles"} · {group.locations.length} source {group.locations.length === 1 ? "location" : "locations"}</p></div></header>
    <fieldset disabled={disabled}>
      <legend>Destination cellar</legend>
      <div className="import-storage-group__fields">
        <label><span>Use or create a cellar</span><select aria-label="Destination cellar" value={choices.cellar.kind === "existing" ? choices.cellar.id : ""} onChange={(event) => {
          const cellar: StorageTarget = event.target.value ? { kind: "existing", id: event.target.value } : { kind: "new", name: group.sourceCellar }
          change(initialStorageChoices(group, snapshot, householdId, cellar))
        }}><option value="">Create a new cellar</option>{cellars.map((cellar) => <option key={cellar.id} value={cellar.id}>{cellar.name}</option>)}</select></label>
        {choices.cellar.kind === "new" ? <label><span>New cellar name</span><input required aria-label="New cellar name" value={choices.cellar.name} onChange={(event) => change({ ...choices, cellar: { kind: "new", name: event.target.value } })} /></label> : null}
      </div>
      <div className="import-storage-group__locations">
        {group.locations.map((source) => {
          const target = choices.locations[source.key] ?? { kind: "new", name: source.sourceLocation || "General" }
          const setTarget = (target: StorageTarget) => change({ ...choices, locations: { ...choices.locations, [source.key]: target } })
          return <div className="import-storage-group__location" key={source.key}>
            <div><strong>{source.sourceLocation || "No location in the file"}</strong><small>{source.records.length} {source.records.length === 1 ? "row" : "rows"} · {source.bottles} bottles</small></div>
            <div className="import-storage-group__fields">
              <label><span>Destination location</span><select aria-label={`Destination for ${source.sourceLocation || "missing location"}`} value={target.kind === "existing" ? target.id : ""} onChange={(event) => setTarget(event.target.value ? { kind: "existing", id: event.target.value } : { kind: "new", name: source.sourceLocation || "General" })}>
                <option value="">Create a new location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}
              </select></label>
              {target.kind === "new" ? <label><span>New location name</span><input required aria-label={`New location for ${source.sourceLocation || "missing location"}`} value={target.name} onChange={(event) => setTarget({ kind: "new", name: event.target.value })} /></label> : null}
            </div>
          </div>
        })}
      </div>
      <label className="import-storage-group__confirm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed these destinations. Create any missing storage and assign only these {rows} {rows === 1 ? "row" : "rows"}.</span></label>
      <button type="submit" disabled={!reviewed}>Confirm storage for {group.sourceCellar || "these rows"}</button>
    </fieldset>
  </form>
}

export function ImportStorageGroups({ results, snapshot, householdId, disabled, isOnline, onBusy, onAssign }: {
  results: CsvStorageReconciliationResult[]; snapshot: ImportStorageSnapshot; householdId: string
  disabled: boolean; isOnline: boolean; onBusy: (busy: boolean) => void; onAssign: (assignments: Record<number, string>) => void
}) {
  const groups = useMemo(() => groupImportStorage(results), [results])
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
    onBusy(true); setError(null); setMessage("Saving cellar setup… No bottles are being imported.")
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
    <header><h3>Set up storage from your file</h3><p>Review one cellar at a time. Create missing cellars and locations here, or map them to existing storage. Missing locations start with an editable “General” suggestion.</p>
      <p>Confirmed setup is saved immediately and remains if you cancel the import. Bottles are added only at final confirmation. A matching active name is reused on retry; archived storage is never restored.</p></header>
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
    {!isOnline ? <Notice>Reconnect to confirm storage. Your review can wait here.</Notice> : null}
    {groups.length ? <>
      <label><span>Find a source cellar or location</span><input type="search" value={search} disabled={disabled} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /></label>
      <p>{groups.length} cellar {groups.length === 1 ? "group needs" : "groups need"} storage · Showing {filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}. Search does not change which rows will be imported.</p>
      {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((group) => <StorageGroup key={JSON.stringify(group)} group={group} snapshot={snapshot} householdId={householdId} disabled={disabled || !isOnline} onSave={save} />)}
      <div className="import-storage-groups__paging"><button type="button" disabled={disabled || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous cellars</button><button type="button" disabled={disabled || (currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next cellars</button></div>
    </> : <p>No grouped storage decisions remain. Catalog-only rows need no destination.</p>}
  </div>
}
