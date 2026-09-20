import { useMemo, useState, type FormEvent } from "react"
import { createCsvCombinedNameCorrections, groupCsvCombinedNames, suggestCsvNameSplit, type CsvCombinedNameGroup } from "../data/csvCombinedNames"
import type { CsvPreparedRow, CsvRowCorrections } from "../data/csvImportPreparation"

const PAGE_SIZE = 6

function NameGroupForm({ group, disabled, onApply }: {
  group: CsvCombinedNameGroup
  disabled: boolean
  onApply: (producer: string, cuvee: string) => void
}) {
  const suggestion = suggestCsvNameSplit(group.sourceName)
  const [producer, setProducer] = useState(suggestion.producer)
  const [cuvee, setCuvee] = useState(suggestion.cuvee)
  const vintages = [...new Set(group.rows.map((row) => row.cleaned.sourceRow.fields.vintage || "NV"))]
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!disabled && producer.trim() && cuvee.trim()) onApply(producer, cuvee)
  }
  return <form className="import-combined-names__group" aria-label={`Separate ${group.sourceName || "unnamed entry"}`} onSubmit={submit}>
    <header>
      <span>Current Producer field</span>
      <strong>{group.sourceName || "Empty"}</strong>
      <p>{[group.appellation, group.area, group.color].filter(Boolean).join(" · ") || "No supporting wine details"}</p>
      <small>{group.rows.length} {group.rows.length === 1 ? "row" : "rows"} · Vintages: {vintages.slice(0, 10).join(", ")}{vintages.length > 10 ? "…" : ""}</small>
      <small>Source rows: {group.rows.slice(0, 20).map((row) => row.cleaned.recordNumber).join(", ")}{group.rows.length > 20 ? "…" : ""}</small>
    </header>
    <p>{suggestion.suggested
      ? "Suggested text split only. Check which part is the producer; swap them if needed."
      : "There is no clear separator. Enter the producer and wine name yourself; nothing has been guessed."}</p>
    <div className="import-row-editor__fields">
      <label><span>Producer</span><input required disabled={disabled} value={producer} onChange={(event) => setProducer(event.target.value)} maxLength={100000} /></label>
      <label><span>Cuvée / wine name</span><input required disabled={disabled} value={cuvee} onChange={(event) => setCuvee(event.target.value)} maxLength={100000} /></label>
    </div>
    <div className="import-row-editor__actions">
      <button type="button" disabled={disabled} onClick={() => { setProducer(cuvee); setCuvee(producer) }}>Swap producer and cuvée</button>
      <button type="submit" disabled={disabled || !producer.trim() || !cuvee.trim()}>Apply names to {group.rows.length} {group.rows.length === 1 ? "row" : "rows"}</button>
    </div>
    <small>Only the two names change. For an exception, use Edit row below. If no cuvée is known, choose an explicit name such as the appellation.</small>
  </form>
}

export function ImportCombinedNames({ rows, corrections, disabled, onCorrect }: {
  rows: CsvPreparedRow[]
  corrections: CsvRowCorrections
  disabled: boolean
  onCorrect: (changes: CsvRowCorrections) => void
}) {
  const groups = useMemo(() => groupCsvCombinedNames(rows), [rows])
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const pendingRows = groups.reduce((total, group) => total + group.rows.length, 0)
  const filtered = groups.filter((group) => [group.sourceName, group.appellation, group.area, group.color]
    .join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1))
  return <section className="import-combined-names" aria-label="Separate producer and cuvée">
    <h3>Separate producer and cuvée</h3>
    <p>Review each combined name once for rows with the same appellation, area and color. Existing cuvées and excluded rows are never replaced.</p>
    <p role="status">{pendingRows} included {pendingRows === 1 ? "row still needs" : "rows still need"} a cuvée · {groups.length} name {groups.length === 1 ? "group" : "groups"} to review.</p>
    {groups.length ? <>
      <label><span>Find a combined name</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /></label>
      <p>{filtered.length} matching name groups · Showing {filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)}</p>
      {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((group) => <NameGroupForm key={group.key} group={group} disabled={disabled} onApply={(producer, cuvee) => {
        if (disabled) return
        onCorrect(createCsvCombinedNameCorrections(group, corrections, producer, cuvee))
      }} />)}
      <div className="import-row-editor__actions">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous name groups</button>
        <button type="button" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next name groups</button>
      </div>
    </> : <p>No included rows are waiting for a name. Review all corrected rows below.</p>}
  </section>
}
