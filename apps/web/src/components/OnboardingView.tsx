import { type FormEvent, useState } from "react"

import { createFirstHousehold } from "../data/onboarding"
import { Notice } from "./Notice"
import { AccountLink } from "./AccountNavigation"
import { useLanguage } from "../i18n/useLanguage"

interface OnboardingViewProps {
  isOnline: boolean
  onSignOut: () => Promise<void>
}

export function OnboardingView({
  isOnline,
  onSignOut,
}: OnboardingViewProps) {
  const { t } = useLanguage()
  const [householdName, setHouseholdName] = useState("")
  const [cellarName, setCellarName] =
    useState("Main cellar")
  const [locationCode, setLocationCode] =
    useState("A1")

  const [isSubmitting, setIsSubmitting] =
    useState(false)

  const [isCreated, setIsCreated] =
    useState(false)

  const [message, setMessage] =
    useState<string | null>(null)

  const [error, setError] =
    useState<string | null>(null)

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    setMessage(null)
    setError(null)

    if (!isOnline) {
      setError(
        t("Connect to the internet to create your cellar."),
      )
      return
    }

    setIsSubmitting(true)

    try {
      await createFirstHousehold(
        householdName,
        cellarName,
        locationCode,
      )

      setIsCreated(true)
      setMessage(
        t("Cellar created. Waiting for local synchronization…"),
      )
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to create cellar",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSignOut() {
    setError(null)

    if (!isOnline) {
      setError(t("Reconnect before signing out."))
      return
    }

    try {
      await onSignOut()
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to sign out",
      )
    }
  }

  return (
    <main className="standalone-page">
      <AccountLink />
      <h1>{t("Set up your cellar")}</h1>

      <p>{t("Create your private CellarManager household and first storage location.")}</p>

      {!isOnline ? (
        <Notice role="alert" tone="warning">{t("You must be online to complete initial setup.")}</Notice>
      ) : null}

      <form onSubmit={handleSubmit}>
        <label>{t("Household name")}<input
            autoComplete="organization"
            disabled={isCreated}
            onChange={(event) =>
              setHouseholdName(event.target.value)
            }
            required
            value={householdName}
          />
        </label>

        <label>{t("Cellar name")}<input
            disabled={isCreated}
            onChange={(event) =>
              setCellarName(event.target.value)
            }
            required
            value={cellarName}
          />
        </label>

        <label>{t("First location")}<input
            disabled={isCreated}
            onChange={(event) =>
              setLocationCode(event.target.value)
            }
            required
            value={locationCode}
          />
        </label>

        <button
          disabled={
            !isOnline ||
            isSubmitting ||
            isCreated
          }
          type="submit"
        >
          {isCreated
            ? t("Waiting for sync…")
            : isSubmitting
              ? t("Creating…")
              : t("Create cellar")}
        </button>
      </form>

      {message ? (
        <Notice role="status" tone="info">
          {message}
        </Notice>
      ) : null}

      {error ? (
        <Notice role="alert" tone="error">
          {error}
        </Notice>
      ) : null}

      <button
        disabled={!isOnline || isSubmitting}
        onClick={() => void handleSignOut()}
        type="button"
      >{t("Sign out")}</button>
    </main>
  )
}
