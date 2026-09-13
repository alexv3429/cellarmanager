import { useQuery } from "@powersync/react"
import { useEffect, useRef, useState } from "react"
import { INVENTORY_REQUEST_FIELDS, getStoppedInventoryUploads, stopInventoryUpload, type QueuedInventoryRequest, type StoppedInventoryUpload } from "../data/inventoryRecovery"
import { rememberInventoryUploadReceipt } from "../data/powersync/inventoryUploadReceipts"
import { Notice } from "./Notice"

interface Props { userId: string; householdId: string | null; isOnline: boolean; onlyWhenQueued?: boolean }
export const QUEUE_QUERY = `
  select o.id, o.household_id, o.user_id, o.device_id, o.operation_type, o.wine_id,
    o.source_location_id, o.destination_location_id, o.quantity, o.remove_reason, o.created_at_client,
    o.wine_producer, o.wine_cuvee, o.wine_vintage, o.wine_color, o.wine_appellation, o.wine_area, o.wine_format_ml,
    coalesce(w.producer, o.wine_producer, 'Unknown producer') || ' — ' || coalesce(w.cuvee, o.wine_cuvee, 'Unknown wine') as wine_label,
    h.name as household_label, d.name as device_label,
    sc.name || ' / ' || s.code as source_label, dc.name || ' / ' || dest.code as destination_label
  from inventory_operations o
  left join wines w on w.id = o.wine_id
  left join households h on h.id = o.household_id
  left join devices d on d.id = o.device_id
  left join locations s on s.id = o.source_location_id left join cellars sc on sc.id = s.cellar_id
  left join locations dest on dest.id = o.destination_location_id left join cellars dc on dc.id = dest.cellar_id
  where o.user_id = ? and o.status = 'PENDING'
    and not exists (select 1 from inventory_upload_receipts r where r.id = o.id and r.user_id = o.user_id
      and r.household_id = o.household_id and r.device_id = o.device_id and r.status in ('ACCEPTED','REJECTED','STOPPED')
      and case when json_valid(r.request) then json_extract(r.request, '$.id') = o.id
        and ${INVENTORY_REQUEST_FIELDS.map((field) => `json_extract(r.request, '$.${field}') is o.${field}`).join(" and ")}
        else 0 end)
  order by o.created_at_client, o.id limit 100
`
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error) }
function requestAction(request: QueuedInventoryRequest) {
  const action = request.operation_type === "ADD" ? "Add" : request.operation_type === "MOVE" ? "Move" : "Remove"
  return `${action} ${request.quantity} ${request.quantity === 1 ? "bottle" : "bottles"}`
}
function locations(request: QueuedInventoryRequest) {
  return [request.source_label ? `From ${request.source_label}` : null,
    request.destination_label ? `To ${request.destination_label}` : null].filter(Boolean).join(" · ")
}

export function InventoryQueueReview(props: Props) {
  return <QueueWorkspace key={`${props.userId}:${props.householdId}:${props.isOnline}`} {...props} />
}
function QueueWorkspace({ userId, householdId, isOnline, onlyWhenQueued = false }: Props) {
  const { data: rows, error, isLoading } = useQuery<QueuedInventoryRequest>(QUEUE_QUERY, [userId])
  const [selected, setSelected] = useState<QueuedInventoryRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [reviewedIds, setReviewedIds] = useState<string[]>([])
  const [history, setHistory] = useState<StoppedInventoryUpload[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; tone: "success" | "warning" | "error" } | null>(null)
  const active = useRef(true)
  const historyGeneration = useRef(0)
  const busyRef = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const visible = rows.filter((row) => row.user_id === userId && !reviewedIds.includes(row.id))
  const latestRows = useRef(rows)
  latestRows.current = rows

  async function refreshHistory() {
    if (!isOnline) return
    const generation = ++historyGeneration.current
    setHistoryError(null)
    try {
      const result = await getStoppedInventoryUploads(householdId, userId)
      if (active.current && generation === historyGeneration.current) setHistory(result)
    } catch (caught) { if (active.current && generation === historyGeneration.current) setHistoryError(`Stopped-request history is unavailable. ${errorText(caught)}`) }
  }
  useEffect(() => {
    active.current = true
    void refreshHistory()
    return () => { active.current = false }
    // Identity and connectivity are fixed by the keyed workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (selected) panel.current?.focus() }, [selected])
  function cancel() { setSelected(null); trigger.current?.focus() }
  async function confirm() {
    if (!selected || !isOnline || error || busyRef.current || !active.current) return
    const target = selected
    const current = latestRows.current.find((row) => row.id === target.id && row.user_id === userId)
    if (!current || JSON.stringify(current) !== JSON.stringify(target)) {
      setSelected(null); setMessage({ tone: "warning", text: "This request changed or already synchronized. Review the updated queue; nothing was submitted." }); return
    }
    busyRef.current = true; setBusy(true); setMessage(null)
    try {
      const receipt = await stopInventoryUpload(target, userId)
      if (!active.current) return
      await rememberInventoryUploadReceipt(receipt, target)
      if (!active.current) return
      setReviewedIds((ids) => [...ids, target.id]); setSelected(null)
      setMessage({ tone: receipt.status === "ACCEPTED" ? "warning" : "success", text:
        receipt.status === "STOPPED" ? "Request stopped before acceptance. It will not change stock, and its private record is kept. The upload queue can continue automatically."
          : receipt.status === "ACCEPTED" ? "The server had already accepted this request. Nothing was undone or applied again. Wait for stock to finish synchronizing before making another change."
            : "The server had already rejected this request. Its original rejection stays in Activity; the upload queue can continue automatically." })
      heading.current?.focus()
      await refreshHistory()
    } catch (caught) {
      if (active.current) {
        setSelected(null)
        setMessage({ tone: "error", text: `The result could not be confirmed locally. ${errorText(caught)} The queue was not acknowledged here. Refresh stopped-request history and review the same request again; this will check the same ID, never create a replacement.` })
      }
    } finally { if (active.current) { busyRef.current = false; setBusy(false) } }
  }
  if (onlyWhenQueued && !error && !isLoading && visible.length === 0 && !message) return null
  return <section className={`inventory-queue-review${onlyWhenQueued ? " standalone-page" : ""}`} aria-labelledby="queue-review-heading">
    <div className="inventory-queue-review__heading"><div>
      <h2 id="queue-review-heading" tabIndex={-1} ref={heading}>Queued on this browser</h2>
      <p>Your requests across all households, oldest first. A blocked request can hold up later uploads.</p>
    </div><span className="activity-status activity-status--warning">{visible.length}{visible.length === 100 ? "+" : ""} queued</span></div>
    <p>Temporary connection failures retry automatically. If access changed or a request is no longer needed, review it below. Stopping is online-only and never undoes accepted stock changes.</p>
    {error ? <Notice tone="error" role="alert">Unable to read this browser’s queue: {String(error)}</Notice> : null}
    {isLoading ? <p role="status">Loading queued requests…</p> : null}
    {message ? <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice> : null}
    {!isOnline ? <Notice tone="warning">Reconnect before stopping a request. The server must first check whether it was already accepted.</Notice> : null}
    {!isLoading && !error && visible.length === 0 ? <p>No unreviewed requests are queued on this browser.</p> : null}
    <ol className="inventory-queue-review__list">{visible.map((request) => <li key={request.id}>
      <div><h3>{request.wine_label ?? "Wine request"}</h3><p><strong>{requestAction(request)}</strong> · {locations(request)}</p>
        <p>{request.household_label ?? "Previous household"}{request.household_id !== householdId ? " · Another household" : ""} · {request.device_label ?? "Original registration"}</p>
        <small>Requested {new Date(request.created_at_client).toLocaleString()} · ID {request.id.slice(0, 8)}</small></div>
      <button type="button" disabled={!isOnline || busy || !!error} aria-label={`Review queued request: ${request.wine_label ?? request.id}`}
        onClick={(event) => { trigger.current = event.currentTarget; setSelected(request); setMessage(null) }}>Review request</button>
      {selected?.id === request.id ? <div className="inventory-queue-review__confirmation" role="region" aria-label="Stop queued request" tabIndex={-1} ref={panel}
        onKeyDown={(event) => { if (event.key === "Escape" && !busy) cancel() }}>
        <h3>Stop this request?</h3>
        <p>{requestAction(request)} · {request.wine_label} · {locations(request)}</p>
        <p>The server checks this exact ID first. If already accepted, its stock change is kept. Otherwise it is stopped permanently. The original request is retained privately; nothing is moved to another user or device.</p>
        <div className="inventory-recovery-actions"><button type="button" disabled={busy} onClick={cancel}>Keep queued</button>
          <button type="button" disabled={!isOnline || busy} onClick={() => void confirm()}>{busy ? "Checking server…" : "Confirm: stop this request"}</button></div>
      </div> : null}
    </li>)}</ol>
    <details className="inventory-queue-review__history"><summary>Show my stopped requests{householdId ? " for this household" : ""}</summary>
      <p>Private history of requests stopped before acceptance. Already accepted or rejected requests remain in the inventory journal.</p>
      <button type="button" disabled={!isOnline || busy} onClick={() => void refreshHistory()}>Refresh stopped-request history</button>
      {!isOnline ? <p>Reconnect to load the server’s private history.</p> : historyError ? <Notice tone="warning">{historyError}</Notice> : <>
        {history.length === 0 ? <p>No stopped requests found.</p> : <ul>{history.map((item) => <li key={item.operation_id}>
          <strong>{item.request.wine_label ?? "Wine request"}</strong> — {requestAction(item.request)} · Stopped {new Date(item.stopped_at).toLocaleString()}
          <small>Request ID: {item.operation_id}</small>
        </li>)}</ul>}
      </>}
    </details>
  </section>
}
