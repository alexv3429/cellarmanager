import { useMemo, useState, type FormEvent } from "react"
import { CSV_IMPORT_FIELD_DEFINITIONS, type CsvColumnMapping } from "../data/csvColumnMapping"
import { createCsvSplitCorrections, groupCsvColumnSplit, suggestCsvColumnSplit, type CsvColumnSplit, type CsvSplitGroup } from "../data/csvColumnSplit"
import type { CsvPreparedRow, CsvRowCorrections } from "../data/csvImportPreparation"

const PAGE_SIZE = 6
const fieldLabel = (field: string) => CSV_IMPORT_FIELD_DEFINITIONS.find((item) => item.field === field)!.label

function SplitGroupForm({ group, split, disabled, onApply }: {
  group: CsvSplitGroup; split: CsvColumnSplit; disabled: boolean
  onApply: (first: string, second: string) => void
}) {
  const suggestion = suggestCsvColumnSplit(group.sourceValue, split.separator)
  const [first, setFirst] = useState(suggestion.first)
  const [second, setSecond] = useState(suggestion.second)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!disabled && first.trim() && second.trim()) onApply(first, second)
  }
  return <form className="import-column-split__group" aria-label={`Split ${group.sourceValue || "empty value"}`} onSubmit={submit}>
    <header>
      <span>Source value</span><strong>{group.sourceValue || "Empty"}</strong>
      {group.context ? <p>{group.context}</p> : null}
      <small>{group.rows.length} {group.rows.length === 1 ? "row" : "rows"} · Source rows: {group.rows.slice(0, 20).map((row) => row.cleaned.recordNumber).join(", ")}{group.rows.length > 20 ? "…" : ""}</small>
    </header>
    <p>{suggestion.suggested ? "Suggested text split only. Check the values and swap them if needed."
      : "No unambiguous split with this separator. Enter the two values yourself."}</p>
    <div className="import-row-editor__fields">
      <label><span>{fieldLabel(split.firstField)}</span><input required disabled={disabled} value={first} onChange={(event) => setFirst(event.target.value)} maxLength={100000} /></label>
      <label><span>{fieldLabel(split.secondField)}</span><input required disabled={disabled} value={second} onChange={(event) => setSecond(event.target.value)} maxLength={100000} /></label>
    </div>
    <div className="import-row-editor__actions">
      <button type="button" disabled={disabled} onClick={() => { setFirst(second); setSecond(first) }}>Swap values</button>
      <button type="submit" disabled={disabled || !first.trim() || !second.trim()}>Apply split to {group.rows.length} {group.rows.length === 1 ? "row" : "rows"}</button>
    </div>
    <small>Only these two fields change. Use Edit row below for individual exceptions.</small>
  </form>
}

export function ImportColumnSplit({ rows, mapping, split, corrections, disabled, onCorrect }: {
  rows: CsvPreparedRow[]; mapping: CsvColumnMapping; split: CsvColumnSplit
  corrections: CsvRowCorrections; disabled: boolean
  onCorrect: (changes: CsvRowCorrections) => void
}) {
  const groups = useMemo(() => groupCsvColumnSplit(rows, mapping, split, corrections), [rows, mapping, split, corrections])
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const filtered = groups.filter((group) => `${group.sourceValue} ${group.context}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1))
  return <section className="import-column-split" aria-label="Review column split">
    <h3>Review column split: {fieldLabel(split.firstField)} + {fieldLabel(split.secondField)}</h3>
    <p>Review each source value before applying it. Separately supplied values, row corrections and excluded rows are preserved. Defaults fill only what remains blank.</p>
    <p role="status">{groups.reduce((sum, group) => sum + group.rows.length, 0)} included rows available to split · {groups.length} groups to review.</p>
    {groups.length ? <>
      <label><span>Find a source value</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /></label>
      <p>{filtered.length} matching groups · Showing {filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)}</p>
      {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((group) => <SplitGroupForm key={group.key} group={group} split={split} disabled={disabled} onApply={(first, second) => {
        if (!disabled) onCorrect(createCsvSplitCorrections(group, mapping, split, corrections, first, second))
      }} />)}
      <div className="import-row-editor__actions">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous split groups</button>
        <button type="button" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next split groups</button>
      </div>
    </> : <p>No eligible rows remain for this split. Review corrected rows below, or choose another source column in step 2.</p>}
  </section>
}
