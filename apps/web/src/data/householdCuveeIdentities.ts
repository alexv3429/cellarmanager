export interface CuveeIdentityLink {
  firstVintage: number
  lastVintage: number
  productId: string
  productName: string
  active: boolean
}

export interface CuveeIdentityGroup {
  sourceProducer: string
  sourceCuvee: string
  sourceAppellation: string
  sourceColor: string
  wineCount: number
  firstSeenVintage: number
  lastSeenVintage: number
  producerId: string | null
  producerName: string | null
  links: CuveeIdentityLink[]
}

export interface CuveeProduct {
  id: string
  name: string
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: { message: string } | null }>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid cuvée response")
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid cuvée response")
  return value
}

function id(value: unknown): string {
  const result = string(value)
  if (!result.trim()) throw new Error("Invalid cuvée identity")
  return result
}

function year(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1800 || value > 2200) {
    throw new Error("Invalid cuvée vintage")
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

export function parseCuveeGroups(value: unknown): CuveeIdentityGroup[] {
  if (!Array.isArray(value)) throw new Error("Invalid cuvée groups")
  return value.map((item) => {
    const row = record(item)
    if (!Array.isArray(row.links)) throw new Error("Invalid cuvée links")
    const producerId = row.producer_id === null ? null : id(row.producer_id)
    const producerName = row.producer_name === null ? null : id(row.producer_name)
    if ((producerId === null) !== (producerName === null)) throw new Error("Invalid producer mapping")
    const wineCount = Number(row.wine_count)
    if (!Number.isSafeInteger(wineCount) || wineCount < 1) throw new Error("Invalid wine count")
    const links = row.links.map((link): CuveeIdentityLink => {
      const value = record(link)
      if (typeof value.active !== "boolean") throw new Error("Invalid link status")
      return {
        firstVintage: year(value.first_vintage), lastVintage: year(value.last_vintage),
        productId: id(value.product_id), productName: id(value.product_name), active: value.active,
      }
    })
    if (links.some((link) => link.firstVintage > link.lastVintage)) throw new Error("Invalid cuvée range")
    return {
      sourceProducer: id(row.source_producer), sourceCuvee: id(row.source_cuvee),
      sourceAppellation: string(row.source_appellation), sourceColor: id(row.source_color),
      wineCount, firstSeenVintage: year(row.first_seen_vintage),
      lastSeenVintage: year(row.last_seen_vintage), producerId, producerName, links,
    }
  })
}

export function parseCuveeProducts(value: unknown): CuveeProduct[] {
  if (!Array.isArray(value)) throw new Error("Invalid cuvée search")
  return value.map((item) => {
    const row = record(item)
    return { id: id(row.id), name: id(row.name) }
  })
}

export async function getHouseholdCuveeGroups(householdId: string, options: Options = {}): Promise<CuveeIdentityGroup[]> {
  return parseCuveeGroups(await call("get_household_cuvee_identity_groups", { p_household_id: id(householdId) }, options))
}

export async function searchHouseholdCuveeProducts(
  householdId: string, sourceProducer: string, query: string, options: Options = {},
): Promise<CuveeProduct[]> {
  if (query.trim().length < 2 || query.trim().length > 100) throw new Error("Search with 2 to 100 characters")
  return parseCuveeProducts(await call("search_household_cuvee_products", {
    p_household_id: id(householdId), p_source_producer: id(sourceProducer), p_query: query.trim(),
  }, options))
}

export async function manageHouseholdCuveeLink(
  householdId: string, group: CuveeIdentityGroup, action: "set" | "remove",
  firstVintage: number, lastVintage: number, productId: string | null,
  expectedProductId: string | null, options: Options = {},
): Promise<void> {
  if (year(firstVintage) > year(lastVintage)) throw new Error("Invalid cuvée range")
  const response = record(await call("manage_household_cuvee_identity_link", {
    p_household_id: id(householdId), p_source_producer: group.sourceProducer,
    p_source_cuvee: group.sourceCuvee, p_source_appellation: group.sourceAppellation,
    p_source_color: group.sourceColor, p_first_vintage: firstVintage,
    p_last_vintage: lastVintage, p_action: action,
    p_product_id: action === "set" ? id(productId) : null,
    p_expected_product_id: expectedProductId,
  }, options))
  if (response.source_cuvee !== group.sourceCuvee || response.first_vintage !== firstVintage ||
      response.product_id !== (action === "set" ? productId : null)) {
    throw new Error("Cuvée link could not be confirmed")
  }
}
