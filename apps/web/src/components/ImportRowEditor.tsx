import { useMemo, useState, type FormEvent } from "react"
import { CSV_IMPORT_FIELD_DEFINITIONS, type CsvImportField, type CsvImportFieldDefaults } from "../data/csvColumnMapping"
import { isZeroStockRow, type CsvPreparedRow, type CsvRowCorrections } from "../data/csvImportPreparation"
import type { ReactNode } from "react"
import { useLanguage } from "../i18n/useLanguage"

const PAGE_SIZE = 20
const rowCountLabel = (count: number) => `${count} ${count === 1 ? "row" : "rows"}`

function RowCorrectionForm({ row, corrections, onSave, onCancel }: {
  row: CsvPreparedRow
  corrections: CsvImportFieldDefaults
  onSave: (values: CsvImportFieldDefaults) => void
  onCancel: () => void
}) {
  const { t } = useLanguage()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values: CsvImportFieldDefaults = { ...corrections }
    for (const { field } of CSV_IMPORT_FIELD_DEFINITIONS) {
      const value = String(form.get(field) ?? "")
      if (value === (row.cleaned.sourceRow.fields[field] ?? "")) continue
      if (row.defaultsApplied.includes(field) || value !== (row.original.fields[field] ?? "")) values[field] = value
      else delete values[field]
    }
    onSave(values)
  }
  return <form className="import-row-editor__form" onSubmit={submit}>
    <p>{t("These edits apply only to this import. The workbook stays unchanged.")}</p>
    <div className="import-row-editor__fields">
      {CSV_IMPORT_FIELD_DEFINITIONS.map(({ field, label, description }) => <label key={field}>
        <span>{t(label)}</span>
        <input name={field} aria-label={`${t(label)} ${t("for row")} ${row.cleaned.recordNumber}`}
          defaultValue={row.cleaned.sourceRow.fields[field] ?? ""} maxLength={100000} />
        <small>{t(description)}</small>
        <small>{t("Before row edits:")}{t(" ")}{row.original.fields[field] || t("Empty")}</small>
      </label>)}
    </div>
    <div className="import-row-editor__actions">
      <button type="submit">{t("Save row corrections")}</button>
      <button type="button" onClick={onCancel}>{t("Cancel row editing")}</button>
    </div>
  </form>
}

export function ImportRowEditor({ rows, corrections, disabled, splitReview, onCorrect, onExclude, onReset }: {
  rows: CsvPreparedRow[]
  corrections: CsvRowCorrections
  disabled: boolean
  splitReview?: ReactNode
  onCorrect: (changes: CsvRowCorrections) => void
  onExclude: (recordNumbers: number[], excluded: boolean) => void
  onReset: () => void
}) {
  const { t } = useLanguage()
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
    <p role="status">{included.length}{t(" ")}{t("rows included ·")}{t(" ")}{excludedCount}{t(" ")}{t("excluded ·")}{t(" ")}{editedCount}{t(" ")}{t("corrected")}</p>
    <p>{t("Quantity 0 keeps a wine in your catalog without adding bottles. You can optionally exclude those rows, totals or other entries. Nothing is excluded automatically.")}</p>
    <fieldset disabled={disabled}>
      <legend className="visually-hidden">{t("Prepare import rows")}</legend>
      <div className="import-row-editor__actions">
        <button type="button" disabled={!zeroStock.length} onClick={() => {
          setEditing(null)
          onExclude(zeroStock.map((row) => row.cleaned.recordNumber), true)
          setMessage(`Excluded ${rowCountLabel(zeroStock.length)} with zero stock. You can include them again below.`)
        }}>{t("Exclude")}{t(" ")}{zeroStock.length}{t(" ")}{t("zero-stock")}{t(" ")}{zeroStock.length === 1 ? t("row") : t("rows")}</button>
        <button type="button" disabled={!excludedCount} onClick={() => { setEditing(null); onExclude(rows.map((row) => row.cleaned.recordNumber), false) }}>{t("Include all rows again")}</button>
        <button type="button" disabled={!editedCount} onClick={() => { setEditing(null); setMessage(""); onReset() }}>{t("Reset all row corrections")}</button>
      </div>
      {splitReview}
      <details className="import-row-editor__bulk">
        <summary>{t("Replace a value in several rows")}</summary>
        <p>{t("Only included rows with this exact value are changed. Empty values can be filled this way; zero is not treated as empty.")}</p>
        <form onSubmit={replace}>
          <div className="import-row-editor__fields">
            <label><span>{t("Field to correct")}</span><select aria-label={t("Field to correct")} value={bulkField} onChange={(event) => {
              setBulkField(event.target.value as CsvImportField); setOldValue(""); setNewValue("")
            }}>{CSV_IMPORT_FIELD_DEFINITIONS.map(({ field, label }) => <option value={field} key={field}>{t(label)}</option>)}</select></label>
            <label><span>{t("Value to replace")}</span><select aria-label={t("Value to replace")} value={oldValue} onChange={(event) => setOldValue(event.target.value)}>
              {!values.has("") ? <option value="">{t("Choose a value")}</option> : null}
              {[...values].map(([value, count]) => <option value={value} key={value}>{value || t("Empty")} ({rowCountLabel(count)})</option>)}
            </select></label>
            <label><span>{t("Replacement value")}</span><input value={newValue} onChange={(event) => setNewValue(event.target.value)} maxLength={100000} /></label>
          </div>
          <button type="submit" disabled={!bulkMatches.length || oldValue === newValue}>{t("Replace in")}{t(" ")}{rowCountLabel(bulkMatches.length)}</button>
        </form>
      </details>
      {message ? <p role="status">{message}</p> : null}
      <div className="import-row-editor__filters">
        <label><span>{t("Show rows")}</span><select aria-label={t("Show rows")} value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); setEditing(null) }}>
          <option value="issues">{t("Needs correction")}</option><option value="all">{t("All rows")}</option>
          <option value="zero">{t("Zero stock")}</option><option value="excluded">{t("Excluded rows")}</option>
        </select></label>
        <label><span>{t("Find a row")}</span><input type="search" value={search} placeholder={t("Row number, producer, wine or type")} onChange={(event) => { setSearch(event.target.value); setPage(0); setEditing(null) }} /></label>
      </div>
      <p>{filtered.length}{t(" ")}{t("matching rows. Showing")}{t(" ")}{filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)}{t(". Search and filters do not change what will be imported.")}</p>
      <div className="import-row-editor__list">
        {visible.map((row) => {
          const id = row.cleaned.recordNumber
          const fields = row.cleaned.sourceRow.fields
          return <article key={id} className="import-row-editor__row">
            <div className="import-row-editor__heading">
              <div><strong>{t("Row")}{t(" ")}{id} · {fields.producer || "No producer"} — {row.cleaned.fields.cuvee || fields.appellation || "No wine name"}</strong>
                <p>{fields.vintage || "NV"} · {fields.color || "No color/type"}{t(" ")}{t("· Quantity:")}{t(" ")}{fields.quantity || "Empty"}</p>
                <p>{row.excluded ? "Excluded from this import" : row.cleaned.issues.length ? `${row.cleaned.issues.length} ${row.cleaned.issues.length === 1 ? "value needs" : "values need"} correction` : row.cleaned.fields.quantity === 0 ? "Catalog only · no bottles will be added" : "Values valid"}{corrections[id] && Object.keys(corrections[id]).length ? " · Your corrections applied" : ""}</p>
                {row.defaultsApplied.length ? <small>{t("Defaults used:")}{t(" ")}{row.defaultsApplied.map((field) => t(CSV_IMPORT_FIELD_DEFINITIONS.find((item) => item.field === field)!.label)).join(", ")}</small> : null}
              </div>
              <div className="import-row-editor__actions">
                <button type="button" aria-expanded={editing === id} onClick={() => setEditing(editing === id ? null : id)}>{t("Edit row")}{t(" ")}{id}</button>
                <button type="button" onClick={() => { setEditing(null); onExclude([id], !row.excluded) }}>{row.excluded ? `Include row ${id}` : `Exclude row ${id}`}</button>
              </div>
            </div>
            {row.cleaned.issues.length ? <ul>{row.cleaned.issues.map((issue) => <li key={`${issue.code}:${issue.field}`}>{issue.message}{t(" ")}{t("(value:")}{t(" ")}{issue.sourceValue || "Empty"})</li>)}</ul> : null}
            {row.cleaned.changes.length ? <details className="import-row-editor__normalization">
              <summary>{t("Normalized values (")}{row.cleaned.changes.length})</summary>
              <ul>{row.cleaned.changes.map((change) => <li key={change.field}>
                {t(CSV_IMPORT_FIELD_DEFINITIONS.find(({ field }) => field === change.field)?.label ?? "Field")}: {change.sourceValue || t("Empty")} → {change.normalizedValue}
              </li>)}</ul>
            </details> : null}
            {editing === id ? <RowCorrectionForm key={JSON.stringify(row.cleaned.sourceRow.fields)} row={row} corrections={corrections[id] ?? {}} onCancel={() => setEditing(null)} onSave={(value) => { onCorrect({ [id]: value }); setEditing(null); setMessage(`Corrections saved for row ${id}.`) }} /> : null}
          </article>
        })}
      </div>
      <div className="import-row-editor__actions">
        <button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setEditing(null) }}>{t("Previous rows")}</button>
        <button type="button" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => { setPage(currentPage + 1); setEditing(null) }}>{t("Next rows")}</button>
      </div>
    </fieldset>
  </div>
}
