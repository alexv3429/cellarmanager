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

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shared profile response")
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid shared profile response")
  return value
}

export type FallbackScope = "producer_appellation" | "producer_region" | "appellation" | "region"
export type TargetKind = "region" | "appellation" | "place" | "producer" | "product" | "release"
export type MemberKind = "place" | "product" | "release"

export interface CurationTarget { id: string; label: string; detail: string }

export async function createCurationPlace(input: {
  kind: "region" | "appellation"
  parentRegionId: string | null
  canonicalName: string
  countryCode: string
  identityReason: string
  confirmed: boolean
}, options: RpcOptions = {}): Promise<CurationTarget> {
  if (!input.confirmed || input.identityReason.trim().length < 20) {
    throw new Error("Confirm the place identity and explain the evidence")
  }
  const result = record(await call("create_drinking_window_curation_place", {
    p_place_type: input.kind,
    p_parent_region_id: input.parentRegionId,
    p_canonical_name: input.canonicalName.trim(),
    p_country_code: input.countryCode.trim().toUpperCase(),
    p_identity_reason: input.identityReason.trim(),
    p_confirmed: input.confirmed,
  }, options))
  return { id: text(result.id), label: text(result.canonical_name),
    detail: input.kind === "region" ? "region" : "appellation" }
}

export async function searchCurationTargets(kind: TargetKind, query: string, options: RpcOptions = {}): Promise<CurationTarget[]> {
  if (query.trim().length < 2) throw new Error("Search with at least two letters")
  const result = await call("search_drinking_window_curation_targets", {
    p_kind: kind, p_query: query.trim(),
  }, options)
  if (!Array.isArray(result)) throw new Error("Invalid target list")
  return result.map((value: unknown) => {
    const item = record(value)
    return { id: text(item.id), label: text(item.label), detail: text(item.detail) }
  })
}

export interface AgeingGroup {
  id: string
  scope: FallbackScope
  region: string
  appellation: string | null
  producer: string | null
  wineColor: string
  groupKey: string
  definition: string
  memberCount: number
}

export async function getAuthoringGroups(versionId: string, options: RpcOptions = {}): Promise<AgeingGroup[]> {
  const result = await call("get_drinking_window_authoring_groups", { p_version_id: versionId }, options)
  if (!Array.isArray(result)) throw new Error("Invalid ageing-group list")
  return result.map((value: unknown) => {
    const item = record(value)
    if (!["producer_appellation", "producer_region", "appellation", "region"].includes(String(item.scope))
      || !Number.isInteger(item.member_count)) throw new Error("Invalid ageing group")
    return {
      id: text(item.id), scope: item.scope as FallbackScope, region: text(item.region),
      appellation: item.appellation === null ? null : text(item.appellation),
      producer: item.producer === null ? null : text(item.producer),
      wineColor: text(item.wine_color), groupKey: text(item.group_key),
      definition: text(item.definition), memberCount: item.member_count as number,
    }
  })
}

export async function createAgeingGroup(input: {
  versionId: string; scope: FallbackScope; regionId: string
  appellationId: string | null; producerId: string | null
  color: string; groupKey: string; definition: string
}, options: RpcOptions = {}): Promise<string> {
  return text(await call("create_drinking_window_ageing_group", {
    p_version_id: input.versionId, p_scope: input.scope, p_region_id: input.regionId,
    p_appellation_id: input.appellationId, p_producer_id: input.producerId,
    p_color: input.color, p_group_key: input.groupKey.trim(), p_definition: input.definition.trim(),
  }, options))
}

export async function addGroupMembership(input: {
  groupId: string; memberKind: MemberKind; targetId: string; placeId: string
  firstVintage: number | null; lastVintage: number | null; rationale: string
}, options: RpcOptions = {}): Promise<string> {
  return text(await call("add_drinking_window_group_membership", {
    p_group_id: input.groupId, p_member_kind: input.memberKind,
    p_target_id: input.targetId, p_place_id: input.placeId,
    p_first_vintage: input.firstVintage, p_last_vintage: input.lastVintage,
    p_rationale: input.rationale.trim(),
  }, options))
}

export async function addGroupYear(input: {
  groupId: string; vintage: number; firstTrial: number
  bestStart: number; bestEnd: number; rationale: string
}, options: RpcOptions = {}): Promise<string> {
  return text(await call("add_drinking_window_group_year", {
    p_group_id: input.groupId, p_vintage: input.vintage,
    p_first_trial: input.firstTrial, p_best_start: input.bestStart,
    p_best_end: input.bestEnd, p_rationale: input.rationale.trim(),
  }, options))
}
