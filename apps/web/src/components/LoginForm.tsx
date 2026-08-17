import { type FormEvent, useState } from "react"

import {
  getAuthEmailRedirectTo,
  getAuthEmailRequestMessage,
} from "../auth/authEmailFlow"
import {
  getSignUpEmailRedirectTo,
  resolveSignUpSuccess,
} from "../auth/signUpFlow"
import { supabase } from "../data/supabase"
import { Notice } from "./Notice"

type AuthMode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "resend-confirmation"

function getAuthModeTitle(mode: AuthMode): string {
  if (mode === "sign-up") {
    return "Create account"
  }

  if (mode === "forgot-password") {
    return "Forgot password"
  }

  if (mode === "resend-confirmation") {
    return "Send confirmation email again"
  }

  return "Sign in"
}

function getSubmitLabel(
  mode: AuthMode,
  isSubmitting: boolean,
): string {
  if (isSubmitting) {
    if (mode === "sign-up") {
      return "Creating account…"
    }

    if (mode === "forgot-password") {
      return "Sending reset link…"
    }

    if (mode === "resend-confirmation") {
      return "Sending confirmation…"
    }

    return "Signing in…"
  }

  if (mode === "sign-up") {
    return "Create account"
  }

  if (mode === "forgot-password") {
    return "Send password reset link"
  }

  if (mode === "resend-confirmation") {
    return "Send confirmation email"
  }

  return "Sign in"
}

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
      const normalizedEmail = email.trim()

      if (mode === "sign-in") {
        const { error: signInError } =
          await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          })

        if (signInError) {
          setError(signInError.message)
        }

        return
      }

      if (mode === "forgot-password") {
        const { error: resetError } =
          await supabase.auth.resetPasswordForEmail(
            normalizedEmail,
            {
              redirectTo: getAuthEmailRedirectTo(
                window.location.origin,
              ),
            },
          )

        if (resetError) {
          setError(resetError.message)
          return
        }

        setMessage(
          getAuthEmailRequestMessage("password-reset"),
        )
        return
      }

      if (mode === "resend-confirmation") {
        const { error: resendError } =
          await supabase.auth.resend({
            type: "signup",
            email: normalizedEmail,
            options: {
              emailRedirectTo: getAuthEmailRedirectTo(
                window.location.origin,
              ),
            },
          })

        if (resendError) {
          setError(resendError.message)
          return
        }

        setMessage(
          getAuthEmailRequestMessage(
            "signup-confirmation",
          ),
        )
        return
      }

      const {
        data,
        error: signUpError,
      } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: getSignUpEmailRedirectTo(
            window.location.origin,
          ),
        },
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
    <main className="standalone-page">
      <h1>CellarManager</h1>
      <p>Local-first wine cellar inventory.</p>

      <form onSubmit={handleSubmit}>
        <h2>{getAuthModeTitle(mode)}</h2>

        {mode === "forgot-password" ? (
          <p>
            We will email you a secure link to choose a new
            password.
          </p>
        ) : null}

        {mode === "resend-confirmation" ? (
          <p>
            Enter the address used to create your account.
          </p>
        ) : null}

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

        {mode === "sign-in" || mode === "sign-up" ? (
          <label>
            Password
            <input
              autoComplete={
                mode === "sign-up"
                  ? "new-password"
                  : "current-password"
              }
              disabled={isSubmitting}
              minLength={mode === "sign-up" ? 6 : undefined}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              required
              type="password"
              value={password}
            />
          </label>
        ) : null}

        <button
          disabled={isSubmitting}
          type="submit"
        >
          {getSubmitLabel(mode, isSubmitting)}
        </button>

        {mode === "sign-in" ? (
          <div className="standalone-page__auth-links">
            <button
              disabled={isSubmitting}
              onClick={() =>
                changeMode("forgot-password")
              }
              type="button"
            >
              Forgot password?
            </button>
            <button
              disabled={isSubmitting}
              onClick={() =>
                changeMode("resend-confirmation")
              }
              type="button"
            >
              Send confirmation email again
            </button>
          </div>
        ) : null}

        {message ? (
          <Notice role="status" tone="success">
            {message}
          </Notice>
        ) : null}

        {error ? (
          <Notice role="alert" tone="error">
            {error}
          </Notice>
        ) : null}
      </form>

      <p className="standalone-page__mode-switch">
        {mode === "sign-in"
          ? "New to CellarManager?"
          : mode === "sign-up"
            ? "Already have an account?"
            : null}
        {mode === "sign-in" || mode === "sign-up"
          ? " "
          : null}
        <button
          disabled={isSubmitting}
          onClick={() => {
            changeMode(
              mode === "sign-in" ? "sign-up" : "sign-in",
            )
          }}
          type="button"
        >
          {mode === "sign-in"
            ? "Create account"
            : mode === "sign-up"
              ? "Sign in"
              : "Back to sign in"}
        </button>
      </p>
    </main>
  )
}
