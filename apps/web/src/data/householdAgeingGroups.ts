export type AgeingGroupScope = "producer_appellation" | "producer_region" | "appellation" | "region"
export type AgeingChoiceAction = "select" | "unclassified" | "clear"

export interface AgeingGroupOption {
  groupId: string
  scope: AgeingGroupScope
  groupKey: string
  definition: string
  firstTrialYear: number
  bestStartYear: number
  bestEndYear: number
}

export interface AgeingGroupChoice {
  scope: AgeingGroupScope
  groupId: string | null
  choiceRevision: string
}

export interface AgeingGroupVersion {
  versionId: string
  versionNumber: number
  versionStatus: "draft" | "active" | "superseded"
  groups: AgeingGroupOption[]
  choices: AgeingGroupChoice[]
}

export interface HouseholdAgeingGroupReview {
  wineId: string
  contextStatus: string
  sourceFingerprint: string | null
  versions: AgeingGroupVersion[]
}

interface RpcClient {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message: string; code?: string } | null
  }>
}

async function defaultClient(): Promise<RpcClient> {
  const { supabase } = await import("./supabase")
  return supabase
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid ageing-group response")
  }
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid ageing-group response")
  return value
}

function optionalString(value: unknown): string | null {
  return value === null ? null : string(value)
}

function year(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1800 || value > 2300) {
    throw new Error("Invalid ageing-group year")
  }
  return value
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("Invalid ageing-group version")
  }
  return value
}

function scope(value: unknown): AgeingGroupScope {
  if (value === "producer_appellation" || value === "producer_region" ||
      value === "appellation" || value === "region") return value
  throw new Error("Invalid ageing-group scope")
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid ageing-group response")
  return value
}

export function parseHouseholdAgeingGroupReview(value: unknown, wineId: string): HouseholdAgeingGroupReview {
  const root = object(value)
  if (root.wine_id !== wineId) throw new Error("Ageing-group review belongs to another wine")
  return {
    wineId,
    contextStatus: string(root.context_status),
    sourceFingerprint: optionalString(root.source_fingerprint),
    versions: array(root.versions).map((item) => {
      const version = object(item)
      if (version.version_status !== "draft" && version.version_status !== "active" &&
          version.version_status !== "superseded") {
        throw new Error("Invalid ageing-group version")
      }
      return {
        versionId: string(version.version_id),
        versionNumber: positiveInteger(version.version_number),
        versionStatus: version.version_status,
        groups: array(version.groups).map((item) => {
          const group = object(item)
          const firstTrialYear = year(group.first_trial_year)
          const bestStartYear = year(group.best_start_year)
          const bestEndYear = year(group.best_end_year)
          if (firstTrialYear > bestStartYear || bestStartYear > bestEndYear) {
            throw new Error("Invalid ageing-group dates")
          }
          return {
            groupId: string(group.group_id),
            scope: scope(group.scope),
            groupKey: string(group.group_key),
            definition: string(group.definition),
            firstTrialYear, bestStartYear, bestEndYear,
          }
        }),
        choices: array(version.choices).map((item) => {
          const choice = object(item)
          return {
            scope: scope(choice.scope),
            groupId: optionalString(choice.group_id),
            choiceRevision: string(choice.choice_revision),
          }
        }),
      }
    }),
  }
}

export async function getHouseholdAgeingGroupReview(
  wineId: string, rpcClient?: RpcClient,
): Promise<HouseholdAgeingGroupReview | null> {
  const { data, error } = await (rpcClient ?? await defaultClient()).rpc(
    "get_household_wine_ageing_choices", { p_wine_id: wineId })
  if (error) {
    // The client can be deployed before the database migration. Hide only a
    // missing RPC; authorization and other failures remain visible.
    if (error.code === "PGRST202" || /function .*not found|could not find the function/i.test(error.message)) {
      return null
    }
    throw new Error(error.message)
  }
  return parseHouseholdAgeingGroupReview(data, wineId)
}

export async function manageHouseholdAgeingGroupChoice(
  wineId: string,
  versionId: string,
  groupScope: AgeingGroupScope,
  action: AgeingChoiceAction,
  groupId: string | null,
  expectedFingerprint: string,
  expectedRevision: string | null,
  rpcClient?: RpcClient,
): Promise<void> {
  if ((action === "select") !== (groupId !== null)) throw new Error("Invalid ageing-group choice")
  const { error } = await (rpcClient ?? await defaultClient()).rpc(
    "manage_household_wine_ageing_choice", {
      p_wine_id: wineId,
      p_version_id: versionId,
      p_scope: groupScope,
      p_action: action,
      p_group_id: groupId,
      p_expected_fingerprint: expectedFingerprint,
      p_expected_revision: expectedRevision,
    })
  if (error) throw new Error(error.message)
}
