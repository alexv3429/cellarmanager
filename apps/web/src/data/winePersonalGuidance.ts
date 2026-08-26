export type WineObservationVisibility = "household" | "personal"

export type WineObservationType =
  | "tasting"
  | "producer-guidance"
  | "maturity"
  | "pairing"
  | "storage"
  | "other"

export type WineObservationMaturity =
  | "too-young"
  | "youthful"
  | "ready"
  | "declining"
  | "past"

export type WineObservationPairingVerdict =
  | "excellent"
  | "good"
  | "neutral"
  | "poor"

export type WineServingMethod =
  | "none"
  | "open-ahead"
  | "decant"
  | "gentle-decant"

export interface WineObservationRatings {
  acidity: number | null
  body: number | null
  freshness: number | null
  tannin: number | null
}

export interface WineObservation {
  createdAt: string
  id: string
  isAuthor: boolean
  maturityAssessment: WineObservationMaturity | null
  note: string | null
  observedOn: string
  pairingDish: string | null
  pairingVerdict: WineObservationPairingVerdict | null
  ratings: WineObservationRatings
  type: WineObservationType
  updatedAt: string
  visibility: WineObservationVisibility
}

export interface WineServingRecommendation {
  aerationMaxMinutes: number
  aerationMinMinutes: number
  calculatedAt: string
  confidence: number
  confidenceLabel: string
  method: WineServingMethod
  reasons: string[]
  specificity: string
  temperatureMaxC: number
  temperatureMinC: number
  warnings: string[]
}

export interface WineServingOverride {
  aerationMaxMinutes: number
  aerationMinMinutes: number
  method: WineServingMethod
  note: string | null
  temperatureMaxC: number
  temperatureMinC: number
  updatedAt: string
}

export interface WinePersonalGuidance {
  observations: WineObservation[]
  serving: {
    assessmentReason: string | null
    demandStatus: string | null
    model: WineServingRecommendation | null
    override: WineServingOverride | null
  }
  wineId: string
}

export interface SaveWineObservationInput {
  maturityAssessment: WineObservationMaturity | null
  note: string
  observationId?: string | null
  observedOn: string
  pairingDish: string | null
  pairingVerdict: WineObservationPairingVerdict | null
  ratings: WineObservationRatings
  type: WineObservationType
  visibility: WineObservationVisibility
  wineId: string
}

export interface SaveWineServingOverrideInput {
  aerationMaxMinutes: number
  aerationMinMinutes: number
  method: WineServingMethod
  note: string
  temperatureMaxC: number
  temperatureMinC: number
  wineId: string
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

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid personal guidance response: ${field}`)
  }

  return value as Record<string, unknown>
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid personal guidance response: ${field}`)
  }

  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid personal guidance response: ${field}`)
  }

  return value
}

function optionalText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field)
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid personal guidance response: ${field}`)
  }

  return value
}

function integer(value: unknown, field: string): number {
  const parsed = number(value, field)
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid personal guidance response: ${field}`)
  }
  return parsed
}

function optionalRating(value: unknown, field: string): number | null {
  if (value === null) {
    return null
  }

  const parsed = integer(value, field)
  if (parsed < 1 || parsed > 5) {
    throw new Error(`Invalid personal guidance response: ${field}`)
  }
  return parsed
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid personal guidance response: ${field}`)
  }
  return value
}

function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((item, index) =>
    text(item, `${field} ${index + 1}`),
  )
}

function servingMethod(value: unknown): WineServingMethod {
  if (
    value !== "none" &&
    value !== "open-ahead" &&
    value !== "decant" &&
    value !== "gentle-decant"
  ) {
    throw new Error("Invalid personal guidance response: serving method")
  }
  return value
}

function observationVisibility(value: unknown): WineObservationVisibility {
  if (value !== "household" && value !== "personal") {
    throw new Error("Invalid personal guidance response: visibility")
  }
  return value
}

function observationType(value: unknown): WineObservationType {
  if (
    value !== "tasting" &&
    value !== "producer-guidance" &&
    value !== "maturity" &&
    value !== "pairing" &&
    value !== "storage" &&
    value !== "other"
  ) {
    throw new Error("Invalid personal guidance response: observation type")
  }
  return value
}

function maturityAssessment(value: unknown): WineObservationMaturity | null {
  if (value === null) {
    return null
  }
  if (
    value !== "too-young" &&
    value !== "youthful" &&
    value !== "ready" &&
    value !== "declining" &&
    value !== "past"
  ) {
    throw new Error("Invalid personal guidance response: maturity assessment")
  }
  return value
}

function pairingVerdict(
  value: unknown,
): WineObservationPairingVerdict | null {
  if (value === null) {
    return null
  }
  if (
    value !== "excellent" &&
    value !== "good" &&
    value !== "neutral" &&
    value !== "poor"
  ) {
    throw new Error("Invalid personal guidance response: pairing verdict")
  }
  return value
}

function parseServingRecommendation(value: unknown): WineServingRecommendation {
  const item = record(value, "serving model")
  return {
    aerationMaxMinutes: integer(
      item.aeration_max_minutes,
      "maximum aeration",
    ),
    aerationMinMinutes: integer(
      item.aeration_min_minutes,
      "minimum aeration",
    ),
    calculatedAt: text(item.calculated_at, "serving calculation time"),
    confidence: number(item.confidence, "serving confidence"),
    confidenceLabel: text(
      item.confidence_label,
      "serving confidence label",
    ),
    method: servingMethod(item.method),
    reasons: stringArray(item.reasons, "serving reasons"),
    specificity: text(item.specificity, "serving specificity"),
    temperatureMaxC: number(
      item.temperature_max_c,
      "maximum temperature",
    ),
    temperatureMinC: number(
      item.temperature_min_c,
      "minimum temperature",
    ),
    warnings: stringArray(item.warnings, "serving warnings"),
  }
}

function parseServingOverride(value: unknown): WineServingOverride {
  const item = record(value, "serving override")
  return {
    aerationMaxMinutes: integer(
      item.aeration_max_minutes,
      "override maximum aeration",
    ),
    aerationMinMinutes: integer(
      item.aeration_min_minutes,
      "override minimum aeration",
    ),
    method: servingMethod(item.method),
    note: optionalText(item.note, "serving override note"),
    temperatureMaxC: number(
      item.temperature_max_c,
      "override maximum temperature",
    ),
    temperatureMinC: number(
      item.temperature_min_c,
      "override minimum temperature",
    ),
    updatedAt: text(item.updated_at, "serving override update time"),
  }
}

function parseObservation(value: unknown): WineObservation {
  const item = record(value, "observation")
  const ratings = record(item.ratings, "observation ratings")
  return {
    createdAt: text(item.created_at, "observation creation time"),
    id: text(item.id, "observation id"),
    isAuthor: boolean(item.is_author, "observation author flag"),
    maturityAssessment: maturityAssessment(item.maturity_assessment),
    note: optionalText(item.note, "observation note"),
    observedOn: text(item.observed_on, "observation date"),
    pairingDish: optionalText(item.pairing_dish, "pairing dish"),
    pairingVerdict: pairingVerdict(item.pairing_verdict),
    ratings: {
      acidity: optionalRating(ratings.acidity, "acidity rating"),
      body: optionalRating(ratings.body, "body rating"),
      freshness: optionalRating(ratings.freshness, "freshness rating"),
      tannin: optionalRating(ratings.tannin, "tannin rating"),
    },
    type: observationType(item.observation_type),
    updatedAt: text(item.updated_at, "observation update time"),
    visibility: observationVisibility(item.visibility),
  }
}

export function parseWinePersonalGuidance(value: unknown): WinePersonalGuidance {
  const item = record(value, "personal guidance")
  const serving = record(item.serving, "serving")
  return {
    observations: array(item.observations, "observations").map(
      parseObservation,
    ),
    serving: {
      assessmentReason: optionalText(
        serving.assessment_reason,
        "serving assessment reason",
      ),
      demandStatus: optionalText(
        serving.demand_status,
        "serving demand status",
      ),
      model:
        serving.model === null
          ? null
          : parseServingRecommendation(serving.model),
      override:
        serving.override === null
          ? null
          : parseServingOverride(serving.override),
    },
    wineId: text(item.wine_id, "wine id"),
  }
}

async function rpcResult(
  functionName: string,
  parameters: Record<string, unknown>,
  rpcClient?: RpcClient,
): Promise<WinePersonalGuidance> {
  const client = rpcClient ?? (await defaultClient())

  for (
    let attempt = 0;
    attempt <= FUTURE_JWT_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const { data, error } = await client.rpc(functionName, parameters)
    if (!error) {
      return parseWinePersonalGuidance(data)
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

  throw new Error("Unable to complete personal guidance request")
}

export function getWinePersonalGuidance(
  wineId: string,
  rpcClient?: RpcClient,
): Promise<WinePersonalGuidance> {
  return rpcResult(
    "get_wine_personal_guidance",
    { p_wine_id: wineId },
    rpcClient,
  )
}

export function saveWineObservation(
  input: SaveWineObservationInput,
  rpcClient?: RpcClient,
): Promise<WinePersonalGuidance> {
  return rpcResult(
    "save_wine_observation",
    {
      p_acidity_rating: input.ratings.acidity,
      p_body_rating: input.ratings.body,
      p_freshness_rating: input.ratings.freshness,
      p_maturity_assessment: input.maturityAssessment,
      p_note: input.note,
      p_observation_id: input.observationId ?? null,
      p_observation_type: input.type,
      p_observed_on: input.observedOn,
      p_pairing_dish: input.pairingDish,
      p_pairing_verdict: input.pairingVerdict,
      p_tannin_rating: input.ratings.tannin,
      p_visibility: input.visibility,
      p_wine_id: input.wineId,
    },
    rpcClient,
  )
}

export function deleteWineObservation(
  observationId: string,
  rpcClient?: RpcClient,
): Promise<WinePersonalGuidance> {
  return rpcResult(
    "delete_wine_observation",
    { p_observation_id: observationId },
    rpcClient,
  )
}

export function saveWineServingOverride(
  input: SaveWineServingOverrideInput,
  rpcClient?: RpcClient,
): Promise<WinePersonalGuidance> {
  return rpcResult(
    "set_wine_serving_override",
    {
      p_aeration_max_minutes: input.aerationMaxMinutes,
      p_aeration_min_minutes: input.aerationMinMinutes,
      p_method: input.method,
      p_note: input.note,
      p_temperature_max_c: input.temperatureMaxC,
      p_temperature_min_c: input.temperatureMinC,
      p_wine_id: input.wineId,
    },
    rpcClient,
  )
}

export function clearWineServingOverride(
  wineId: string,
  rpcClient?: RpcClient,
): Promise<WinePersonalGuidance> {
  return rpcResult(
    "clear_wine_serving_override",
    { p_wine_id: wineId },
    rpcClient,
  )
}
