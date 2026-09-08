export type HouseholdInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired"
  | "superseded"

export interface CreatedHouseholdInvitation {
  email: string
  expiresAt: string
  id: string
  token: string
}

export interface HouseholdInvitation {
  canReissue: boolean
  canRevoke: boolean
  createdAt: string
  email: string
  expiresAt: string
  id: string
  requestedRole: "member"
  resolvedAt: string | null
  status: HouseholdInvitationStatus
}

export interface InvitationDelivery {
  invitationId: string
  status: "sending" | "sent" | "failed" | "unconfirmed"
  attemptedAt: string
}

export interface HouseholdInvitationPreview {
  accountExists: boolean
  accountMatches: boolean | null
  email: string
  emailHint: string
  expiresAt: string
  householdName: string
  requestedRole: "member"
  status: HouseholdInvitationStatus
}

export interface AcceptedHouseholdInvitation {
  acceptedAt: string
  householdId: string
  householdName: string
  membershipId: string
  membershipRole: "member"
}

interface RpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

interface ClientOptions {
  rpc?: RpcClient["rpc"]
}

async function defaultRpc(): Promise<RpcClient["rpc"]> {
  const { supabase } = await import("./supabase")
  return supabase.rpc.bind(supabase) as RpcClient["rpc"]
}

function record(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(`${field} must be an object`)
  }

  return value as Record<string, unknown>
}

function rows(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`)
  }

  return value
}

function text(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(`${field} must be non-empty text`)
  }

  return value.trim()
}

function dateText(value: unknown, field: string): string {
  const parsed = text(value, field)

  if (Number.isNaN(Date.parse(parsed))) {
    throw new Error(`${field} must be a date`)
  }

  return parsed
}

function optionalDateText(
  value: unknown,
  field: string,
): string | null {
  return value === null || value === undefined
    ? null
    : dateText(value, field)
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be boolean`)
  }

  return value
}

function invitationStatus(
  value: unknown,
): HouseholdInvitationStatus {
  if (
    value !== "pending" &&
    value !== "accepted" &&
    value !== "revoked" &&
    value !== "expired" &&
    value !== "superseded"
  ) {
    throw new Error("Invitation status is invalid")
  }

  return value
}

function memberRole(value: unknown): "member" {
  if (value !== "member") {
    throw new Error("Invitation role is invalid")
  }

  return value
}

function firstRow(
  value: unknown,
  field: string,
): Record<string, unknown> {
  const resultRows = rows(value, field)

  if (resultRows.length !== 1) {
    throw new Error(`${field} must contain one result`)
  }

  return record(resultRows[0], `${field} result`)
}

function parseCreatedInvitation(
  value: unknown,
): CreatedHouseholdInvitation {
  const result = firstRow(
    value,
    "Created invitation",
  )

  return {
    email: text(result.invitee_email, "Invitation email"),
    expiresAt: dateText(
      result.invitation_expires_at,
      "Invitation expiry",
    ),
    id: text(result.invitation_id, "Invitation ID"),
    token: text(
      result.invitation_token,
      "Invitation token",
    ),
  }
}

export function parseHouseholdInvitations(
  value: unknown,
): HouseholdInvitation[] {
  return rows(value, "Household invitations").map(
    (value, index) => {
      const item = record(
        value,
        `Household invitation ${index + 1}`,
      )

      return {
        canReissue: boolean(
          item.can_reissue,
          "Invitation reissue state",
        ),
        canRevoke: boolean(
          item.can_revoke,
          "Invitation revoke state",
        ),
        createdAt: dateText(
          item.created_at,
          "Invitation creation time",
        ),
        email: text(item.invitee_email, "Invitation email"),
        expiresAt: dateText(
          item.expires_at,
          "Invitation expiry",
        ),
        id: text(item.invitation_id, "Invitation ID"),
        requestedRole: memberRole(item.requested_role),
        resolvedAt: optionalDateText(
          item.resolved_at,
          "Invitation resolution time",
        ),
        status: invitationStatus(item.invitation_status),
      }
    },
  )
}

export function parseHouseholdInvitationPreview(
  value: unknown,
): HouseholdInvitationPreview | null {
  const resultRows = rows(value, "Invitation preview")

  if (resultRows.length === 0) {
    return null
  }

  if (resultRows.length !== 1) {
    throw new Error(
      "Invitation preview must contain at most one result",
    )
  }

  const result = record(
    resultRows[0],
    "Invitation preview result",
  )
  const accountMatches = result.account_matches

  if (
    accountMatches !== null &&
    accountMatches !== undefined &&
    typeof accountMatches !== "boolean"
  ) {
    throw new Error(
      "Invitation account match must be boolean or null",
    )
  }

  return {
    accountExists: boolean(
      result.account_exists,
      "Invitation account existence",
    ),
    accountMatches: accountMatches ?? null,
    email: text(
      result.invitee_email,
      "Invitation email",
    ),
    emailHint: text(
      result.invitee_email_hint,
      "Invitation email hint",
    ),
    expiresAt: dateText(
      result.expires_at,
      "Invitation expiry",
    ),
    householdName: text(
      result.household_name,
      "Invitation household name",
    ),
    requestedRole: memberRole(result.requested_role),
    status: invitationStatus(result.invitation_status),
  }
}

export function parseAcceptedHouseholdInvitation(
  value: unknown,
): AcceptedHouseholdInvitation {
  const result = firstRow(
    value,
    "Accepted invitation",
  )

  return {
    acceptedAt: dateText(
      result.accepted_at,
      "Invitation acceptance time",
    ),
    householdId: text(
      result.household_id,
      "Accepted household ID",
    ),
    householdName: text(
      result.household_name,
      "Accepted household name",
    ),
    membershipId: text(
      result.membership_id,
      "Accepted membership ID",
    ),
    membershipRole: memberRole(result.membership_role),
  }
}

async function callRpc(
  functionName: string,
  parameters: Record<string, unknown>,
  options: ClientOptions,
): Promise<unknown> {
  const rpc = options.rpc ?? (await defaultRpc())
  const { data, error } = await rpc(
    functionName,
    parameters,
  )

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function createHouseholdInvitation(
  householdId: string,
  email: string,
  options: ClientOptions = {},
): Promise<CreatedHouseholdInvitation> {
  return parseCreatedInvitation(
    await callRpc(
      "create_household_invitation",
      {
        p_household_id: householdId,
        p_invitee_email: email,
      },
      options,
    ),
  )
}

export async function getHouseholdInvitations(
  householdId: string,
  options: ClientOptions = {},
): Promise<HouseholdInvitation[]> {
  return parseHouseholdInvitations(
    await callRpc(
      "get_household_invitations",
      { p_household_id: householdId },
      options,
    ),
  )
}

export async function previewHouseholdInvitation(
  token: string,
  options: ClientOptions = {},
): Promise<HouseholdInvitationPreview | null> {
  return parseHouseholdInvitationPreview(
    await callRpc(
      "preview_household_invitation",
      { p_invitation_token: token },
      options,
    ),
  )
}

export async function acceptHouseholdInvitation(
  token: string,
  options: ClientOptions = {},
): Promise<AcceptedHouseholdInvitation> {
  return parseAcceptedHouseholdInvitation(
    await callRpc(
      "accept_household_invitation",
      { p_invitation_token: token },
      options,
    ),
  )
}

export async function reissueHouseholdInvitation(
  householdId: string,
  invitationId: string,
  options: ClientOptions = {},
): Promise<CreatedHouseholdInvitation> {
  return parseCreatedInvitation(
    await callRpc(
      "reissue_household_invitation",
      {
        p_household_id: householdId,
        p_invitation_id: invitationId,
      },
      options,
    ),
  )
}

export async function revokeHouseholdInvitation(
  householdId: string,
  invitationId: string,
  options: ClientOptions = {},
): Promise<void> {
  await callRpc(
    "revoke_household_invitation",
    {
      p_household_id: householdId,
      p_invitation_id: invitationId,
    },
    options,
  )
}

export async function getInvitationDeliveries(
  householdId: string,
  options: ClientOptions = {},
): Promise<InvitationDelivery[]> {
  const data = await callRpc("get_household_invitation_deliveries", {
    p_household_id: householdId,
  }, options)
  return rows(data, "Invitation deliveries").map((value) => {
    const item = record(value, "Invitation delivery")
    const status = item.delivery_status
    if (status !== "sending" && status !== "sent" && status !== "failed" && status !== "unconfirmed") {
      throw new Error("Invalid invitation delivery status")
    }
    return {
      invitationId: text(item.invitation_id, "Invitation ID"),
      status,
      attemptedAt: dateText(item.attempted_at, "Email attempt date"),
    }
  })
}

export async function sendHouseholdInvitationEmail(
  invitation: CreatedHouseholdInvitation,
  options: { accessToken?: string; fetch?: typeof fetch } = {},
): Promise<string> {
  let accessToken = options.accessToken
  if (!accessToken) {
    const { supabase } = await import("./supabase")
    const { data, error } = await supabase.auth.getSession()
    if (error) throw new Error("Unable to verify your session. Sign in again.")
    accessToken = data.session?.access_token
  }
  if (!accessToken) throw new Error("Sign in before sending an invitation.")
  let response: Response
  try {
    response = await (options.fetch ?? fetch)("/api/household-invitations/email", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ invitationId: invitation.id, token: invitation.token }),
    })
  } catch {
    throw new Error("Email delivery could not be confirmed. Check the recipient’s inbox before trying again, or copy the invitation link.")
  }
  let result: Record<string, unknown>
  try { result = record(await response.json(), "Email result") }
  catch { throw new Error("Email delivery could not be confirmed. You can still copy the invitation link.") }
  const message = text(result.message, "Email message")
  if (!response.ok) throw new Error(message)
  return message
}
