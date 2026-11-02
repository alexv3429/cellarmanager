export interface RegionIdentityGroup {
  kind: "region"
  sourceArea: string
  wineCount: number
  chosenId: string | null
  resolvedId: string | null
  resolvedName: string | null
}

export interface AppellationIdentityGroup {
  kind: "appellation"
  sourceArea: string
  sourceAppellation: string
  wineCount: number
  chosenId: string | null
  resolvedId: string | null
  resolvedName: string | null
  regionId: string | null
  valid: boolean
}

export type PlaceIdentityGroup = RegionIdentityGroup | AppellationIdentityGroup

export interface PlaceIdentityGroups {
  regions: RegionIdentityGroup[]
  appellations: AppellationIdentityGroup[]
}

export interface SharedPlace {
  id: string
  name: string
  type: "region" | "subregion" | "appellation"
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: { message: string } | null }>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid place response")
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid place response")
  return value
}

function nullable(value: unknown): string | null {
  return value === null ? null : string(value)
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Invalid place count")
  }
  return value
}

async function call(name: string, parameters: Record<string, unknown>, options: Options): Promise<unknown> {
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, parameters)
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export function parsePlaceGroups(value: unknown): PlaceIdentityGroups {
  const response = record(value)
  if (!Array.isArray(response.regions) || !Array.isArray(response.appellations)) {
    throw new Error("Invalid place groups")
  }
  return {
    regions: response.regions.map((item): RegionIdentityGroup => {
      const row = record(item)
      return {
        kind: "region", sourceArea: string(row.source_area), wineCount: count(row.wine_count),
        chosenId: nullable(row.chosen_id), resolvedId: nullable(row.resolved_id),
        resolvedName: nullable(row.resolved_name),
      }
    }),
    appellations: response.appellations.map((item): AppellationIdentityGroup => {
      const row = record(item)
      if (typeof row.valid !== "boolean") throw new Error("Invalid place hierarchy")
      return {
        kind: "appellation", sourceArea: string(row.source_area),
        sourceAppellation: string(row.source_appellation), wineCount: count(row.wine_count),
        chosenId: nullable(row.chosen_id), resolvedId: nullable(row.resolved_id),
        resolvedName: nullable(row.resolved_name), regionId: nullable(row.region_id),
        valid: row.valid,
      }
    }),
  }
}

export function parseSharedPlaces(value: unknown): SharedPlace[] {
  if (!Array.isArray(value)) throw new Error("Invalid place search")
  return value.map((item) => {
    const row = record(item)
    const type = row.type
    if (type !== "region" && type !== "subregion" && type !== "appellation") {
      throw new Error("Invalid place type")
    }
    return { id: string(row.id), name: string(row.name), type }
  })
}

export async function getHouseholdPlaceGroups(householdId: string, options: Options = {}): Promise<PlaceIdentityGroups> {
  return parsePlaceGroups(await call("get_household_place_identity_groups", {
    p_household_id: string(householdId),
  }, options))
}

export async function searchHouseholdPlaces(
  householdId: string, kind: "region" | "appellation", sourceArea: string, query: string,
  options: Options = {},
): Promise<SharedPlace[]> {
  if (query.trim().length < 2 || query.trim().length > 100) throw new Error("Search with 2 to 100 characters")
  return parseSharedPlaces(await call("search_household_places", {
    p_household_id: string(householdId), p_kind: kind,
    p_source_area: string(sourceArea), p_query: query.trim(),
  }, options))
}

export async function manageHouseholdPlaceLink(
  householdId: string, group: PlaceIdentityGroup, action: "set" | "remove",
  placeId: string | null, options: Options = {},
): Promise<void> {
  const response = record(await call("manage_household_place_identity_link", {
    p_household_id: string(householdId), p_kind: group.kind,
    p_source_area: group.sourceArea,
    p_source_appellation: group.kind === "appellation" ? group.sourceAppellation : null,
    p_action: action, p_place_id: action === "set" ? string(placeId) : null,
    p_expected_place_id: group.chosenId,
  }, options))
  if (response.kind !== group.kind || response.place_id !== (action === "set" ? placeId : null)) {
    throw new Error("Place link could not be confirmed")
  }
}
