import { useEffect, useId, useRef, useState } from "react"
import type { HouseholdOption } from "../households/useActiveHousehold"
import { getHouseholdRoleLabel } from "../households/householdPermissions"

interface HouseholdSwitcherProps {
  activeHouseholdId: string
  households: HouseholdOption[]
  isOnline: boolean
  pendingOperationCount: number
  onSelectHousehold: (householdId: string) => void
}

export function HouseholdSwitcher({ activeHouseholdId, households, isOnline, pendingOperationCount, onSelectHousehold }: HouseholdSwitcherProps) {
  const [targetId, setTargetId] = useState<string | null>(null)
  const id = useId()
  const selector = useRef<HTMLSelectElement>(null)
  const confirmation = useRef<HTMLDivElement>(null)
  const active = households.find((household) => household.id === activeHouseholdId)
  const target = households.find((household) => household.id === targetId && household.id !== activeHouseholdId)
  const confirmationTargetId = target?.id

  useEffect(() => {
    if (confirmationTargetId) confirmation.current?.focus()
  }, [confirmationTargetId])

  if (!active) return null

  function cancel() {
    setTargetId(null)
    selector.current?.focus()
  }

  return (
    <div className="household-switcher">
      <div className="household-switcher__current">
        <span>Current household</span>
        <strong>{active.name}</strong>
        <small>{getHouseholdRoleLabel(active.role)} · {active.role === "owner" ? "Manage this collection" : "Read-only shared cellar"}</small>
      </div>
      {households.length > 1 ? (
        <>
          <label className="household-switcher__select" htmlFor={id}>Switch household</label>
          <select aria-describedby={`${id}-help`} id={id} ref={selector} value={target?.id ?? activeHouseholdId}
            onChange={(event) => setTargetId(event.target.value === activeHouseholdId ? null : event.target.value)}>
            {households.map((household) => (
              <option key={household.id} value={household.id}>
                {household.name} — {getHouseholdRoleLabel(household.role)}
                {households.some((other) => other.id !== household.id && other.name === household.name) ? ` · ${household.id.slice(0, 8)}` : ""}
              </option>
            ))}
          </select>
          <small id={`${id}-help`}>{isOnline ? "Separate shared collections; no sign-out needed." : "Offline: only households already synchronized on this device are available. Access is checked again after reconnecting."}</small>
        </>
      ) : <small>A household is your shared collection, including all its storage cellars.</small>}
      {target ? (
        <div aria-labelledby={`${id}-title`} className="household-switcher__confirmation" ref={confirmation} role="region" tabIndex={-1}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel() } }}>
          <strong id={`${id}-title`}>Switch to {target.name}?</strong>
          <p>{getHouseholdRoleLabel(target.role)} · {target.role === "owner" ? "You can manage this collection." : "You can browse this cellar, but cannot change its wines or stock."}</p>
          <p>Open forms and filters will reset. Save any unfinished edits before switching.</p>
          <p>Saved changes stay with {active.name}. {pendingOperationCount > 0
            ? `${pendingOperationCount} queued ${pendingOperationCount === 1 ? "change stays" : "changes stay"} with that household and will sync when permitted; switching does not cancel them.`
            : "No data is copied between households."}</p>
          <div className="household-switcher__actions">
            <button onClick={cancel} type="button">Stay here</button>
            <button onClick={() => { onSelectHousehold(target.id); setTargetId(null) }} type="button">Switch household</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
