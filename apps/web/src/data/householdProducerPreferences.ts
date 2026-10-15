export interface ProducerSource {
  sourceText: string
  normalized: string
  wineCount: number
  producerId: string | null
  canonicalName: string | null
}

export interface ProducerReference {
  id: string
  canonicalName: string
}

interface Options {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: { message: string } | null }>
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid producer response")
  return value as Record<string, unknown>
}

function nonempty(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid producer response")
  return value.trim()
}

function nullableText(value: unknown): string | null {
  return value === null ? null : nonempty(value)
}

export function parseProducerSources(value: unknown, householdId: string): ProducerSource[] {
  const response = object(value)
  if (response.household_id !== householdId || !Array.isArray(response.sources)) {
    throw new Error("The household changed. Refresh before reviewing producers.")
  }
  const sources = response.sources.map((item): ProducerSource => {
    const row = object(item)
    const wineCount = Number(row.wine_count)
    if (!Number.isSafeInteger(wineCount) || wineCount < 1) throw new Error("Invalid producer count")
    const producerId = nullableText(row.producer_id)
    const canonicalName = nullableText(row.canonical_name)
    if ((producerId === null) !== (canonicalName === null)) throw new Error("Invalid producer mapping")
    return {
      sourceText: nonempty(row.source_text), normalized: nonempty(row.normalized),
      wineCount, producerId, canonicalName,
    }
  })
  if (new Set(sources.map((source) => source.normalized)).size !== sources.length) {
    throw new Error("Duplicate producer names")
  }
  return sources
}

export function parseProducerReferences(value: unknown): ProducerReference[] {
  if (!Array.isArray(value)) throw new Error("Invalid producer search response")
  return value.map((item) => {
    const row = object(item)
    return { id: nonempty(row.id), canonicalName: nonempty(row.canonical_name) }
  })
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

export async function getHouseholdProducerSources(householdId: string, options: Options = {}): Promise<ProducerSource[]> {
  return parseProducerSources(await call("get_household_producer_preference_review", { p_household_id: nonempty(householdId) }, options), householdId)
}

export async function searchHouseholdReferenceProducers(householdId: string, query: string, options: Options = {}): Promise<ProducerReference[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2 || trimmed.length > 100) throw new Error("Search with 2 to 100 characters")
  return parseProducerReferences(await call("search_household_reference_producers", {
    p_household_id: nonempty(householdId), p_query: trimmed,
  }, options))
}

export async function manageHouseholdProducerPreference(
  householdId: string, source: ProducerSource, action: "set" | "remove", producerId: string | null,
  options: Options = {},
): Promise<void> {
  const response = object(await call("manage_household_producer_preference", {
    p_household_id: nonempty(householdId), p_source_text: source.sourceText,
    p_action: action, p_producer_id: action === "set" ? nonempty(producerId) : null,
    p_expected_producer_id: source.producerId,
  }, options))
  if (response.source_text !== source.sourceText ||
      response.producer_id !== (action === "set" ? producerId : null)) {
    throw new Error("Producer preference could not be confirmed")
  }
}
