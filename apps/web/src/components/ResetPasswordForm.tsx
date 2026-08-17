import { type FormEvent, useState } from "react"

import {
  getPasswordResetValidationError,
  setPasswordRecoveryPending,
} from "../auth/authEmailFlow"
import { supabase } from "../data/supabase"
import { Notice } from "./Notice"

interface ResetPasswordFormProps {
  onComplete: () => void
}

function getResetErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to update the password"
}

export function ResetPasswordForm({
  onComplete,
}: ResetPasswordFormProps) {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] =
    useState(false)
  const [isComplete, setIsComplete] = useState(false)

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    setError(null)

    const validationError =
      getPasswordResetValidationError(
        password,
        confirmation,
      )

    if (validationError) {
      setError(validationError)
      return
    }

    setIsSubmitting(true)

    try {
      const { error: updateError } =
        await supabase.auth.updateUser({ password })

      if (updateError) {
        setError(updateError.message)
        return
      }

      setPassword("")
      setConfirmation("")
      setPasswordRecoveryPending(
        window.sessionStorage,
        false,
      )
      setIsComplete(true)
    } catch (caughtError: unknown) {
      setError(getResetErrorMessage(caughtError))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isComplete) {
    return (
      <main className="standalone-page">
        <h1>CellarManager</h1>
        <Notice role="status" tone="success">
          Your password has been updated.
        </Notice>
        <button onClick={onComplete} type="button">
          Continue to CellarManager
        </button>
      </main>
    )
  }

  return (
    <main className="standalone-page">
      <h1>CellarManager</h1>
      <p>Choose a new password for your account.</p>

      <form onSubmit={handleSubmit}>
        <h2>Reset password</h2>

        <label>
          New password
          <input
            autoComplete="new-password"
            disabled={isSubmitting}
            minLength={6}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            required
            type="password"
            value={password}
          />
        </label>

        <label>
          Confirm new password
          <input
            autoComplete="new-password"
            disabled={isSubmitting}
            minLength={6}
            onChange={(event) =>
              setConfirmation(event.target.value)
            }
            required
            type="password"
            value={confirmation}
          />
        </label>

        <button disabled={isSubmitting} type="submit">
          {isSubmitting
            ? "Updating password…"
            : "Update password"}
        </button>

        {error ? (
          <Notice role="alert" tone="error">
            {error}
          </Notice>
        ) : null}
      </form>
    </main>
  )
}
