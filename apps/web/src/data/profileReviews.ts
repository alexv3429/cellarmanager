export type ProfileReviewStatus =
  | "open"
  | "reviewing"
  | "resolved"
  | "dismissed"

export type ProfileReviewCategory =
  | "drinking-window"
  | "wine-style"
  | "wrong-identity"
  | "evidence-problem"
  | "other"

export type ProfileReviewMessageKind =
  | ProfileReviewCategory
  | "additional-information"

export interface ProfileReviewMessage {
  comment: string
  createdAt: string
  evidenceUrl: string | null
  id: string
  kind: ProfileReviewMessageKind
}

export interface ProfileReviewItem {
  caseId: string
  joinedExisting: boolean
  messages: ProfileReviewMessage[]
  notifiedAt: string | null
  openedAt: string
  profileId: string
  profileType: string
  requestedAt: string
  resolutionProfileId: string | null
  resolutionSummary: string | null
  resolvedAt: string | null
  seenAt: string | null
  status: ProfileReviewStatus
  subject: Record<string, unknown>
  subjectKey: string
  subjectTitle: string
  updatedAt: string
  wineId: string
}

export interface ProfileReviewInbox {
  items: ProfileReviewItem[]
  status: "available"
  unreadCount: number
}

export interface ProfileReviewTarget {
  contributionOrder: number
  profileId: string
  profileType: string
  subjectTitle: string
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

async function defaultClient(): Promise<RpcClient> {
  const { supabase } = await import("./supabase")
  return supabase
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be non-empty text`)
  }
  return value.trim()
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null
  return text(value, field)
}

function dateText(value: unknown, field: string): string {
  const parsed = text(value, field)
  if (Number.isNaN(Date.parse(parsed))) throw new Error(`${field} is invalid`)
  return parsed
}

function optionalDateText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null
  return dateText(value, field)
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`)
  return value
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`)
  }
  return value
}

function parseStatus(value: unknown, field: string): ProfileReviewStatus {
  if (
    value !== "open" &&
    value !== "reviewing" &&
    value !== "resolved" &&
    value !== "dismissed"
  ) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function parseMessageKind(
  value: unknown,
  field: string,
): ProfileReviewMessageKind {
  if (
    value !== "drinking-window" &&
    value !== "wine-style" &&
    value !== "wrong-identity" &&
    value !== "evidence-problem" &&
    value !== "other" &&
    value !== "additional-information"
  ) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

export function parseProfileReviewInbox(value: unknown): ProfileReviewInbox {
  const result = record(value, "Profile review inbox")
  if (result.status !== "available") {
    throw new Error("Profile review inbox status is invalid")
  }
  const unreadCount = integer(result.unread_count, "Unread profile review count")
  if (unreadCount < 0) {
    throw new Error("Unread profile review count cannot be negative")
  }

  return {
    items: array(result.items, "Profile review inbox items").map(
      (value, index) => {
        const item = record(value, `Profile review item ${index + 1}`)
        return {
          caseId: text(item.case_id, `Profile review item ${index + 1} case ID`),
          joinedExisting: boolean(
            item.joined_existing,
            `Profile review item ${index + 1} joined state`,
          ),
          messages: array(
            item.messages,
            `Profile review item ${index + 1} messages`,
          ).map((value, messageIndex) => {
            const message = record(
              value,
              `Profile review item ${index + 1} message ${messageIndex + 1}`,
            )
            return {
              comment: text(message.comment, "Profile review comment"),
              createdAt: dateText(message.created_at, "Profile review message time"),
              evidenceUrl: optionalText(
                message.evidence_url,
                "Profile review evidence URL",
              ),
              id: text(message.id, "Profile review message ID"),
              kind: parseMessageKind(message.kind, "Profile review message kind"),
            }
          }),
          notifiedAt: optionalDateText(item.notified_at, "Profile review notification time"),
          openedAt: dateText(item.opened_at, "Profile review opened time"),
          profileId: text(item.profile_id, "Profile review profile ID"),
          profileType: text(item.profile_type, "Profile review profile type"),
          requestedAt: dateText(item.requested_at, "Profile review requested time"),
          resolutionProfileId: optionalText(
            item.resolution_profile_id,
            "Profile review resolution profile ID",
          ),
          resolutionSummary: optionalText(
            item.resolution_summary,
            "Profile review resolution summary",
          ),
          resolvedAt: optionalDateText(item.resolved_at, "Profile review resolved time"),
          seenAt: optionalDateText(item.seen_at, "Profile review seen time"),
          status: parseStatus(item.status, "Profile review status"),
          subject: record(item.subject, "Profile review subject"),
          subjectKey: text(item.subject_key, "Profile review subject key"),
          subjectTitle: text(item.subject_title, "Profile review subject title"),
          updatedAt: dateText(item.updated_at, "Profile review updated time"),
          wineId: text(item.wine_id, "Profile review wine ID"),
        }
      },
    ),
    status: "available",
    unreadCount,
  }
}

export function parseProfileReviewTargets(
  value: unknown,
): ProfileReviewTarget[] {
  const result = record(value, "Profile review targets")
  if (result.status !== "available") {
    throw new Error("Profile review targets status is invalid")
  }

  return array(result.items, "Profile review target items").map(
    (value, index) => {
      const item = record(value, `Profile review target ${index + 1}`)
      const contributionOrder = integer(
        item.contribution_order,
        `Profile review target ${index + 1} contribution order`,
      )
      if (contributionOrder < 1) {
        throw new Error("Profile review target contribution order must be positive")
      }

      return {
        contributionOrder,
        profileId: text(
          item.profile_id,
          `Profile review target ${index + 1} profile ID`,
        ),
        profileType: text(
          item.profile_type,
          `Profile review target ${index + 1} profile type`,
        ),
        subjectTitle: text(
          item.subject_title,
          `Profile review target ${index + 1} subject title`,
        ),
      }
    },
  )
}

async function callInboxRpc(
  functionName: string,
  parameters: Record<string, unknown>,
  rpcClient?: RpcClient,
): Promise<ProfileReviewInbox> {
  const client = rpcClient ?? (await defaultClient())
  const { data, error } = await client.rpc(functionName, parameters)
  if (error) throw new Error(error.message)
  return parseProfileReviewInbox(data)
}

export function getProfileReviewInbox(
  householdId: string,
  rpcClient?: RpcClient,
): Promise<ProfileReviewInbox> {
  return callInboxRpc(
    "get_enrichment_profile_review_inbox",
    { p_household_id: householdId },
    rpcClient,
  )
}

export async function getWineProfileReviewTargets(
  wineId: string,
  rpcClient?: RpcClient,
): Promise<ProfileReviewTarget[]> {
  const client = rpcClient ?? (await defaultClient())
  const { data, error } = await client.rpc(
    "get_wine_profile_review_targets",
    { p_wine_id: wineId },
  )
  if (error) throw new Error(error.message)
  return parseProfileReviewTargets(data)
}

export function requestProfileReview(
  householdId: string,
  wineId: string,
  profileId: string,
  category: ProfileReviewCategory,
  comment: string,
  evidenceUrl: string,
  rpcClient?: RpcClient,
): Promise<ProfileReviewInbox> {
  return callInboxRpc(
    "request_enrichment_profile_review",
    {
      p_category: category,
      p_comment: comment,
      p_evidence_url: evidenceUrl.trim() || null,
      p_household_id: householdId,
      p_profile_id: profileId,
      p_wine_id: wineId,
    },
    rpcClient,
  )
}

export function addProfileReviewMessage(
  householdId: string,
  caseId: string,
  comment: string,
  evidenceUrl: string,
  rpcClient?: RpcClient,
): Promise<ProfileReviewInbox> {
  return callInboxRpc(
    "add_enrichment_profile_review_message",
    {
      p_case_id: caseId,
      p_comment: comment,
      p_evidence_url: evidenceUrl.trim() || null,
      p_household_id: householdId,
    },
    rpcClient,
  )
}

export function markProfileReviewSeen(
  householdId: string,
  caseId: string | null,
  rpcClient?: RpcClient,
): Promise<ProfileReviewInbox> {
  return callInboxRpc(
    "mark_enrichment_profile_review_seen",
    { p_case_id: caseId, p_household_id: householdId },
    rpcClient,
  )
}
