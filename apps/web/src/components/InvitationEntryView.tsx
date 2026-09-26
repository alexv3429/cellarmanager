import { useEffect, useState } from "react"

import {
  acceptHouseholdInvitation,
  previewHouseholdInvitation,
  type AcceptedHouseholdInvitation,
  type HouseholdInvitationPreview,
} from "../data/householdInvitations"
import { LoginForm } from "./LoginForm"
import { Notice } from "./Notice"
import { useLanguage } from "../i18n/useLanguage"
import { formatLocalizedDateTime } from "../i18n/formatting"

interface InvitationEntryViewProps {
  hasAuthenticatedSession: boolean
  isOnline: boolean
  onCompleteInvitation: () => void
  onDismissInvitation: () => void
  onSignOut: () => Promise<void>
  token: string
  userId: string | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to open this household invitation"
}

export function InvitationEntryView({
  hasAuthenticatedSession,
  isOnline,
  onCompleteInvitation,
  onDismissInvitation,
  onSignOut,
  token,
  userId,
}: InvitationEntryViewProps) {
  const { language, t } = useLanguage()
  const [preview, setPreview] =
    useState<HouseholdInvitationPreview | null>(null)
  const [accepted, setAccepted] =
    useState<AcceptedHouseholdInvitation | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAccepting, setIsAccepting] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    if (!isOnline) {
      setIsLoading(false)
      return () => {
        active = false
      }
    }

    setIsLoading(true)
    setError(null)

    void previewHouseholdInvitation(token)
      .then((result) => {
        if (active) {
          setPreview(result)
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(errorMessage(caughtError))
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [hasAuthenticatedSession, isOnline, token, userId])

  function leaveInvitation(): void {
    onDismissInvitation()
    window.history.replaceState(null, "", "/")
  }

  async function acceptInvitation(): Promise<void> {
    setIsAccepting(true)
    setError(null)

    try {
      const result = await acceptHouseholdInvitation(token)
      setAccepted(result)
      onCompleteInvitation()
    } catch (caughtError: unknown) {
      setError(errorMessage(caughtError))
    } finally {
      setIsAccepting(false)
    }
  }

  async function changeAccount(): Promise<void> {
    setIsSigningOut(true)
    setError(null)

    try {
      await onSignOut()
    } catch (caughtError: unknown) {
      setError(errorMessage(caughtError))
    } finally {
      setIsSigningOut(false)
    }
  }

  if (accepted) {
    return (
      <main className="standalone-page invitation-entry">
        <h1>{t("Household joined")}</h1>
        <Notice role="status" tone="success">{t("You are now a Member of")}{accepted.householdName}.
        </Notice>
        <p>{t("Members can browse wines, quantities, and locations, use pairing advice, and keep their own notes and preferences. Only an Owner can change the shared cellar.")}</p>
        <button
          onClick={() => window.location.replace("/")}
          type="button"
        >{t("Open CellarManager")}</button>
      </main>
    )
  }

  if (isLoading) {
    return (
      <main className="standalone-page invitation-entry">
        <h1>{t("Household invitation")}</h1>
        <Notice role="status">{t("Checking invitation…")}</Notice>
      </main>
    )
  }

  if (!isOnline) {
    return (
      <main className="standalone-page invitation-entry">
        <h1>{t("Household invitation")}</h1>
        <Notice role="status" tone="warning">{t("Reconnect to review and accept this invitation.")}</Notice>
      </main>
    )
  }

  if (error || !preview) {
    return (
      <main className="standalone-page invitation-entry">
        <h1>{t("Invitation unavailable")}</h1>
        <Notice role="alert" tone="error">
          {error ??
            t("This invitation link is invalid or no longer available.")}
        </Notice>
        <button onClick={leaveInvitation} type="button">{t("Continue to CellarManager")}</button>
      </main>
    )
  }

  if (preview.status !== "pending") {
    const statusMessage = {
      accepted: "This invitation has already been accepted.",
      expired: "This invitation has expired. Ask the Owner for a replacement link.",
      revoked: "This invitation was cancelled by the Owner.",
      superseded: "This invitation was replaced. Use the newest link from the Owner.",
    }[preview.status]

    return (
      <main className="standalone-page invitation-entry">
        <h1>{t("Invitation unavailable")}</h1>
        <Notice role="status" tone="warning">
          {statusMessage}
        </Notice>
        <button onClick={leaveInvitation} type="button">{t("Continue to CellarManager")}</button>
      </main>
    )
  }

  if (!hasAuthenticatedSession || !userId) {
    return (
      <LoginForm
        invitationContext={{
          accountExists: preview.accountExists,
          email: preview.email,
          emailHint: preview.emailHint,
          expiresAt: preview.expiresAt,
          householdName: preview.householdName,
        }}
      />
    )
  }

  return (
    <main className="standalone-page invitation-entry">
      <h1>{t("Join")}{t(" ")}{preview.householdName}</h1>
      <section className="invitation-entry__summary">
        <h2>{t("Household invitation")}</h2>
        <p>{t("You were invited as a")}<strong>{t("Member")}</strong>{t(". Members can view the shared cellar, use pairing advice, and keep their own notes and preferences. Bottle changes, imports, cellar setup, and household access are reserved for Owners.")}</p>
        <dl>
          <div>
            <dt>{t("Invited email")}</dt>
            <dd>{preview.emailHint}</dd>
          </div>
          <div>
            <dt>{t("Expires")}</dt>
            <dd>{formatLocalizedDateTime(preview.expiresAt, language)}</dd>
          </div>
        </dl>
      </section>

      {preview.accountMatches === false ? (
        <Notice role="alert" tone="warning">
          <p>{t("This invitation belongs to another email address. Sign out, then use the invited account (")}{preview.emailHint}).
          </p>
          <button
            disabled={isSigningOut}
            onClick={() => void changeAccount()}
            type="button"
          >
            {isSigningOut ? "Signing out…" : "Use another account"}
          </button>
        </Notice>
      ) : (
        <div className="invitation-entry__actions">
          <button
            disabled={isAccepting}
            onClick={() => void acceptInvitation()}
            type="button"
          >
            {isAccepting
              ? "Joining household…"
              : `Join ${preview.householdName}`}
          </button>
          <button
            disabled={isAccepting}
            onClick={leaveInvitation}
            type="button"
          >{t("Not now")}</button>
        </div>
      )}

      {error ? (
        <Notice role="alert" tone="error">
          {error}
        </Notice>
      ) : null}
    </main>
  )
}
