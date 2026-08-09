import { type FormEvent, useState } from "react"

import { resolveSignUpSuccess } from "../auth/signUpFlow"
import { supabase } from "../data/supabase"

type AuthMode = "sign-in" | "sign-up"

function getAuthErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to complete authentication"
}

export function LoginForm() {
  const [mode, setMode] =
    useState<AuthMode>("sign-in")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const [error, setError] =
    useState<string | null>(null)

  const [message, setMessage] =
    useState<string | null>(null)

  const [isSubmitting, setIsSubmitting] =
    useState(false)

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode)
    setError(null)
    setMessage(null)
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      if (mode === "sign-in") {
        const { error: signInError } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          })

        if (signInError) {
          setError(signInError.message)
        }

        return
      }

      const {
        data,
        error: signUpError,
      } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })

      if (signUpError) {
        setError(signUpError.message)
        return
      }

      const success = resolveSignUpSuccess(
        data.session !== null,
      )

      setMode(success.nextMode)

      if (success.clearPassword) {
        setPassword("")
      }

      setMessage(success.message)
    } catch (caughtError: unknown) {
      setError(getAuthErrorMessage(caughtError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main>
      <h1>CellarManager</h1>
      <p>v0.2 offline-sync spike</p>

      <button
        aria-pressed={mode === "sign-in"}
        disabled={isSubmitting}
        onClick={() => changeMode("sign-in")}
        type="button"
      >
        Sign in
      </button>

      <button
        aria-pressed={mode === "sign-up"}
        disabled={isSubmitting}
        onClick={() => changeMode("sign-up")}
        type="button"
      >
        Create account
      </button>

      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            autoComplete="email"
            disabled={isSubmitting}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            required
            type="email"
            value={email}
          />
        </label>

        <label>
          Password
          <input
            autoComplete={
              mode === "sign-up"
                ? "new-password"
                : "current-password"
            }
            disabled={isSubmitting}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            required
            type="password"
            value={password}
          />
        </label>

        <button
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting
            ? mode === "sign-up"
              ? "Creating account…"
              : "Signing in…"
            : mode === "sign-up"
              ? "Create account"
              : "Sign in"}
        </button>

        {message ? (
          <p role="status">{message}</p>
        ) : null}

        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  )
}
