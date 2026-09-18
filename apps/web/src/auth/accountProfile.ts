import type { SupabaseClient, User } from "@supabase/supabase-js"
import { getAuthEmailRedirectTo } from "./authEmailFlow"

type AccountAuth = Pick<SupabaseClient["auth"], "getUser" | "updateUser" | "resetPasswordForEmail">
export interface AccountProfile {
  userId: string
  email: string
  displayName: string
}
interface Options {
  auth?: AccountAuth
  isCurrent?: () => boolean
}

export const DISPLAY_NAME_MAX_LENGTH = 80

export function normalizeDisplayName(value: string): string {
  const name = value.trim()
  if (name.length > DISPLAY_NAME_MAX_LENGTH || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new Error("Use up to 80 characters without control characters for your display name.")
  }
  return name
}

function profile(user: User): AccountProfile {
  // Use the same precedence as get_household_members. An empty full_name
  // deliberately clears a legacy name and restores the email fallback.
  const name: unknown = user.user_metadata.full_name ?? user.user_metadata.name
  return { userId: user.id, email: user.email ?? "", displayName: typeof name === "string" ? name.trim() : "" }
}

async function client(options: Options): Promise<AccountAuth> {
  return options.auth ?? (await import("../data/supabase")).supabase.auth
}

async function verifiedProfile(auth: AccountAuth, userId: string, options: Options): Promise<AccountProfile> {
  const { data, error } = await auth.getUser()
  if (error || !data.user || data.user.id !== userId || options.isCurrent?.() === false) {
    throw new Error("Unable to verify this account. Reconnect or sign in again, then retry.")
  }
  return profile(data.user)
}

export async function getAccountProfile(userId: string, options: Options = {}): Promise<AccountProfile> {
  return verifiedProfile(await client(options), userId, options)
}

export async function saveAccountDisplayName(userId: string, value: string, options: Options = {}): Promise<AccountProfile> {
  const name = normalizeDisplayName(value)
  const auth = await client(options)
  await verifiedProfile(auth, userId, options)
  // Only presentation metadata. Never role, app_metadata, email or an arbitrary
  // target user ID; Auth authorizes the caller's own account on the server.
  const { data, error } = await auth.updateUser({ data: { full_name: name } })
  if (error || !data.user || data.user.id !== userId) {
    throw new Error("Could not confirm the saved name. Reload your account to check before trying again.")
  }
  return profile(data.user)
}

export async function requestAccountPasswordReset(userId: string, origin: string, options: Options = {}): Promise<string> {
  const auth = await client(options)
  const account = await verifiedProfile(auth, userId, options)
  if (!account.email) throw new Error("This account has no email address for password recovery.")
  // The recipient comes from Auth, never an editable form field or cached label.
  const { error } = await auth.resetPasswordForEmail(account.email, {
    redirectTo: getAuthEmailRedirectTo(origin),
  })
  if (error) {
    throw new Error("Could not confirm the email request. Check your inbox and Spam folder before retrying; email requests may be rate-limited.")
  }
  return account.email
}
