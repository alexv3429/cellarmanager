import { getAuthEmailRedirectTo } from "../auth/authEmailFlow"

export const HOUSEHOLD_INVITATION_STORAGE_KEY =
  "cellarmanager.household-invitation-token"

interface InvitationStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

const INVITATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/u

export function isHouseholdInvitationToken(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    INVITATION_TOKEN_PATTERN.test(value)
  )
}

export function getHouseholdInvitationTokenFromUrl(
  urlValue: string,
): string | null {
  const url = new URL(urlValue)

  if (url.pathname.replace(/\/+$/u, "") !== "/invite") {
    return null
  }

  const fragment = new URLSearchParams(
    url.hash.startsWith("#")
      ? url.hash.slice(1)
      : url.hash,
  )
  const token = fragment.get("token")

  return isHouseholdInvitationToken(token)
    ? token
    : null
}

export function readHouseholdInvitationToken(
  storage: InvitationStorage,
): string | null {
  try {
    const token = storage.getItem(
      HOUSEHOLD_INVITATION_STORAGE_KEY,
    )

    return isHouseholdInvitationToken(token)
      ? token
      : null
  } catch {
    return null
  }
}

export function saveHouseholdInvitationToken(
  storage: InvitationStorage,
  token: string,
): boolean {
  if (!isHouseholdInvitationToken(token)) {
    return false
  }

  try {
    storage.setItem(
      HOUSEHOLD_INVITATION_STORAGE_KEY,
      token,
    )
    return true
  } catch {
    return false
  }
}

export function clearHouseholdInvitationToken(
  storage: InvitationStorage,
): void {
  try {
    storage.removeItem(
      HOUSEHOLD_INVITATION_STORAGE_KEY,
    )
  } catch {
    // The in-memory invitation flow can still be dismissed.
  }
}

export function captureHouseholdInvitationToken(
  urlValue: string,
  storage: InvitationStorage,
): string | null {
  const urlToken =
    getHouseholdInvitationTokenFromUrl(urlValue)

  if (urlToken) {
    saveHouseholdInvitationToken(storage, urlToken)
    return urlToken
  }

  return readHouseholdInvitationToken(storage)
}

export function getInvitationUrlWithoutSecret(
  urlValue: string,
): string | null {
  if (!getHouseholdInvitationTokenFromUrl(urlValue)) {
    return null
  }

  const url = new URL(urlValue)
  return `${url.pathname}${url.search}`
}

export function buildHouseholdInvitationUrl(
  applicationOrigin: string,
  token: string,
): string {
  if (!isHouseholdInvitationToken(token)) {
    throw new Error("Invitation token is invalid")
  }

  return `${getAuthEmailRedirectTo(applicationOrigin)}/invite#token=${token}`
}
