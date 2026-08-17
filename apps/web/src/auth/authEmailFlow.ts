export type AuthEmailRequest =
  | "password-reset"
  | "signup-confirmation"

export const PASSWORD_RECOVERY_STORAGE_KEY =
  "cellarmanager.auth.password-recovery"

interface RecoveryStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export function getAuthEmailRedirectTo(
  applicationOrigin: string,
): string {
  const origin = new URL(applicationOrigin)

  if (
    origin.protocol !== "http:" &&
    origin.protocol !== "https:"
  ) {
    throw new Error(
      "The application origin must use HTTP or HTTPS",
    )
  }

  return origin.origin
}

export function getAuthEmailRequestMessage(
  request: AuthEmailRequest,
): string {
  if (request === "password-reset") {
    return "If an account exists for that email, we sent a password reset link. Check your inbox and Spam folder."
  }

  return "If that account is awaiting confirmation, we sent another link. Check your inbox and Spam folder."
}

export function isPasswordRecoveryUrl(
  urlValue: string,
): boolean {
  const url = new URL(urlValue)
  const fragment = new URLSearchParams(
    url.hash.startsWith("#")
      ? url.hash.slice(1)
      : url.hash,
  )

  return (
    url.searchParams.get("type") === "recovery" ||
    fragment.get("type") === "recovery"
  )
}

export function readPasswordRecoveryPending(
  storage: RecoveryStorage,
): boolean {
  try {
    return (
      storage.getItem(PASSWORD_RECOVERY_STORAGE_KEY) ===
      "true"
    )
  } catch {
    return false
  }
}

export function setPasswordRecoveryPending(
  storage: RecoveryStorage,
  isPending: boolean,
): void {
  try {
    if (isPending) {
      storage.setItem(PASSWORD_RECOVERY_STORAGE_KEY, "true")
      return
    }

    storage.removeItem(PASSWORD_RECOVERY_STORAGE_KEY)
  } catch {
    // Recovery still works in memory when browser storage is blocked.
  }
}

export function getPasswordResetValidationError(
  password: string,
  confirmation: string,
): string | null {
  if (password.length < 6) {
    return "Password must be at least 6 characters."
  }

  if (password !== confirmation) {
    return "Passwords do not match."
  }

  return null
}
