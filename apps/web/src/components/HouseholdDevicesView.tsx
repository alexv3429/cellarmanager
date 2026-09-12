import { useEffect, useRef, useState } from "react"
import { getHouseholdDevices, manageHouseholdDevice, type DeviceDirectory, type HouseholdDevice } from "../data/householdDevices"
import type { HouseholdRole } from "../households/householdPermissions"
import { Notice } from "./Notice"

interface Props {
  householdId: string
  householdName: string
  userId: string
  role: HouseholdRole
  isOnline: boolean
  currentDeviceId: string | null
  onRevoked: (deviceId: string) => void
}
type Action = { device: HouseholdDevice; kind: "rename" | "revoke" }
type Message = { text: string; tone: "success" | "error" | "warning" }
function errorText(error: unknown) { return error instanceof Error ? error.message : "Unable to reach the server." }
function timestamp(value: string | null) { return value ? new Date(value).toLocaleString() : "Not recorded" }

export function HouseholdDevicesView(props: Props) {
  return <DevicesWorkspace key={`${props.householdId}:${props.userId}:${props.role}:${props.isOnline}`} {...props} />
}

function DevicesWorkspace({ householdId, householdName, userId, role, isOnline, currentDeviceId, onRevoked }: Props) {
  const [directory, setDirectory] = useState<DeviceDirectory | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [name, setName] = useState("")
  const [message, setMessage] = useState<Message | null>(null)
  const generation = useRef(0)
  const busyRef = useRef(false)
  const confirmation = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const revokedCallback = useRef(onRevoked)
  revokedCallback.current = onRevoked

  function canManage(device: HouseholdDevice, data = directory) {
    return isOnline && !!data && !device.revokedAt &&
      (device.userId === userId || (role === "owner" && data.role === "owner"))
  }
  function acceptDirectory(data: DeviceDirectory) {
    setDirectory(data)
    for (const device of data.devices) if (device.revokedAt) revokedCallback.current(device.id)
  }
  async function refresh() {
    if (!isOnline || busyRef.current) return
    const ticket = ++generation.current
    setLoading(true); setDirectory(null); setAction(null); setMessage(null)
    try {
      const data = await getHouseholdDevices(householdId, userId)
      if (ticket === generation.current) acceptDirectory(data)
    } catch (error) {
      if (ticket === generation.current) setMessage({ tone: "error", text: `Unable to load devices. ${errorText(error)} Use Refresh devices to try again.` })
    } finally { if (ticket === generation.current) setLoading(false) }
  }
  useEffect(() => {
    void refresh()
    return invalidateRequests
    // The keyed workspace has fixed identity, household, role and connectivity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function invalidateRequests() { generation.current++ }
  useEffect(() => { if (action) confirmation.current?.focus() }, [action])
  useEffect(() => {
    if (!busy && restoreFocus.current) { restoreFocus.current = false; refreshButton.current?.focus() }
  }, [busy])
  function cancel() { setAction(null); trigger.current?.focus() }

  async function submit() {
    if (!action || !canManage(action.device) || busyRef.current) return
    const selected = action
    const ticket = ++generation.current
    busyRef.current = true; setBusy(true); setAction(null); setMessage(null)
    try {
      const fresh = await getHouseholdDevices(householdId, userId)
      if (ticket !== generation.current) return
      acceptDirectory(fresh)
      const target = fresh.devices.find((device) => device.id === selected.device.id)
      if (!target || !canManage(target, fresh) || target.userId !== selected.device.userId || target.name !== selected.device.name) {
        setMessage({ tone: "warning", text: "The device or your access changed. Nothing was submitted; review the refreshed list." })
        return
      }
      await manageHouseholdDevice(householdId, target.id, selected.kind, selected.kind === "rename" ? name : null)
      if (ticket !== generation.current) return
      if (selected.kind === "revoke") revokedCallback.current(target.id)
      setMessage({ tone: "success", text: selected.kind === "revoke"
        ? `${target.name} registration revoked. Stock and accepted history are unchanged.` : `Device renamed to ${name.trim()}.` })
    } catch (error) {
      if (ticket === generation.current) setMessage({ tone: "error", text: `The change could not be confirmed. ${errorText(error)} Check the refreshed list before trying again.` })
    } finally {
      if (ticket === generation.current) {
        setDirectory(null); setLoading(true)
        try {
          const fresh = await getHouseholdDevices(householdId, userId)
          if (ticket === generation.current) acceptDirectory(fresh)
        } catch (error) {
          if (ticket === generation.current) setMessage((previous) => ({ tone: "warning", text: `${previous?.text ?? ""} The list could not be refreshed. ${errorText(error)} Use Refresh devices before further changes.` }))
        }
        if (ticket === generation.current) {
          busyRef.current = false; restoreFocus.current = true; setBusy(false); setLoading(false)
        }
      }
    }
  }

  function deviceCard(device: HouseholdDevice) {
    const current = device.id === currentDeviceId && device.userId === userId
    return <li key={device.id}>
      <div className="household-devices__identity">
        <h3>{device.name}</h3>
        <div className="household-devices__badges">
          {current ? <span>This browser</span> : null}
          <span>{device.revokedAt ? "Revoked" : "Active registration"}</span>
        </div>
        <p>{device.accountLabel}{device.userId === userId ? " · You" : ""}</p>
        <dl>
          <div><dt>Registered</dt><dd>{timestamp(device.createdAt)}</dd></div>
          <div><dt>Last registration contact</dt><dd>{timestamp(device.lastSeenAt)}</dd></div>
          {device.revokedAt ? <div><dt>Revoked</dt><dd>{timestamp(device.revokedAt)}</dd></div> : null}
        </dl>
        <small>Registration ID: {device.id}</small>
      </div>
      {canManage(device) ? <div className="household-devices__actions">
        {(["rename", "revoke"] as const).map((kind) => <button key={kind} type="button" disabled={busy}
          aria-label={`${kind === "rename" ? "Rename" : "Revoke"}: ${device.name}`}
          onClick={(event) => { trigger.current = event.currentTarget; setAction({ device, kind }); setName(device.name); setMessage(null) }}>
          {kind === "rename" ? "Rename" : "Revoke registration"}
        </button>)}
      </div> : null}
      {action?.device.id === device.id && canManage(device) ? <div className="household-devices__confirmation" role="region"
        aria-label={action.kind === "rename" ? "Rename device" : "Confirm revocation"} ref={confirmation} tabIndex={-1}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel() } }}>
        <h3>{action.kind === "rename" ? "Name this registration" : `Revoke ${device.name}?`}</h3>
        {action.kind === "rename" ? <label>Device name<input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label> : <>
          {current ? <Notice role="status" tone="warning">This is your current browser. You will lose bottle-change actions here for this household.</Notice> : null}
          <p>New uploads using this registration will be refused, including bottle changes still queued offline. Unsent changes stay on that browser for review; they are not moved to a new registration.</p>
          <p>This cannot be undone. It does not sign anyone out, remove household membership, or erase downloaded data. A signed-in member can register another browser. To remove someone’s access, use Members instead.</p>
        </>}
        <div className="household-devices__actions">
          <button type="button" onClick={cancel}>Cancel</button>
          <button type="button" disabled={busy || (action.kind === "rename" && !name.trim())} onClick={() => void submit()}>
            {action.kind === "rename" ? "Save device name" : "Confirm: revoke registration"}
          </button>
        </div>
      </div> : null}
    </li>
  }
  const active = directory?.devices.filter((device) => !device.revokedAt) ?? []
  const revoked = directory?.devices.filter((device) => device.revokedAt) ?? []
  return <main className="household-devices">
    <header className="household-devices__heading"><div><h1>Devices</h1><p>Browser registrations for {householdName}.</p></div>
      <button type="button" ref={refreshButton} disabled={!isOnline || loading || busy} onClick={() => void refresh()}>Refresh devices</button>
    </header>
    <p>Each browser has a separate registration for each household. Owners can manage all registrations; Members can manage only their own.</p>
    <Notice tone="info">These are not login sessions. Revocation stops stock uploads from that registration, not account access or offline reading. “Last registration contact” is not live activity or a last-sign-in time.</Notice>
    {!isOnline ? <Notice role="status" tone="warning">Reconnect to view or manage devices. Device changes are never queued offline.</Notice> : <>
      {message ? <Notice role={message.tone === "error" ? "alert" : "status"} tone={message.tone}>{message.text}</Notice> : null}
      {busy || loading ? <p role="status">{busy ? "Checking and updating registration…" : "Loading current devices…"}</p> : null}
      {directory ? <>
        <h2>{active.length} active {active.length === 1 ? "registration" : "registrations"}</h2>
        {active.length === 0 ? <p>No active registrations are visible for this household.</p> : <ul className="household-devices__list">{active.map(deviceCard)}</ul>}
        {revoked.length > 0 ? <details className="household-devices__history"><summary>Show revoked registrations ({revoked.length})</summary>
          <p>Kept to preserve inventory history. Revoked registrations cannot be reactivated.</p>
          <ul className="household-devices__list">{revoked.map(deviceCard)}</ul>
        </details> : null}
      </> : null}
    </>}
  </main>
}
