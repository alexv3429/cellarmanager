import type { LocationStoragePurpose } from "./cellarSetup"

export type MaturityState =
  | "hold"
  | "assess"
  | "ready"
  | "priority"
  | "assess-now"

export type MaturityVerdict =
  | "useful"
  | "questionable"
  | "wrong"

export type MaturityAssessmentReason =
  | "wine-not-found"
  | "missing-vintage"
  | "appellation-color-conflict"
  | "unsupported-place-profile"

export interface MaturityOverviewItem {
  assessmentReason: MaturityAssessmentReason | null
  bestEndYear: number | null
  bestStartYear: number | null
  calculatedAt: string | null
  confidence: number | null
  confidenceLabel: string | null
  demandStatus: string | null
  drinkByYear: number | null
  feedbackVerdict: MaturityVerdict | null
  firstTrialYear: number | null
  headline: string | null
  isOverride: boolean
  moveMessage: string | null
  moveNeeded: boolean
  projectionId: string | null
  state: MaturityState | null
  stateLabel: string | null
  storagePurpose: string | null
  urgency: string | null
  urgencyScore: number
  wineId: string
}

export interface MaturityRecommendation {
  asOfYear: number
  bestEndYear: number
  bestStartYear: number
  confidenceLabel: string
  contributions: MaturityContribution[]
  drinkByYear: number
  firstTrialYear: number
  headline: string
  message: string
  reasons: string[]
  state: MaturityState
  stateLabel: string
  urgency: string
  urgencyScore: number
  warnings: string[]
}

export interface MaturityContribution {
  label: string
  layer: string
  rationale: string
}

export interface StorageRecommendation {
  agingBottles: number
  message: string
  move: {
    message: string
    needed: boolean
    possible: boolean
    quantity: number
    toPurpose: string | null
  }
  purpose: string
  serviceBottles: number
  totalBottles: number
}

export interface WineMaturityProjection {
  calculatedAt: string
  confidence: number
  id: string
  maturity: MaturityRecommendation
  method: string
  specificity: string
  storage: StorageRecommendation | null
  validUntil: string | null
}

export interface WineMaturityOverride {
  bestEndYear: number
  bestStartYear: number
  drinkByYear: number
  firstTrialYear: number
  note: string | null
  storagePurpose: LocationStoragePurpose | null
  updatedAt: string
}

export interface WineMaturityFeedback {
  note: string | null
  updatedAt: string
  verdict: MaturityVerdict
}

export interface WineMaturity {
  assessmentReason: MaturityAssessmentReason | null
  demandStatus: string | null
  feedback: WineMaturityFeedback | null
  override: WineMaturityOverride | null
  projection: WineMaturityProjection | null
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

async function defaultClient(): Promise<RpcClient> {
  const { supabase } = await import("./supabase")
  return supabase
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid maturity response: ${field}`)
  }

  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid maturity response: ${field}`)
  }

  return value
}

function optionalText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field)
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid maturity response: ${field}`)
  }

  return value
}

function integer(value: unknown, field: string): number {
  const parsed = number(value, field)

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid maturity response: ${field}`)
  }

  return parsed
}

function optionalInteger(value: unknown, field: string): number | null {
  return value === null ? null : integer(value, field)
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid maturity response: ${field}`)
  }

  return value
}

function maturityState(value: unknown): MaturityState {
  if (
    value !== "hold" &&
    value !== "assess" &&
    value !== "ready" &&
    value !== "priority" &&
    value !== "assess-now"
  ) {
    throw new Error("Invalid maturity response: state")
  }

  return value
}

function optionalMaturityState(value: unknown): MaturityState | null {
  return value === null ? null : maturityState(value)
}

function verdict(value: unknown): MaturityVerdict {
  if (
    value !== "useful" &&
    value !== "questionable" &&
    value !== "wrong"
  ) {
    throw new Error("Invalid maturity response: verdict")
  }

  return value
}

function optionalVerdict(value: unknown): MaturityVerdict | null {
  return value === null ? null : verdict(value)
}

function assessmentReason(value: unknown): MaturityAssessmentReason {
  if (
    value !== "wine-not-found" &&
    value !== "missing-vintage" &&
    value !== "appellation-color-conflict" &&
    value !== "unsupported-place-profile"
  ) {
    throw new Error("Invalid maturity response: assessment reason")
  }

  return value
}

function optionalAssessmentReason(
  value: unknown,
): MaturityAssessmentReason | null {
  return value === null ? null : assessmentReason(value)
}

export function maturityAssessmentReasonLabel(
  reason: MaturityAssessmentReason,
): string {
  switch (reason) {
    case "missing-vintage":
      return "Needs a vintage"
    case "appellation-color-conflict":
      return "Check appellation or color"
    case "unsupported-place-profile":
      return "Profile not available"
    case "wine-not-found":
      return "Wine unavailable"
  }
}

export function maturityAssessmentReasonMessage(
  reason: MaturityAssessmentReason,
): string {
  switch (reason) {
    case "missing-vintage":
      return "Not assessed: this wine needs a vintage or another safe date anchor before a calendar window can be calculated."
    case "appellation-color-conflict":
      return "Not assessed: the stored color does not match the reviewed profile for this appellation. Check the wine details before retrying."
    case "unsupported-place-profile":
      return "Not assessed: the library has no exact reviewed profile for this appellation and color yet. No regional fallback was guessed."
    case "wine-not-found":
      return "Not assessed: the wine was no longer available when calculation ran."
  }
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid maturity response: ${field}`)
  }

  return value.map((item) => text(item, field))
}

function parseContributions(value: unknown): MaturityContribution[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid maturity response: contributions")
  }

  return value.map((rawContribution) => {
    const contribution = record(rawContribution, "contribution")

    return {
      label: text(contribution.label, "contribution label"),
      layer: text(contribution.layer, "contribution layer"),
      rationale: text(contribution.rationale, "contribution rationale"),
    }
  })
}

function parseRecommendation(value: unknown): MaturityRecommendation {
  const item = record(value, "maturity recommendation")

  return {
    asOfYear: integer(item.as_of_year, "as-of year"),
    bestEndYear: integer(item.best_end_year, "best end year"),
    bestStartYear: integer(item.best_start_year, "best start year"),
    confidenceLabel: text(item.confidence_label, "confidence label"),
    contributions: parseContributions(item.contributions),
    drinkByYear: integer(item.drink_by_year, "drink-by year"),
    firstTrialYear: integer(item.first_trial_year, "first trial year"),
    headline: text(item.headline, "headline"),
    message: text(item.message, "message"),
    reasons: stringArray(item.reasons, "reasons"),
    state: maturityState(item.state),
    stateLabel: text(item.state_label, "state label"),
    urgency: text(item.urgency, "urgency"),
    urgencyScore: integer(item.urgency_score, "urgency score"),
    warnings: stringArray(item.warnings, "warnings"),
  }
}

function parseStorage(value: unknown): StorageRecommendation | null {
  if (value === null) {
    return null
  }

  const item = record(value, "storage recommendation")
  const current = record(item.current, "current storage")
  const move = record(item.move, "storage move")

  return {
    agingBottles: integer(current.aging_bottles, "aging bottles"),
    message: text(item.message, "storage message"),
    move: {
      message: text(move.message, "move message"),
      needed: boolean(move.needed, "move needed"),
      possible: boolean(move.possible, "move possible"),
      quantity: integer(move.quantity, "move quantity"),
      toPurpose: optionalText(move.to_purpose, "move purpose"),
    },
    purpose: text(item.purpose, "storage purpose"),
    serviceBottles: integer(current.service_bottles, "service bottles"),
    totalBottles: integer(current.total_bottles, "total bottles"),
  }
}

function parseProjection(value: unknown): WineMaturityProjection | null {
  if (value === null) {
    return null
  }

  const item = record(value, "projection")

  return {
    calculatedAt: text(item.calculated_at, "calculated time"),
    confidence: number(item.confidence, "confidence"),
    id: text(item.id, "projection id"),
    maturity: parseRecommendation(item.maturity),
    method: text(item.method, "method"),
    specificity: text(item.specificity, "specificity"),
    storage: parseStorage(item.storage),
    validUntil: optionalText(item.valid_until, "valid-until time"),
  }
}

function parseStoragePurpose(value: unknown): LocationStoragePurpose | null {
  if (value === null) {
    return null
  }

  if (
    value !== "aging" &&
    value !== "service" &&
    value !== "overflow" &&
    value !== "mixed"
  ) {
    throw new Error("Invalid maturity response: storage purpose")
  }

  return value
}

export function parseMaturityOverview(value: unknown): MaturityOverviewItem[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid maturity overview response")
  }

  return value.map((rawItem) => {
    const item = record(rawItem, "overview item")

    return {
      assessmentReason: optionalAssessmentReason(item.assessment_reason),
      bestEndYear: optionalInteger(item.best_end_year, "best end year"),
      bestStartYear: optionalInteger(item.best_start_year, "best start year"),
      calculatedAt: optionalText(item.calculated_at, "calculated time"),
      confidence:
        item.confidence === null ? null : number(item.confidence, "confidence"),
      confidenceLabel: optionalText(item.confidence_label, "confidence label"),
      demandStatus: optionalText(item.demand_status, "demand status"),
      drinkByYear: optionalInteger(item.drink_by_year, "drink-by year"),
      feedbackVerdict: optionalVerdict(item.feedback_verdict),
      firstTrialYear: optionalInteger(item.first_trial_year, "first trial year"),
      headline: optionalText(item.headline, "headline"),
      isOverride: boolean(item.is_override, "override flag"),
      moveMessage: optionalText(item.move_message, "move message"),
      moveNeeded: boolean(item.move_needed, "move-needed flag"),
      projectionId: optionalText(item.projection_id, "projection id"),
      state: optionalMaturityState(item.state),
      stateLabel: optionalText(item.state_label, "state label"),
      storagePurpose: optionalText(item.storage_purpose, "storage purpose"),
      urgency: optionalText(item.urgency, "urgency"),
      urgencyScore: integer(item.urgency_score, "urgency score"),
      wineId: text(item.wine_id, "wine id"),
    }
  })
}

export function parseWineMaturity(value: unknown): WineMaturity {
  const item = record(value, "wine maturity")
  const rawOverride = item.override
  const rawFeedback = item.feedback

  let override: WineMaturityOverride | null = null
  if (rawOverride !== null) {
    const parsed = record(rawOverride, "override")
    override = {
      bestEndYear: integer(parsed.best_end_year, "override best end year"),
      bestStartYear: integer(parsed.best_start_year, "override best start year"),
      drinkByYear: integer(parsed.drink_by_year, "override drink-by year"),
      firstTrialYear: integer(parsed.first_trial_year, "override first trial year"),
      note: optionalText(parsed.note, "override note"),
      storagePurpose: parseStoragePurpose(parsed.storage_purpose),
      updatedAt: text(parsed.updated_at, "override updated time"),
    }
  }

  let feedback: WineMaturityFeedback | null = null
  if (rawFeedback !== null) {
    const parsed = record(rawFeedback, "feedback")
    feedback = {
      note: optionalText(parsed.note, "feedback note"),
      updatedAt: text(parsed.updated_at, "feedback updated time"),
      verdict: verdict(parsed.verdict),
    }
  }

  return {
    assessmentReason: optionalAssessmentReason(item.assessment_reason),
    demandStatus: optionalText(item.demand_status, "demand status"),
    feedback,
    override,
    projection: parseProjection(item.projection),
    wineId: text(item.wine_id, "wine id"),
  }
}

async function rpcResult(
  functionName: string,
  parameters: Record<string, unknown>,
  rpcClient?: RpcClient,
): Promise<unknown> {
  const client = rpcClient ?? (await defaultClient())
  const { data, error } = await client.rpc(functionName, parameters)

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function getHouseholdMaturityOverview(
  householdId: string,
  rpcClient?: RpcClient,
): Promise<MaturityOverviewItem[]> {
  return parseMaturityOverview(
    await rpcResult(
      "get_household_maturity_overview",
      { p_household_id: householdId },
      rpcClient,
    ),
  )
}

export async function getWineMaturity(
  wineId: string,
  rpcClient?: RpcClient,
): Promise<WineMaturity> {
  return parseWineMaturity(
    await rpcResult("get_wine_maturity", { p_wine_id: wineId }, rpcClient),
  )
}

export async function reviewWineMaturity(
  projectionId: string,
  verdictValue: MaturityVerdict,
  note: string,
  rpcClient?: RpcClient,
): Promise<WineMaturity> {
  return parseWineMaturity(
    await rpcResult(
      "review_wine_maturity_projection",
      {
        p_note: note.trim() || null,
        p_projection_id: projectionId,
        p_verdict: verdictValue,
      },
      rpcClient,
    ),
  )
}

export async function setWineMaturityOverride(
  wineId: string,
  years: {
    bestEndYear: number
    bestStartYear: number
    drinkByYear: number
    firstTrialYear: number
  },
  storagePurpose: LocationStoragePurpose | null,
  note: string,
  rpcClient?: RpcClient,
): Promise<WineMaturity> {
  if (
    years.firstTrialYear > years.bestStartYear ||
    years.bestStartYear > years.bestEndYear ||
    years.bestEndYear > years.drinkByYear
  ) {
    throw new Error("Maturity years must stay in chronological order")
  }

  return parseWineMaturity(
    await rpcResult(
      "set_wine_maturity_override",
      {
        p_best_end_year: years.bestEndYear,
        p_best_start_year: years.bestStartYear,
        p_drink_by_year: years.drinkByYear,
        p_first_trial_year: years.firstTrialYear,
        p_note: note.trim() || null,
        p_storage_purpose: storagePurpose,
        p_wine_id: wineId,
      },
      rpcClient,
    ),
  )
}

export async function clearWineMaturityOverride(
  wineId: string,
  rpcClient?: RpcClient,
): Promise<WineMaturity> {
  return parseWineMaturity(
    await rpcResult(
      "clear_wine_maturity_override",
      { p_wine_id: wineId },
      rpcClient,
    ),
  )
}
