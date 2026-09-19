import { useMemo, useState, type FormEvent } from "react"
import { CSV_IMPORT_FIELD_DEFINITIONS, type CsvImportField, type CsvImportFieldDefaults } from "../data/csvColumnMapping"
import { isZeroStockRow, type CsvPreparedRow, type CsvRowCorrections } from "../data/csvImportPreparation"

const PAGE_SIZE = 20
const rowCountLabel = (count: number) => `${count} ${count === 1 ? "row" : "rows"}`

function RowCorrectionForm({ row, onSave, onCancel }: {
  row: CsvPreparedRow
  onSave: (values: CsvImportFieldDefaults) => void
  onCancel: () => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values: CsvImportFieldDefaults = {}
    for (const { field } of CSV_IMPORT_FIELD_DEFINITIONS) {
      const value = String(form.get(field) ?? "")
      if (value !== (row.original.fields[field] ?? "")) values[field] = value
    }
    onSave(values)
  }
  return <form className="import-row-editor__form" onSubmit={submit}>
    <p>These edits apply only to this import. The workbook stays unchanged.</p>
    <div className="import-row-editor__fields">
      {CSV_IMPORT_FIELD_DEFINITIONS.map(({ field, label, description }) => <label key={field}>
        <span>{label}</span>
        <input name={field} aria-label={`${label} for row ${row.cleaned.recordNumber}`}
          defaultValue={row.cleaned.sourceRow.fields[field] ?? ""} maxLength={100000} />
        <small>{description}</small>
        <small>Before row edits: {row.original.fields[field] || "Empty"}</small>
      </label>)}
    </div>
    <div className="import-row-editor__actions">
      <button type="submit">Save row corrections</button>
      <button type="button" onClick={onCancel}>Cancel row editing</button>
    </div>
  </form>
}

export function ImportRowEditor({ rows, corrections, disabled, onCorrect, onExclude, onReset }: {
  rows: CsvPreparedRow[]
  corrections: CsvRowCorrections
  disabled: boolean
  onCorrect: (changes: CsvRowCorrections) => void
  onExclude: (recordNumbers: number[], excluded: boolean) => void
  onReset: () => void
}) {
  const [filter, setFilter] = useState("issues")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<number | null>(null)
  const [bulkField, setBulkField] = useState<CsvImportField>("vintage")
  const [oldValue, setOldValue] = useState("")
  const [newValue, setNewValue] = useState("")
  const [message, setMessage] = useState("")
  const included = rows.filter((row) => !row.excluded)
  const zeroStock = included.filter(isZeroStockRow)
  const excludedCount = rows.length - included.length
  const editedCount = rows.filter((row) => Object.keys(corrections[row.cleaned.recordNumber] ?? {}).length > 0).length
  const filtered = useMemo(() => rows.filter((row) => {
    const matchesFilter = filter === "all" ||
      (filter === "issues" && !row.excluded && row.cleaned.issues.length > 0) ||
      (filter === "excluded" && row.excluded) ||
      (filter === "zero" && !row.excluded && isZeroStockRow(row))
    const haystack = [row.cleaned.recordNumber, ...Object.values(row.cleaned.sourceRow.fields)].join(" ").toLocaleLowerCase()
    return matchesFilter && haystack.includes(search.toLocaleLowerCase().trim())
  }), [rows, filter, search])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1))
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const values = new Map<string, number>()
  for (const row of included) {
    const value = row.cleaned.sourceRow.fields[bulkField] ?? ""
    values.set(value, (values.get(value) ?? 0) + 1)
  }
  const bulkMatches = included.filter((row) => (row.cleaned.sourceRow.fields[bulkField] ?? "") === oldValue)
  function replace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || !bulkMatches.length || oldValue === newValue) return
    onCorrect(Object.fromEntries(bulkMatches.map((row) => [row.cleaned.recordNumber, {
      ...corrections[row.cleaned.recordNumber], [bulkField]: newValue,
    }])))
    setEditing(null)
    setMessage(`Updated ${rowCountLabel(bulkMatches.length)}. Review the validation below.`)
    setOldValue("")
    setNewValue("")
  }
  return <div className="import-row-editor">
    <p role="status">{included.length} rows included · {excludedCount} excluded · {editedCount} corrected</p>
    <p>Correct values here or exclude historical entries, totals and rows you do not want to import. Nothing is excluded automatically.</p>
    <fieldset disabled={disabled}>
      <legend className="visually-hidden">Prepare import rows</legend>
      <div className="import-row-editor__actions">
        <button type="button" disabled={!zeroStock.length} onClick={() => {
          setEditing(null)
          onExclude(zeroStock.map((row) => row.cleaned.recordNumber), true)
          setMessage(`Excluded ${rowCountLabel(zeroStock.length)} with zero stock. You can include them again below.`)
        }}>Exclude {zeroStock.length} zero-stock {zeroStock.length === 1 ? "row" : "rows"}</button>
        <button type="button" disabled={!excludedCount} onClick={() => { setEditing(null); onExclude(rows.map((row) => row.cleaned.recordNumber), false) }}>Include all rows again</button>
        <button type="button" disabled={!editedCount} onClick={() => { setEditing(null); setMessage(""); onReset() }}>Reset all row corrections</button>
      </div>
      <details className="import-row-editor__bulk">
        <summary>Replace a value in several rows</summary>
        <p>Only included rows with this exact value are changed. Empty values can be filled this way; zero is not treated as empty.</p>
        <form onSubmit={replace}>
          <div className="import-row-editor__fields">
            <label><span>Field to correct</span><select aria-label="Field to correct" value={bulkField} onChange={(event) => {
              setBulkField(event.target.value as CsvImportField); setOldValue(""); setNewValue("")
            }}>{CSV_IMPORT_FIELD_DEFINITIONS.map(({ field, label }) => <option value={field} key={field}>{label}</option>)}</select></label>
            <label><span>Value to replace</span><select aria-label="Value to replace" value={oldValue} onChange={(event) => setOldValue(event.target.value)}>
              {!values.has("") ? <option value="">Choose a value</option> : null}
              {[...values].map(([value, count]) => <option value={value} key={value}>{value || "Empty"} ({rowCountLabel(count)})</option>)}
            </select></label>
            <label><span>Replacement value</span><input value={newValue} onChange={(event) => setNewValue(event.target.value)} maxLength={100000} /></label>
          </div>
          <button type="submit" disabled={!bulkMatches.length || oldValue === newValue}>Replace in {rowCountLabel(bulkMatches.length)}</button>
        </form>
      </details>
      {message ? <p role="status">{message}</p> : null}
      <div className="import-row-editor__filters">
        <label><span>Show rows</span><select aria-label="Show rows" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); setEditing(null) }}>
          <option value="issues">Needs correction</option><option value="all">All rows</option>
          <option value="zero">Zero stock</option><option value="excluded">Excluded rows</option>
        </select></label>
        <label><span>Find a row</span><input type="search" value={search} placeholder="Row number, producer, wine or type" onChange={(event) => { setSearch(event.target.value); setPage(0); setEditing(null) }} /></label>
      </div>
      <p>{filtered.length} matching rows. Showing {filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)}. Search and filters do not change what will be imported.</p>
      <div className="import-row-editor__list">
        {visible.map((row) => {
          const id = row.cleaned.recordNumber
          const fields = row.cleaned.sourceRow.fields
          return <article key={id} className="import-row-editor__row">
            <div className="import-row-editor__heading">
              <div><strong>Row {id} · {fields.producer || "No producer"} — {row.cleaned.fields.cuvee || fields.appellation || "No wine name"}</strong>
                <p>{fields.vintage || "NV"} · {fields.color || "No color/type"} · Quantity: {fields.quantity || "Empty"}</p>
                <p>{row.excluded ? "Excluded from this import" : row.cleaned.issues.length ? `${row.cleaned.issues.length} ${row.cleaned.issues.length === 1 ? "value needs" : "values need"} correction` : "Values valid"}{corrections[id] && Object.keys(corrections[id]).length ? " · Your corrections applied" : ""}</p>
              </div>
              <div className="import-row-editor__actions">
                <button type="button" aria-expanded={editing === id} onClick={() => setEditing(editing === id ? null : id)}>Edit row {id}</button>
                <button type="button" onClick={() => { setEditing(null); onExclude([id], !row.excluded) }}>{row.excluded ? `Include row ${id}` : `Exclude row ${id}`}</button>
              </div>
            </div>
            {row.cleaned.issues.length ? <ul>{row.cleaned.issues.map((issue) => <li key={`${issue.code}:${issue.field}`}>{issue.message} (value: {issue.sourceValue || "Empty"})</li>)}</ul> : null}
            {row.cleaned.changes.length ? <details className="import-row-editor__normalization">
              <summary>Normalized values ({row.cleaned.changes.length})</summary>
              <ul>{row.cleaned.changes.map((change) => <li key={change.field}>
                {CSV_IMPORT_FIELD_DEFINITIONS.find(({ field }) => field === change.field)?.label}: {change.sourceValue || "Empty"} → {change.normalizedValue}
              </li>)}</ul>
            </details> : null}
            {editing === id ? <RowCorrectionForm key={JSON.stringify(row.cleaned.sourceRow.fields)} row={row} onCancel={() => setEditing(null)} onSave={(value) => { onCorrect({ [id]: value }); setEditing(null); setMessage(`Corrections saved for row ${id}.`) }} /> : null}
          </article>
        })}
      </div>
      <div className="import-row-editor__actions">
        <button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setEditing(null) }}>Previous rows</button>
        <button type="button" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => { setPage(currentPage + 1); setEditing(null) }}>Next rows</button>
      </div>
    </fieldset>
  </div>
}
