import { type FormEvent, useState } from "react"

import { createFirstHousehold } from "../data/onboarding"

interface OnboardingViewProps {
  isOnline: boolean
  onSignOut: () => Promise<void>
}

export function OnboardingView({
  isOnline,
  onSignOut,
}: OnboardingViewProps) {
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
        "Connect to the internet to create your cellar.",
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
        "Cellar created. Waiting for local synchronization…",
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
      setError("Reconnect before signing out.")
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
      <h1>Set up your cellar</h1>

      <p>
        Create your private CellarManager household and
        first storage location.
      </p>

      {!isOnline ? (
        <p role="alert">
          You must be online to complete initial setup.
        </p>
      ) : null}

      <form onSubmit={handleSubmit}>
        <label>
          Household name
          <input
            autoComplete="organization"
            disabled={isCreated}
            onChange={(event) =>
              setHouseholdName(event.target.value)
            }
            required
            value={householdName}
          />
        </label>

        <label>
          Cellar name
          <input
            disabled={isCreated}
            onChange={(event) =>
              setCellarName(event.target.value)
            }
            required
            value={cellarName}
          />
        </label>

        <label>
          First location
          <input
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
            ? "Waiting for sync…"
            : isSubmitting
              ? "Creating…"
              : "Create cellar"}
        </button>
      </form>

      {message ? <p>{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      <button
        disabled={!isOnline || isSubmitting}
        onClick={() => void handleSignOut()}
        type="button"
      >
        Sign out
      </button>
    </main>
  )
}
