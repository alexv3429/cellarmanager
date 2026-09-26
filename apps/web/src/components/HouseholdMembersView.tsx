import { useEffect, useRef, useState } from "react"
import {
  getHouseholdMembers,
  householdMemberLabel,
  revokeHouseholdMember,
  updateHouseholdMemberRole,
  type HouseholdMember,
} from "../data/householdMembers"
import { getHouseholdRoleLabel, type HouseholdRole } from "../households/householdPermissions"
import { Notice } from "./Notice"
import { HouseholdLifecycle } from "./HouseholdLifecycle"
import type { OwnHouseholdAccess } from "../data/householdLifecycle"
import { useLanguage } from "../i18n/useLanguage"
import { formatLocalizedDate, formatLocalizedNumber } from "../i18n/formatting"

interface HouseholdMembersViewProps {
  householdId: string
  householdName: string
  userId: string
  role: HouseholdRole
  isOnline: boolean
  onInvite: () => void
  onAccessChanged: (access: OwnHouseholdAccess) => void
}

type MemberAction = { member: HouseholdMember; kind: "owner" | "member" | "remove" }
type Message = { text: string; tone: "success" | "warning" | "error" }

function actionLabel(kind: MemberAction["kind"]): string {
  return kind === "remove" ? "Remove access" : `Make ${getHouseholdRoleLabel(kind)}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The server could not be reached."
}

// Reset private online directory data immediately on household, identity,
// role, or connectivity changes; old requests never populate the new view.
export function HouseholdMembersView(props: HouseholdMembersViewProps) {
  return <MembersWorkspace key={`${props.householdId}:${props.userId}:${props.role}:${props.isOnline}`} {...props} />
}

function MembersWorkspace({ householdId, householdName, userId, role, isOnline, onInvite, onAccessChanged }: HouseholdMembersViewProps) {
  const { language, t } = useLanguage()
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading")
  const [action, setAction] = useState<MemberAction | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const busyRef = useRef(false)
  const confirmation = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const self = members.find((member) => member.isCurrentUser && member.userId === userId)
  const canManage = isOnline && phase === "ready" && role === "owner" && self?.role === "owner"

  function isCurrent(ticket: number) { return generation.current === ticket }
  function invalidateRequests() { generation.current++ }

  async function readMembers(): Promise<HouseholdMember[]> {
    const result = await getHouseholdMembers(householdId)
    if (!result.some((member) => member.isCurrentUser && member.userId === userId)) {
      throw new Error("The account changed. Refresh your session before managing access.")
    }
    return result
  }

  async function refresh() {
    if (!isOnline || busyRef.current) return
    const ticket = ++generation.current
    setAction(null)
    setPhase("loading")
    setMembers([])
    setMessage(null)
    try {
      const result = await readMembers()
      if (!isCurrent(ticket)) return
      setMembers(result)
      setPhase("ready")
    } catch (error) {
      if (!isCurrent(ticket)) return
      setPhase("error")
      setMessage({ tone: "error", text: `Unable to load members. ${errorText(error)} Use Refresh members to try again.` })
    }
  }

  useEffect(() => {
    void refresh()
    return invalidateRequests
    // The keyed workspace keeps these inputs fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (action) confirmation.current?.focus() }, [action])
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      restoreFocus.current = false
      refreshButton.current?.focus()
    }
  }, [busy])

  function cancel() {
    setAction(null)
    trigger.current?.focus()
  }

  async function confirm() {
    if (!action || !canManage || busyRef.current) return
    const selected = action
    const ticket = ++generation.current
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    setAction(null)
    try {
      // Recheck the directory before a destructive action. This catches a
      // changed target or actor; the RPC rechecks authority under its DB lock.
      const fresh = await readMembers()
      if (!isCurrent(ticket)) return
      setMembers(fresh)
      const actor = fresh.find((member) => member.isCurrentUser && member.userId === userId)
      const target = fresh.find((member) => member.id === selected.member.id)
      if (actor?.role !== "owner" || !target || target.userId === userId ||
        target.userId !== selected.member.userId || target.role !== selected.member.role) {
        setMessage({ tone: "warning", text: "Access changed while you were reviewing. Nothing was submitted; review the refreshed member list." })
        return
      }
      if (selected.kind === "remove") await revokeHouseholdMember(householdId, target.id)
      else await updateHouseholdMemberRole(householdId, target.id, selected.kind)
      if (!isCurrent(ticket)) return
      setMessage({ tone: "success", text: selected.kind === "remove"
        ? `Access removed for ${householdMemberLabel(target)}. Their account and your cellar stock remain unchanged.`
        : `${householdMemberLabel(target)} is now ${selected.kind === "owner" ? "an Owner" : "a Member with read-only cellar access"}.` })
    } catch (error) {
      if (!isCurrent(ticket)) return
      // A disconnected response is not proof that a write did not happen.
      // Never retry a write automatically; reconcile by reading current state.
      setMessage({ tone: "error", text: `The change could not be confirmed. ${errorText(error)} Check the refreshed list before trying again.` })
    } finally {
      if (isCurrent(ticket)) {
        setMembers([])
        setPhase("loading")
        try {
          const result = await readMembers()
          if (isCurrent(ticket)) { setMembers(result); setPhase("ready") }
        } catch (error) {
          if (isCurrent(ticket)) {
            setPhase("error")
            setMessage((previous) => ({ tone: "warning", text: `${previous?.text ?? ""} The current list could not be refreshed. ${errorText(error)} Use Refresh members before any further changes.` }))
          }
        }
        if (isCurrent(ticket)) {
          busyRef.current = false
          restoreFocus.current = true
          setBusy(false)
        }
      }
    }
  }

  return (
    <main className="household-members">
      <header className="household-members__heading">
        <div><h1>{t("Household members")}</h1><p>{t("Who has access to")}{t(" ")}{householdName}.</p></div>
        <div className="household-members__actions">
          <button disabled={!isOnline || busy || phase === "loading"} onClick={() => void refresh()} ref={refreshButton} type="button">{t("Refresh members")}</button>
          {canManage ? <button disabled={busy} onClick={onInvite} type="button">{t("Invite member")}</button> : null}
        </div>
      </header>

      <details className="household-members__role-help">
        <summary>{t("What can Owners and Members do?")}</summary>
        <div className="household-members__roles">
        <p><strong>{t("Owner")}</strong><span>{t("Manages wines, stock, cellar setup, and who has access. A household can have several Owners.")}</span></p>
        <p><strong>{t("Member")}</strong><span>{t("Browses the shared cellar and keeps personal notes and preferences. Cannot change stock or shared settings.")}</span></p>
        </div>
      </details>

      {!isOnline ? <Notice role="status" tone="warning">{t("Reconnect to view the current member list or manage access. Membership changes are never queued offline.")}</Notice> : (
        <>
          {message ? <Notice role={message.tone === "error" ? "alert" : "status"} tone={message.tone}>{message.text}</Notice> : null}
          {busy ? <p role="status">{t("Checking and updating access…")}</p> : null}
          {phase === "loading" && !busy ? <p role="status">{t("Loading current members…")}</p> : null}
          {phase === "ready" ? (
            <>
              <h2>{formatLocalizedNumber(members.length, language)} {members.length === 1 ? "person" : "people"}{t(" ")}{t("with access")}</h2>
              {!canManage ? <p>{t("Only Owners can invite people or change their access.")}</p> : null}
              <ul className="household-members__list">
                {members.map((member) => {
                  const label = householdMemberLabel(member)
                  const isSelf = member.userId === userId
                  return (
                    <li key={member.id}>
                      <div className="household-members__person">
                        <div><strong>{label}</strong>{isSelf ? <span className="household-members__badge">{t("You")}</span> : null}<span className="household-members__badge">{getHouseholdRoleLabel(member.role)}</span></div>
                        {member.email && member.displayName ? <span>{member.email}</span> : null}
                        <small>{t("Joined")}{t(" ")}{formatLocalizedDate(member.joinedAt, language)}</small>
                        {isSelf ? <small>{t("To transfer ownership or leave, use Your access below.")}</small> : null}
                      </div>
                      {canManage && !isSelf ? (
                        <div className="household-members__actions">
                          {([member.role === "owner" ? "member" : "owner", "remove"] as const).map((kind) => (
                            <button aria-label={`${actionLabel(kind)}: ${label}`} disabled={busy} key={kind} type="button"
                              onClick={(event) => { trigger.current = event.currentTarget; setMessage(null); setAction({ member, kind }) }}>
                              {actionLabel(kind)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {canManage && action?.member.id === member.id ? (
                        <div aria-label={`${actionLabel(action.kind)} for ${label}`} className="household-members__confirmation" ref={confirmation} role="region" tabIndex={-1}
                          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel() } }}>
                          <h3>{actionLabel(action.kind)}{t(" ")}{t("for")}{t(" ")}{label}?</h3>
                          {action.kind === "owner" ? <p>{t("They will be able to add, move, and remove bottles, edit the cellar, and manage other people's access—including yours. Your own Owner role stays unchanged.")}</p> : action.kind === "member" ? <p>{t("They will keep read-only cellar access and personal notes, but lose stock editing, setup, and member management. Stock changes still queued on their devices will no longer be accepted as Member.")}</p> : (
                            <>
                              <p>{t("This removes access to")}{t(" ")}{householdName}{t(", not their account. Their registered devices are revoked. A new invitation will be needed to rejoin.")}</p>
                              <p><strong>{t("Their private notes and preferences for this household are deleted.")}</strong>{t(" ")}{t("Shared notes, cellar stock, and attributed inventory history are preserved.")}</p>
                              <p>{t("Server access stops immediately. Already-synchronized data on offline devices may remain readable until those devices reconnect.")}</p>
                            </>
                          )}
                          <div className="household-members__actions">
                            <button onClick={cancel} type="button">{t("Cancel")}</button>
                            <button onClick={() => void confirm()} type="button">{t("Confirm:")}{t(" ")}{actionLabel(action.kind).toLowerCase()}</button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              {self ? <HouseholdLifecycle key={`${self.id}:${self.role}`} householdId={householdId} householdName={householdName}
                self={self} members={members} disabled={busy} onAccessChanged={onAccessChanged} /> : null}
            </>
          ) : null}
        </>
      )}
    </main>
  )
}
