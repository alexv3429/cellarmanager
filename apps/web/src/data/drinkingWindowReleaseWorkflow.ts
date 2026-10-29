interface RpcOptions {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

async function call(name: string, parameters: Record<string, unknown>, options: RpcOptions): Promise<unknown> {
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, parameters)
  if (result.error) throw new Error(result.error.message)
  return result.data
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid release workflow response")
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid release workflow response")
  return value
}

export interface ReferenceVersionSummary {
  versionId: string
  versionNumber: number
  status: "draft" | "active"
  rowCount: number
  latestPreflight: { issueCount: number; contentSha256: string; checkedAt: string } | null
}

export interface ReleaseWorkspace {
  canPublish: boolean
  versions: ReferenceVersionSummary[]
}

export async function getReleaseWorkspace(options: RpcOptions = {}): Promise<ReleaseWorkspace> {
  const result = object(await call("get_drinking_window_release_workspace", {}, options))
  if (typeof result.can_publish !== "boolean" || !Array.isArray(result.versions)) {
    throw new Error("Invalid release workflow response")
  }
  return {
    canPublish: result.can_publish,
    versions: result.versions.map((value: unknown) => {
      const version = object(value)
      const preflight = version.latest_preflight === null ? null : object(version.latest_preflight)
      if (version.status !== "draft" && version.status !== "active") throw new Error("Invalid version status")
      if (!Number.isInteger(version.version_number) || !Number.isInteger(version.row_count)) {
        throw new Error("Invalid release workflow response")
      }
      return {
        versionId: text(version.version_id), versionNumber: version.version_number as number,
        status: version.status, rowCount: version.row_count as number,
        latestPreflight: preflight ? {
          issueCount: Number(preflight.issue_count), contentSha256: text(preflight.content_sha256),
          checkedAt: text(preflight.checked_at),
        } : null,
      }
    }),
  }
}

export async function createWorkingDraft(baseVersionId: string, options: RpcOptions = {}) {
  const result = object(await call("create_drinking_window_working_draft", {
    p_base_version_id: baseVersionId,
  }, options))
  return { versionId: text(result.version_id), versionNumber: Number(result.version_number) }
}

export interface DraftPreflight {
  issueCount: number
  issues: { check: string; code: string; subjectKind: string; subjectId: string }[]
  contentSha256: string
}

export async function checkWorkingDraft(versionId: string, options: RpcOptions = {}): Promise<DraftPreflight> {
  const result = object(await call("check_drinking_window_working_draft", {
    p_version_id: versionId,
  }, options))
  if (!Number.isInteger(result.issue_count) || !Array.isArray(result.issues)) throw new Error("Invalid preflight")
  return {
    issueCount: result.issue_count as number, contentSha256: text(result.content_sha256),
    issues: result.issues.map((value: unknown) => {
      const issue = object(value)
      return { check: text(issue.check), code: text(issue.code),
        subjectKind: text(issue.subject_kind), subjectId: text(issue.subject_id) }
    }),
  }
}

export async function requestWorkingDraftPilot(versionId: string, householdId: string, options: RpcOptions = {}) {
  return text(await call("request_drinking_window_working_draft_pilot", {
    p_version_id: versionId, p_household_id: householdId,
  }, options))
}

export async function publishReviewedDraft(versionId: string, options: RpcOptions = {}) {
  const result = object(await call("publish_reviewed_drinking_window_draft", {
    p_version_id: versionId,
  }, options))
  return { versionId: text(result.version_id), reviewedHouseholdCount: Number(result.reviewed_household_count) }
}
