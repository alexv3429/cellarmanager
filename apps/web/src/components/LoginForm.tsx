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

interface LoginFormProps {
  invitationContext?: {
    accountExists: boolean
    email: string
    emailHint: string
    expiresAt: string
    householdName: string
  }
}

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
  isInvitation = false,
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
    return isInvitation
      ? "Create account and continue"
      : "Create account"
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

export function LoginForm({
  invitationContext,
}: LoginFormProps = {}) {
  const [mode, setMode] =
    useState<AuthMode>(() =>
      invitationContext?.accountExists
        ? "sign-in"
        : invitationContext
          ? "sign-up"
          : "sign-in",
    )

  const [email, setEmail] = useState(
    () => invitationContext?.email ?? "",
  )
  const [password, setPassword] = useState("")

  const [error, setError] =
    useState<string | null>(null)

  const [message, setMessage] =
    useState<string | null>(null)

  const [isSubmitting, setIsSubmitting] =
    useState(false)

  const [isAwaitingInvitationConfirmation, setIsAwaitingInvitationConfirmation] =
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

      if (
        invitationContext &&
        data.session === null
      ) {
        setPassword("")
        setIsAwaitingInvitationConfirmation(true)
        return
      }

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

  if (
    invitationContext &&
    isAwaitingInvitationConfirmation
  ) {
    return (
      <main className="standalone-page invitation-auth">
        <p className="invitation-auth__eyebrow">
          Invitation to {invitationContext.householdName}
        </p>
        <h1>Check your email</h1>

        <ol
          aria-label="Joining progress"
          className="invitation-auth__steps"
        >
          <li className="invitation-auth__step--complete">
            <span>1</span>
            Account created
          </li>
          <li aria-current="step">
            <span>2</span>
            Confirm email
          </li>
          <li>
            <span>3</span>
            Join household
          </li>
        </ol>

        <Notice role="status" tone="success">
          We sent a confirmation link to {email.trim()}.
          Open it in this browser to return here and finish
          joining {invitationContext.householdName}. Check your
          Spam folder if it does not arrive.
        </Notice>

        <p>
          CellarManager has remembered this private invitation;
          you will not need to copy its link again on this browser.
        </p>

        <div className="invitation-auth__waiting-actions">
          <button
            onClick={() => {
              setIsAwaitingInvitationConfirmation(false)
              changeMode("sign-in")
            }}
            type="button"
          >
            I already confirmed my account
          </button>
          <button
            onClick={() => {
              setIsAwaitingInvitationConfirmation(false)
              changeMode("resend-confirmation")
            }}
            type="button"
          >
            Send the email again
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      className={`standalone-page${invitationContext ? " invitation-auth" : ""}`}
    >
      {invitationContext ? (
        <>
          <p className="invitation-auth__eyebrow">
            Household invitation
          </p>
          <h1>Join {invitationContext.householdName}</h1>
          <p>
            Create your account, confirm your email, then approve
            joining the shared cellar.
          </p>
          <ol
            aria-label="Joining progress"
            className="invitation-auth__steps"
          >
            <li aria-current="step">
              <span>1</span>
              {mode === "sign-in"
                ? "Sign in"
                : "Create account"}
            </li>
            <li>
              <span>2</span>
              {mode === "sign-in"
                ? "Verify invitation"
                : "Confirm email"}
            </li>
            <li>
              <span>3</span>
              Join household
            </li>
          </ol>
          <p className="invitation-auth__expiry">
            Private invitation · Valid until {new Date(
              invitationContext.expiresAt,
            ).toLocaleString()}
          </p>
        </>
      ) : (
        <>
          <h1>CellarManager</h1>
          <p>Local-first wine cellar inventory.</p>
        </>
      )}

      <form onSubmit={handleSubmit}>
        <h2>
          {invitationContext && mode === "sign-up"
            ? "Create your CellarManager account"
            : invitationContext && mode === "sign-in"
              ? "Sign in to continue"
              : getAuthModeTitle(mode)}
        </h2>

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
            readOnly={invitationContext !== undefined}
            required
            type="email"
            value={email}
          />
          {invitationContext ? (
            <small>
              This address comes from the private invitation link.
            </small>
          ) : null}
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
          {getSubmitLabel(
            mode,
            isSubmitting,
            invitationContext !== undefined,
          )}
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
          ? invitationContext
            ? "Need a CellarManager account?"
            : "New to CellarManager?"
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
            ? invitationContext
              ? "Create one to join"
              : "Create account"
            : mode === "sign-up"
              ? invitationContext
                ? "Sign in instead"
                : "Sign in"
              : "Back to sign in"}
        </button>
      </p>
    </main>
  )
}
