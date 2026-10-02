import { type FormEvent, useEffect, useState } from "react"

import {
  listWineAcquisitions,
  listLegacyHoldingPrices,
  prepareWineAcquisition,
  saveWineAcquisition,
  voidWineAcquisition,
  type AcquisitionKind,
  type WineAcquisition,
  type LegacyHoldingPrice,
  type WineAcquisitionDraft,
} from "../data/wineAcquisitions"
import { formatLocalizedNumber, localeForLanguage } from "../i18n/formatting"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface WineAcquisitionsPanelProps {
  householdId: string
  wineId: string
  isOnline: boolean
}

const EMPTY_DRAFT: WineAcquisitionDraft = {
  kind: "PURCHASE", quantity: "1", acquiredOn: "", unitPrice: "", currency: "EUR", sourceName: "", note: "",
}

function displayDate(value: string | null, language: "en" | "fr", unknown: string): string {
  if (!value) return unknown
  return new Intl.DateTimeFormat(localeForLanguage(language), {
    dateStyle: "medium", timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

export function WineAcquisitionsPanel({ householdId, wineId, isOnline }: WineAcquisitionsPanelProps) {
  const { language, t } = useLanguage()
  const [records, setRecords] = useState<WineAcquisition[]>([])
  const [legacyPrices, setLegacyPrices] = useState<LegacyHoldingPrice[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newId, setNewId] = useState(() => crypto.randomUUID())
  const [draft, setDraft] = useState<WineAcquisitionDraft>({ ...EMPTY_DRAFT })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    void Promise.all([
      listWineAcquisitions(householdId, wineId),
      listLegacyHoldingPrices(householdId, wineId),
    ]).then(([next, prices]) => {
      if (cancelled) return
      setRecords(next)
      setLegacyPrices(prices)
      setLoadError(null)
      setLoading(false)
    }).catch((error: unknown) => {
      if (cancelled) return
      setLoadError(error instanceof Error ? error.message : t("acquisition.loadError"))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [householdId, isOnline, wineId, t, loadAttempt])

  function startEdit(record: WineAcquisition) {
    setEditingId(record.id)
    setDraft({
      kind: record.acquisition_kind,
      quantity: String(record.quantity),
      acquiredOn: record.acquired_on ?? "",
      unitPrice: record.unit_price_amount === null ? "" : String(record.unit_price_amount),
      currency: record.price_currency ?? "EUR",
      sourceName: record.source_name ?? "",
      note: record.note ?? "",
    })
    setMessage(null)
    setFormError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft({ ...EMPTY_DRAFT })
    setFormError(null)
  }

  async function refresh() {
    const [next, prices] = await Promise.all([
      listWineAcquisitions(householdId, wineId),
      listLegacyHoldingPrices(householdId, wineId),
    ])
    setRecords(next)
    setLegacyPrices(prices)
    setLoadError(null)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline || saving) return
    setFormError(null)
    setMessage(null)
    try {
      const value = prepareWineAcquisition(draft)
      setSaving(true)
      await saveWineAcquisition(editingId ?? newId, wineId, value)
      await refresh()
      setMessage(t(editingId ? "acquisition.updated" : "acquisition.saved"))
      setEditingId(null)
      setNewId(crypto.randomUUID())
      setDraft({ ...EMPTY_DRAFT })
    } catch (error: unknown) {
      setFormError(t(error instanceof Error && error.message.startsWith("acquisition.validation")
        ? error.message : "acquisition.saveError"))
    } finally {
      setSaving(false)
    }
  }

  async function handleVoid(record: WineAcquisition) {
    if (!isOnline || saving || !window.confirm(t("acquisition.confirmRemove"))) return
    setFormError(null)
    setMessage(null)
    setSaving(true)
    try {
      await voidWineAcquisition(record.id)
      await refresh()
      if (editingId === record.id) cancelEdit()
      setMessage(t("acquisition.removed"))
    } catch {
      setFormError(t("acquisition.removeError"))
    } finally {
      setSaving(false)
    }
  }

  const kindLabel = (kind: AcquisitionKind) => t(`acquisition.kind.${kind}`)

  return <section aria-labelledby="wine-acquisitions-title" className="wine-acquisitions">
    <h2 id="wine-acquisitions-title">{t("acquisition.title")}</h2>
    <p>{t("acquisition.intro")}</p>
    {!isOnline ? <Notice tone="info">{t("acquisition.offline")}</Notice> : <>
      {loading ? <p role="status">{t("acquisition.loading")}</p> : null}
      {loadError ? <>
        <Notice role="alert" tone="error">{t("acquisition.loadError")}</Notice>
        <button onClick={() => { setLoading(true); setLoadAttempt((attempt) => attempt + 1) }} type="button">
          {t("acquisition.retry")}
        </button>
      </> : null}
      {!loading && !loadError ? records.length === 0
        ? <p>{t("acquisition.empty")}</p>
        : <ul className="wine-acquisitions__list">{records.map((record) => <li key={record.id}>
          <div className="wine-acquisitions__record-heading">
            <strong>{kindLabel(record.acquisition_kind)} · {formatLocalizedNumber(record.quantity, language)} {t(record.quantity === 1 ? "acquisition.bottle" : "acquisition.bottles")}</strong>
            <time dateTime={record.acquired_on ?? undefined}>{displayDate(record.acquired_on, language, t("acquisition.unknownDate"))}</time>
          </div>
          {record.unit_price_amount !== null && record.price_currency ? <span>{t("acquisition.paidPerBottle", {
            price: formatLocalizedNumber(Number(record.unit_price_amount), language, { style: "currency", currency: record.price_currency }),
          })}</span> : null}
          {record.source_name ? <span>{record.source_name}</span> : null}
          {record.note ? <span>{record.note}</span> : null}
          {record.source_kind === "LEGACY_V01"
            ? <small>{t("acquisition.imported")}</small>
            : <div className="wine-acquisitions__actions">
                <button disabled={saving} onClick={() => startEdit(record)} type="button">{t("acquisition.edit")}</button>
                <button disabled={saving} onClick={() => void handleVoid(record)} type="button">{t("acquisition.remove")}</button>
              </div>}
        </li>)}</ul> : null}
      {!loading && !loadError && legacyPrices.length > 0 ? <div className="wine-acquisitions__legacy">
        <h3>{t("acquisition.legacyPricesTitle")}</h3>
        <p>{t("acquisition.legacyPricesHelp")}</p>
        <ul>{legacyPrices.map((entry) => <li key={entry.source_holding_id}>
          {entry.price_bought === null
            ? t("acquisition.legacyDateOnly")
            : t("acquisition.legacyPrice", { price: formatLocalizedNumber(Number(entry.price_bought), language, {
              minimumFractionDigits: 2, maximumFractionDigits: 2,
            }) })}
          {entry.acquired_on ? ` · ${displayDate(entry.acquired_on, language, t("acquisition.unknownDate"))}` : null}
        </li>)}</ul>
      </div> : null}
      {!loading && !loadError ? <details className="wine-acquisitions__form" open={editingId !== null ? true : undefined}>
        <summary>{t(editingId ? "acquisition.editTitle" : "acquisition.addTitle")}</summary>
        <form onSubmit={(event) => void handleSave(event)}>
          <label>{t("acquisition.kindLabel")}
            <select value={draft.kind} onChange={(event) => setDraft((current) => ({
              ...current, kind: event.target.value as AcquisitionKind,
              unitPrice: event.target.value === "PURCHASE" ? current.unitPrice : "",
            }))}>
              <option value="PURCHASE">{kindLabel("PURCHASE")}</option>
              <option value="GIFT">{kindLabel("GIFT")}</option>
              <option value="OTHER">{kindLabel("OTHER")}</option>
            </select>
          </label>
          <label>{t("acquisition.quantity")}
            <input min="1" max="2147483647" required inputMode="numeric" type="number" value={draft.quantity}
              onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))} />
          </label>
          <label>{t("acquisition.date")}
            <input type="date" value={draft.acquiredOn}
              onChange={(event) => setDraft((current) => ({ ...current, acquiredOn: event.target.value }))} />
          </label>
          {draft.kind === "PURCHASE" ? <div className="wine-acquisitions__price">
            <label>{t("acquisition.price")}
              <input inputMode="decimal" placeholder="12,50" type="text" value={draft.unitPrice}
                onChange={(event) => setDraft((current) => ({ ...current, unitPrice: event.target.value }))} />
            </label>
            <label>{t("acquisition.currency")}
              <input autoCapitalize="characters" maxLength={3} placeholder="EUR" type="text" value={draft.currency}
                onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value }))} />
            </label>
          </div> : null}
          <label>{t("acquisition.source")}
            <input maxLength={200} type="text" value={draft.sourceName}
              onChange={(event) => setDraft((current) => ({ ...current, sourceName: event.target.value }))} />
          </label>
          <label>{t("acquisition.note")}
            <textarea maxLength={500} value={draft.note}
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} />
          </label>
          <p>{t("acquisition.noStockChange")}</p>
          {formError ? <Notice role="alert" tone="error">{formError}</Notice> : null}
          <div className="wine-acquisitions__actions">
            <button disabled={saving} type="submit">{t(saving ? "acquisition.saving" : "acquisition.save")}</button>
            {editingId ? <button disabled={saving} onClick={cancelEdit} type="button">{t("acquisition.cancel")}</button> : null}
          </div>
        </form>
      </details> : null}
      {!editingId && message ? <Notice role="status" tone="success">{message}</Notice> : null}
    </>}
  </section>
}
