import { useEffect, useRef, useState } from "react"
import { getHouseholdMembers, householdMemberLabel, type HouseholdMember } from "../data/householdMembers"
import { getOwnHouseholdAccess, leaveHousehold, transferHouseholdOwnership, type OwnHouseholdAccess } from "../data/householdLifecycle"
import { Notice } from "./Notice"
import { useLanguage } from "../i18n/useLanguage"

interface Props {
  householdId: string
  householdName: string
  self: HouseholdMember
  members: HouseholdMember[]
  disabled: boolean
  onAccessChanged: (access: OwnHouseholdAccess) => void
}

type Action = { kind: "leave" } | { kind: "transfer"; successor: HouseholdMember }

export function HouseholdLifecycle({ householdId, householdName, self, members, disabled, onAccessChanged }: Props) {
  const { t } = useLanguage()
  const [successorId, setSuccessorId] = useState("")
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const active = useRef(false)
  const inFlight = useRef(false)
  const confirmation = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const restoreFocus = useRef(false)
  const others = members.filter((member) => member.userId !== self.userId)
  const canLeave = self.role !== "owner" || others.some((member) => member.role === "owner")

  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    if (action) confirmation.current?.focus()
    else if (restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus() }
  }, [action])

  function cancel() { restoreFocus.current = true; setAction(null) }
  function select(next: Action, button: HTMLButtonElement) {
    trigger.current = button
    setMessage(null)
    setAction(next)
  }

  async function reconcile() {
    const access = await getOwnHouseholdAccess(householdId, self.userId)
    if (!active.current) return
    // A null live membership still restricts the exact membership just left,
    // not a later invitation's new membership ID.
    onAccessChanged({ ...access, membershipId: access.membershipId ?? self.id })
    setUncertain(false)
    setMessage(access.role === null ? `You no longer have access to ${householdName}.` : `Your current access is ${access.role === "owner" ? "Owner" : "Member"}. Review the refreshed member list before another change.`)
  }

  async function checkAccess() {
    if (inFlight.current || disabled) return
    inFlight.current = true; setBusy(true)
    try { await reconcile() } catch { if (active.current) setMessage(t("Your access could not be checked. Reconnect and check again; do not repeat the transfer or departure yet.")) }
    finally { inFlight.current = false; if (active.current) { setBusy(false); heading.current?.focus() } }
  }

  async function confirm() {
    if (!action || disabled || inFlight.current || uncertain) return
    const selected = action
    inFlight.current = true; setBusy(true); setAction(null); setMessage(null)
    let submitted = false
    try {
      const fresh = await getHouseholdMembers(householdId)
      if (!active.current) return
      const actor = fresh.find((member) => member.isCurrentUser && member.id === self.id && member.userId === self.userId)
      const successor = selected.kind === "transfer" ? fresh.find((member) => member.id === selected.successor.id) : null
      if (!actor || actor.role !== self.role || (selected.kind === "transfer" && (
        actor.role !== "owner" || !successor || successor.userId !== selected.successor.userId || successor.role !== selected.successor.role
      )) || (selected.kind === "leave" && actor.role === "owner" && !fresh.some((member) => member.id !== actor.id && member.role === "owner"))) {
        setMessage(t("Access changed while you were reviewing. Nothing was submitted. Use Refresh members and review again."))
        return
      }
      submitted = true
      const result = selected.kind === "transfer"
        ? await transferHouseholdOwnership(householdId, actor, successor!)
        : await leaveHousehold(householdId, actor)
      if (!active.current) return
      onAccessChanged(result)
      setMessage(selected.kind === "transfer" ? "Ownership transferred. You now have read-only Member access; your private notes are preserved."
        : `You left ${householdName}. Your account and the shared cellar are unchanged.`)
    } catch (error) {
      if (!active.current) return
      setMessage(`${submitted ? "The change could not be confirmed. It may have completed." : "Nothing was submitted."} ${error instanceof Error ? error.message : "Connection failed."}`)
      if (submitted) {
        setUncertain(true)
        try { await reconcile() } catch { /* Keep explicit read-only recovery, never retry the mutation. */ }
      }
    } finally {
      inFlight.current = false
      if (active.current) { setBusy(false); heading.current?.focus() }
    }
  }

  return <section className="household-lifecycle" aria-labelledby="household-lifecycle-heading">
    <h2 id="household-lifecycle-heading" ref={heading} tabIndex={-1}>{t("Your access")}</h2>
    <p>{t("Change your own relationship with")}{t(" ")}{householdName}{t(". These actions never delete the shared cellar or your account.")}</p>
    {message ? <Notice role="status" tone="warning">{message}</Notice> : null}
    {busy ? <p role="status">{t("Checking your household access…")}</p> : null}
    {uncertain ? <button type="button" disabled={disabled || busy} onClick={() => void checkAccess()}>{t("Check my current access")}</button> : null}
    {!uncertain ? <div className="household-lifecycle__choices" hidden={action !== null}>
      {self.role === "owner" ? <div>
        <h3>{t("Transfer ownership")}</h3>
        <p>{t("Hand management to another collaborator and stay as a read-only Member. Your private notes and preferences stay with you. Other Owners remain Owners.")}</p>
        {others.length ? <>
          <label htmlFor="ownership-successor">{t("New Owner")}</label>
          <select id="ownership-successor" value={successorId} disabled={disabled || busy} onChange={(event) => setSuccessorId(event.target.value)}>
            <option value="">{t("Choose a collaborator")}</option>
            {others.map((member) => <option key={member.id} value={member.id}>{householdMemberLabel(member)} · {member.role === "owner" ? "Owner" : "Member"}</option>)}
          </select>
          <button type="button" disabled={disabled || busy || !others.some((member) => member.id === successorId)} onClick={(event) => {
            const successor = others.find((member) => member.id === successorId)
            if (successor) select({ kind: "transfer", successor }, event.currentTarget)
          }}>{t("Review ownership transfer")}</button>
        </> : <p>{t("Invite someone first. They must accept and appear in the member list before you can transfer ownership.")}</p>}
      </div> : null}
      <div>
        <h3>{t("Leave household")}</h3>
        <p>{t("Give up access to this household. Rejoining requires a new invitation.")}</p>
        {!canLeave ? <p>{t("You are the only Owner. Transfer ownership before leaving.")}</p> : null}
        <button type="button" disabled={disabled || busy || !canLeave} onClick={(event) => select({ kind: "leave" }, event.currentTarget)}>{t("Review leaving household")}</button>
      </div>
    </div> : null}
    {action ? <div className="household-members__confirmation" ref={confirmation} tabIndex={-1} role="region" aria-label={t("Confirm your access change")}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel() } }}>
      <h3>{action.kind === "transfer" ? `Transfer ownership to ${householdMemberLabel(action.successor)}?` : `Leave ${householdName}?`}</h3>
      {action.kind === "transfer" ? <>
        {action.successor.displayName && action.successor.email ? <p>{action.successor.email}</p> : null}
        <p>{t("They will manage stock, cellar settings and access—including yours.")}{t(" ")}<strong>{t("You will lose Owner controls and stay as a read-only Member.")}</strong>{t(" ")}{t("Only another Owner can restore your Owner role.")}</p>
        <p>{t("Your private notes and preferences are preserved. Leaving afterward is a separate decision.")}</p>
      </> : <>
        <p><strong>{t("Your private notes and preferences for this household will be deleted.")}</strong>{t(" ")}{t("Your registered devices will be revoked, and you will lose access immediately.")}</p>
        <p>{t("Shared notes, stock and attributed history remain. Your account and other households are unchanged. A new invitation is required to return.")}</p>
        <p>{t("Data already synchronized to an offline device may remain there until it reconnects; this is not a remote wipe.")}</p>
      </>}
      <p>{t("Sync any wanted stock changes on all your devices first. Still-queued requests may become blocked; they are never transferred to another user. You can review them in Activity.")}</p>
      <div className="household-members__actions">
        <button type="button" onClick={cancel}>{t("Cancel")}</button>
        <button type="button" onClick={() => void confirm()} disabled={disabled || busy}>{action.kind === "transfer" ? "Confirm: transfer ownership" : "Confirm: leave household"}</button>
      </div>
    </div> : null}
  </section>
}
