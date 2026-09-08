import {
  type FormEvent,
  useEffect,
  useState,
} from "react"

import {
  createHouseholdInvitation,
  getHouseholdInvitations,
  getInvitationDeliveries,
  sendHouseholdInvitationEmail,
  reissueHouseholdInvitation,
  revokeHouseholdInvitation,
  type CreatedHouseholdInvitation,
  type HouseholdInvitation,
  type HouseholdInvitationStatus,
  type InvitationDelivery,
} from "../data/householdInvitations"
import { buildHouseholdInvitationUrl } from "../households/invitationToken"
import { Notice } from "./Notice"

interface HouseholdInvitationsViewProps {
  householdId: string
  householdName: string
  isOnline: boolean
}

interface ShareableInvitation extends CreatedHouseholdInvitation {
  url: string
}

const STATUS_LABELS: Record<
  HouseholdInvitationStatus,
  string
> = {
  accepted: "Accepted",
  expired: "Expired",
  pending: "Waiting for acceptance",
  revoked: "Cancelled",
  superseded: "Replaced",
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to update household invitations"
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function shareableInvitation(
  invitation: CreatedHouseholdInvitation,
): ShareableInvitation {
  return {
    ...invitation,
    url: buildHouseholdInvitationUrl(
      window.location.origin,
      invitation.token,
    ),
  }
}

export function HouseholdInvitationsView({
  householdId,
  householdName,
  isOnline,
}: HouseholdInvitationsViewProps) {
  const [email, setEmail] = useState("")
  const [invitations, setInvitations] = useState<
    HouseholdInvitation[]
  >([])
  const [share, setShare] =
    useState<ShareableInvitation | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [deliveries, setDeliveries] = useState<InvitationDelivery[]>([])
  const [activeInvitationId, setActiveInvitationId] =
    useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function loadInvitations(): Promise<void> {
    if (!isOnline) {
      setIsLoading(false)
      return
    }

    try {
      setInvitations(
        await getHouseholdInvitations(householdId),
      )
      setDeliveries(await getInvitationDeliveries(householdId))
    } catch (caughtError: unknown) {
      setError(errorMessage(caughtError))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setInvitations([])
    setDeliveries([])
    setShare(null)
    setIsLoading(true)
    void loadInvitations()
    // The callback is deliberately scoped to the current household.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, isOnline])

  async function createInvitation(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    const method = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? "email"
    setError(null)
    setMessage(null)
    setIsCreating(true)

    try {
      const created = await createHouseholdInvitation(
        householdId,
        email,
      )
      setShare(shareableInvitation(created))
      setEmail("")
      if (method === "email") {
        setMessage(await sendHouseholdInvitationEmail(created))
      } else {
        await copyInvitationLink(shareableInvitation(created))
      }
    } catch (caughtError: unknown) {
      setError(errorMessage(caughtError))
    } finally {
      await loadInvitations()
      setIsCreating(false)
    }
  }

  async function reissueInvitation(
    invitation: HouseholdInvitation,
    method: "email" | "copy",
  ): Promise<void> {
    setActiveInvitationId(invitation.id)
    setError(null)
    setMessage(null)

    try {
      const replacement =
        await reissueHouseholdInvitation(
          householdId,
          invitation.id,
        )
      setShare(shareableInvitation(replacement))
      if (method === "email") {
        setMessage(await sendHouseholdInvitationEmail(replacement))
      } else {
        await copyInvitationLink(shareableInvitation(replacement))
      }
    } catch (caughtError: unknown) {
      setError(errorMessage(caughtError))
    } finally {
      await loadInvitations()
      setActiveInvitationId(null)
    }
  }

  async function cancelInvitation(
    invitation: HouseholdInvitation,
  ): Promise<void> {
    setActiveInvitationId(invitation.id)
    setError(null)
    setMessage(null)

    try {
      await revokeHouseholdInvitation(
        householdId,
        invitation.id,
      )
      setShare((current) =>
        current?.email === invitation.email
          ? null
          : current,
      )
      setMessage(
        `Invitation for ${invitation.email} cancelled.`,
      )
      await loadInvitations()
    } catch (caughtError: unknown) {
      setError(errorMessage(caughtError))
    } finally {
      setActiveInvitationId(null)
    }
  }

  async function copyInvitationLink(invitation = share): Promise<void> {
    if (!invitation) {
      return
    }

    setError(null)

    try {
      await navigator.clipboard.writeText(invitation.url)
      setMessage("Invitation link copied. Share it via WhatsApp, Telegram, or any app you prefer.")
    } catch {
      setError(
        "Copy was blocked by the browser. Select and copy the link manually.",
      )
    }
  }

  async function sendEmail(): Promise<void> {
    if (!share) return
    setIsSending(true)
    setError(null)
    setMessage(null)
    try { setMessage(await sendHouseholdInvitationEmail(share)) }
    catch (caughtError: unknown) { setError(errorMessage(caughtError)) }
    finally { setIsSending(false); await loadInvitations() }
  }

  const busy = isCreating || isSending || activeInvitationId !== null

  return (
    <main className="household-invitations">
      <header>
        <h1>Invite a household member</h1>
        <p>
          Invite someone to view and update {householdName}.
          Every invitation grants the Member role; owner controls
          remain private.
        </p>
      </header>

      {!isOnline ? (
        <Notice role="status" tone="warning">
          Reconnect to create or manage invitation links.
        </Notice>
      ) : null}

      {error ? (
        <Notice role="alert" tone="error">
          {error}
        </Notice>
      ) : null}

      {message ? (
        <Notice role="status" tone="success">
          {message}
        </Notice>
      ) : null}

      <form className="household-invitations__form" onSubmit={(event) => void createInvitation(event)}>
        <label>
          Member email
          <input
            autoComplete="email"
            disabled={!isOnline || busy}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="member@example.com"
            required
            type="email"
            value={email}
          />
        </label>
        <p>Choose how to share the invitation. Only this email address can use it to join.</p>
        <div className="household-invitations__share-actions">
          <button disabled={!isOnline || busy} type="submit" value="email">
            {isCreating ? "Preparing invitation…" : "Send invitation by email"}
          </button>
          <button disabled={!isOnline || busy} type="submit" value="copy">
            Copy invitation link
          </button>
        </div>
      </form>

      {share ? (
        <section
          aria-labelledby="invitation-link-heading"
          className="household-invitations__share"
        >
          <h2 id="invitation-link-heading">
            Invitation for {share.email}
          </h2>
          <p>
            Valid until {formatDate(share.expiresAt)}. You can email or copy the same link below.
            After leaving this page, use the history to create a replacement.
          </p>
          <label>
            Private invitation link
            <input
              onClick={(event) => event.currentTarget.select()}
              readOnly
              value={share.url}
            />
          </label>
          <div className="household-invitations__share-actions">
            <button
              onClick={() => void sendEmail()}
              disabled={!isOnline || busy}
              type="button"
            >
              {isSending ? "Sending…" : "Send invitation by email"}
            </button>
            <button
              onClick={() => void copyInvitationLink()}
              disabled={busy}
              type="button"
            >
              Copy invitation link
            </button>
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="household-invitations-heading"
        className="household-invitations__history"
      >
        <div className="household-invitations__section-heading">
          <div>
            <h2 id="household-invitations-heading">
              Invitation history
            </h2>
            <p>
              Sending again or copying a replacement creates a new link and disables the previous one.
              Accepted and cancelled invitations remain visible for accountability.
            </p>
          </div>
          <button
            disabled={!isOnline || isLoading}
            onClick={() => void loadInvitations()}
            type="button"
          >
            Refresh
          </button>
        </div>

        {isLoading ? (
          <Notice role="status">Loading invitations…</Notice>
        ) : invitations.length === 0 ? (
          <p>No invitations have been created yet.</p>
        ) : (
          <ul className="household-invitations__list">
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                <div>
                  <strong>{invitation.email}</strong>
                  <span
                    className={`household-invitations__status household-invitations__status--${invitation.status}`}
                  >
                    {STATUS_LABELS[invitation.status]}
                  </span>
                  <small>
                    Created {formatDate(invitation.createdAt)}
                    {invitation.status === "pending"
                      ? ` · expires ${formatDate(invitation.expiresAt)}`
                      : ""}
                  </small>
                  {deliveries.filter((delivery) => delivery.invitationId === invitation.id).map((delivery) => (
                    <small key={delivery.invitationId}>
                      {{ sending: "Email sending", sent: "Email sent", failed: "Email not sent", unconfirmed: "Email delivery unconfirmed — check the inbox before resending" }[delivery.status]}
                      {` · ${formatDate(delivery.attemptedAt)}`}
                    </small>
                  ))}
                </div>

                {invitation.canReissue || invitation.canRevoke ? (
                  <div className="household-invitations__actions">
                    {invitation.canReissue ? (
                      <button
                        disabled={
                          !isOnline ||
                          busy
                        }
                        onClick={() =>
                          void reissueInvitation(invitation, "email")
                        }
                        type="button"
                      >
                        {activeInvitationId === invitation.id
                          ? "Working…"
                          : "Send a new invitation email"}
                      </button>
                    ) : null}
                    {invitation.canReissue ? (
                      <button disabled={!isOnline || busy} onClick={() => void reissueInvitation(invitation, "copy")} type="button">
                        Copy replacement link
                      </button>
                    ) : null}
                    {invitation.canRevoke ? (
                      <button
                        disabled={
                          !isOnline ||
                          busy
                        }
                        onClick={() =>
                          void cancelInvitation(invitation)
                        }
                        type="button"
                      >
                        Cancel invitation
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
