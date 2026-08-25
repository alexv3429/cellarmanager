export const PAIRING_ATTRIBUTE_KEYS = [
  "intensity",
  "fat",
  "acidity",
  "sweetness",
  "salt",
  "umami",
  "spice",
  "protein",
  "fish",
] as const

export type PairingAttributeKey =
  (typeof PAIRING_ATTRIBUTE_KEYS)[number]

export interface PairingAttributes {
  acidity: number
  fat: number
  fish: number
  intensity: number
  protein: number
  salt: number
  spice: number
  sweetness: number
  umami: number
}

export type PairingStyle =
  | "fresh"
  | "light"
  | "rich"
  | "savory"
  | "mature"

export type PairingVerdict =
  | "useful"
  | "questionable"
  | "wrong"

export type PairingStatus =
  | "suggestions"
  | "preparing"
  | "not-assessed"
  | "no-suitable-wine"

export interface PairingPreference {
  preferredColors: string[]
  preferredStyle: PairingStyle | null
  updatedAt: string
}

export interface PairingDishProfile {
  attributes: PairingAttributes
  confidence: number
  description: string
  key: string
  name: string
  preference: PairingPreference | null
}

export interface PairingLocation {
  cellar: string
  location: string
  quantity: number
}

export interface PairingSuggestion {
  appellation: string | null
  area: string | null
  cautions: string[]
  color: string
  confidenceLabel: string
  cuvee: string
  feedbackVerdict: PairingVerdict | null
  formatMl: number
  locations: PairingLocation[]
  maturityState: string | null
  producer: string
  projectionId: string
  quantity: number
  reasons: string[]
  scoreLabel: string
  vintage: number | null
  wineId: string
}

export interface PairingRejectedCandidate {
  cautions: string[]
  color: string
  cuvee: string
  producer: string
  reasons: string[]
  scoreLabel: string
  vintage: number | null
  wineId: string
}

export interface PairingResult {
  assessedCandidates: number
  bestRejected: PairingRejectedCandidate | null
  dish: {
    attributes: PairingAttributes
    key: string
    name: string
  }
  preferredColors: string[]
  preferredStyle: PairingStyle | null
  status: PairingStatus
  stockWines: number
  suggestions: PairingSuggestion[]
  unavailableProfiles: number
}

interface RpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown
    error: { message: string } | null
  }>
}

const FUTURE_JWT_RETRY_DELAYS_MS = [750, 1500]

function isFutureJwtTimingError(message: string): boolean {
  return /jwt issued at future/i.test(message)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds)
  })
}

async function defaultClient(): Promise<RpcClient> {
  const { supabase } = await import("./supabase")
  return supabase
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
    throw new Error(`Invalid pairing response: ${field}`)
  }

  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid pairing response: ${field}`)
  }

  return value
}

function optionalText(
  value: unknown,
  field: string,
): string | null {
  return value === null ? null : text(value, field)
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid pairing response: ${field}`)
  }

  return value
}

function integer(value: unknown, field: string): number {
  const parsed = number(value, field)

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid pairing response: ${field}`)
  }

  return parsed
}

function optionalInteger(
  value: unknown,
  field: string,
): number | null {
  return value === null ? null : integer(value, field)
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid pairing response: ${field}`)
  }

  return value.map((item) => text(item, field))
}

function style(value: unknown): PairingStyle {
  if (
    value !== "fresh" &&
    value !== "light" &&
    value !== "rich" &&
    value !== "savory" &&
    value !== "mature"
  ) {
    throw new Error("Invalid pairing response: preferred style")
  }

  return value
}

function optionalStyle(value: unknown): PairingStyle | null {
  return value === null ? null : style(value)
}

function verdict(value: unknown): PairingVerdict {
  if (
    value !== "useful" &&
    value !== "questionable" &&
    value !== "wrong"
  ) {
    throw new Error("Invalid pairing response: verdict")
  }

  return value
}

function optionalVerdict(
  value: unknown,
): PairingVerdict | null {
  return value === null ? null : verdict(value)
}

function status(value: unknown): PairingStatus {
  if (
    value !== "suggestions" &&
    value !== "preparing" &&
    value !== "not-assessed" &&
    value !== "no-suitable-wine"
  ) {
    throw new Error("Invalid pairing response: status")
  }

  return value
}

function attributes(value: unknown): PairingAttributes {
  const item = record(value, "dish attributes")
  const parsed = Object.fromEntries(
    PAIRING_ATTRIBUTE_KEYS.map((key) => {
      const parsedValue = number(item[key], `dish ${key}`)
      if (parsedValue < 0 || parsedValue > 5) {
        throw new Error(
          `Invalid pairing response: dish ${key}`,
        )
      }
      return [key, parsedValue]
    }),
  )

  return parsed as unknown as PairingAttributes
}

function parsePreference(
  value: unknown,
): PairingPreference | null {
  if (value === null) {
    return null
  }

  const item = record(value, "preference")
  return {
    preferredColors: stringArray(
      item.preferred_colors,
      "preferred colors",
    ),
    preferredStyle: optionalStyle(item.preferred_style),
    updatedAt: text(item.updated_at, "preference time"),
  }
}

export function parsePairingDishProfiles(
  value: unknown,
): PairingDishProfile[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid pairing dish response")
  }

  return value.map((rawDish) => {
    const dish = record(rawDish, "dish")

    return {
      attributes: attributes(dish.attributes),
      confidence: number(dish.confidence, "dish confidence"),
      description: text(dish.description, "dish description"),
      key: text(dish.key, "dish key"),
      name: text(dish.name, "dish name"),
      preference: parsePreference(dish.preference),
    }
  })
}

function parseLocation(value: unknown): PairingLocation {
  const item = record(value, "location")
  return {
    cellar: text(item.cellar, "cellar"),
    location: text(item.location, "location"),
    quantity: integer(item.quantity, "location quantity"),
  }
}

function parseSuggestion(value: unknown): PairingSuggestion {
  const item = record(value, "suggestion")
  if (!Array.isArray(item.locations)) {
    throw new Error("Invalid pairing response: locations")
  }

  return {
    appellation: optionalText(item.appellation, "appellation"),
    area: optionalText(item.area, "area"),
    cautions: stringArray(item.cautions, "cautions"),
    color: text(item.color, "color"),
    confidenceLabel: text(
      item.confidence_label,
      "confidence label",
    ),
    cuvee: text(item.cuvee, "cuvee"),
    feedbackVerdict: optionalVerdict(item.feedback_verdict),
    formatMl: integer(item.format_ml, "format"),
    locations: item.locations.map(parseLocation),
    maturityState: optionalText(item.maturity_state, "maturity state"),
    producer: text(item.producer, "producer"),
    projectionId: text(item.projection_id, "projection id"),
    quantity: integer(item.quantity, "quantity"),
    reasons: stringArray(item.reasons, "reasons"),
    scoreLabel: text(item.score_label, "score label"),
    vintage: optionalInteger(item.vintage, "vintage"),
    wineId: text(item.wine_id, "wine id"),
  }
}

function parseRejected(
  value: unknown,
): PairingRejectedCandidate | null {
  if (value === null) {
    return null
  }

  const item = record(value, "best rejected")
  return {
    cautions: stringArray(item.cautions, "rejected cautions"),
    color: text(item.color, "rejected color"),
    cuvee: text(item.cuvee, "rejected cuvee"),
    producer: text(item.producer, "rejected producer"),
    reasons: stringArray(item.reasons, "rejected reasons"),
    scoreLabel: text(item.score_label, "rejected score label"),
    vintage: optionalInteger(item.vintage, "rejected vintage"),
    wineId: text(item.wine_id, "rejected wine id"),
  }
}

export function parsePairingResult(value: unknown): PairingResult {
  const item = record(value, "result")
  const dish = record(item.dish, "result dish")
  if (!Array.isArray(item.suggestions)) {
    throw new Error("Invalid pairing response: suggestions")
  }

  return {
    assessedCandidates: integer(
      item.assessed_candidates,
      "assessed candidates",
    ),
    bestRejected: parseRejected(item.best_rejected),
    dish: {
      attributes: attributes(dish.attributes),
      key: text(dish.key, "result dish key"),
      name: text(dish.name, "result dish name"),
    },
    preferredColors: stringArray(
      item.preferred_colors,
      "result preferred colors",
    ),
    preferredStyle: optionalStyle(item.preferred_style),
    status: status(item.status),
    stockWines: integer(item.stock_wines, "stock wines"),
    suggestions: item.suggestions.map(parseSuggestion),
    unavailableProfiles: integer(
      item.unavailable_profiles,
      "unavailable profiles",
    ),
  }
}

async function rpcResult(
  functionName: string,
  parameters: Record<string, unknown>,
  rpcClient?: RpcClient,
): Promise<unknown> {
  const client = rpcClient ?? (await defaultClient())

  for (
    let attempt = 0;
    attempt <= FUTURE_JWT_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const { data, error } = await client.rpc(
      functionName,
      parameters,
    )

    if (!error) {
      return data
    }

    const retryDelay = FUTURE_JWT_RETRY_DELAYS_MS[attempt]
    if (
      retryDelay === undefined ||
      !isFutureJwtTimingError(error.message)
    ) {
      throw new Error(error.message)
    }

    await wait(retryDelay)
  }

  throw new Error("Unable to complete pairing request")
}

export async function getPairingDishProfiles(
  householdId: string,
  rpcClient?: RpcClient,
): Promise<PairingDishProfile[]> {
  return parsePairingDishProfiles(
    await rpcResult(
      "get_pairing_dish_profiles",
      { p_household_id: householdId },
      rpcClient,
    ),
  )
}

export async function getPairingSuggestions(
  householdId: string,
  dishKey: string,
  dishAttributes: PairingAttributes,
  preferredColors: string[],
  preferredStyle: PairingStyle | null,
  rpcClient?: RpcClient,
): Promise<PairingResult> {
  return parsePairingResult(
    await rpcResult(
      "get_pairing_suggestions",
      {
        p_dish_attributes: dishAttributes,
        p_dish_key: dishKey,
        p_household_id: householdId,
        p_limit: 5,
        p_preferred_colors: preferredColors,
        p_preferred_style: preferredStyle,
      },
      rpcClient,
    ),
  )
}

export async function setPairingPreference(
  householdId: string,
  dishKey: string,
  preferredColors: string[],
  preferredStyle: PairingStyle | null,
  rpcClient?: RpcClient,
): Promise<void> {
  await rpcResult(
    "set_pairing_preference",
    {
      p_dish_key: dishKey,
      p_household_id: householdId,
      p_preferred_colors: preferredColors,
      p_preferred_style: preferredStyle,
    },
    rpcClient,
  )
}

export async function reviewPairingSuggestion(
  projectionId: string,
  verdictValue: PairingVerdict,
  rpcClient?: RpcClient,
): Promise<void> {
  await rpcResult(
    "review_wine_pairing_projection",
    {
      p_note: null,
      p_projection_id: projectionId,
      p_verdict: verdictValue,
    },
    rpcClient,
  )
}
