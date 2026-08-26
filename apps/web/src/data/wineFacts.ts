import { cleanWineText } from "./wineCatalog"

export const SWEETNESS_CATEGORIES = [
  "bone-dry",
  "dry",
  "off-dry",
  "medium-sweet",
  "sweet",
] as const

export type SweetnessCategory =
  (typeof SWEETNESS_CATEGORIES)[number]

export interface WineGrapeComposition {
  name: string
  percentage: number | null
}

export interface WineFacts {
  country: string | null
  region: string | null
  classification: string | null
  vineyard: string | null
  grapeComposition: WineGrapeComposition[]
  sweetnessCategory: SweetnessCategory | null
  alcoholPercent: number | null
  certifications: string[]
}

export interface WineFactsSource {
  country?: unknown
  area?: unknown
  classification?: unknown
  vineyard?: unknown
  grape_composition?: unknown
  sweetness_category?: unknown
  alcohol_percent?: unknown
  certifications?: unknown
}

export interface WineFactSuggestions {
  status: "available" | "unavailable"
  reason: string | null
  sources: {
    kind: "reference" | "reviewed-web"
    name: string
    identifierScheme: string | null
    identifierValue: string | null
    url: string | null
    reviewedAt: string
  }[]
  values: {
    country: string | null
    region: string | null
    subregion: string | null
    classification: string | null
    vineyard: string | null
    grapeComposition: WineGrapeComposition[]
    grapeNote: string | null
  } | null
}

export interface WineGrapeDraft {
  name: string
  percentage: string
}

export interface PrepareWineFactsInput {
  country: string
  region: string
  classification: string
  vineyard: string
  grapeComposition: WineGrapeDraft[]
  sweetnessCategory: string
  alcoholPercent: string
  certifications: string
}

const MAX_TEXT_LENGTH = 200
const MAX_ITEMS = 20

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

function optionalText(
  value: unknown,
  field: string,
): string | null {
  if (value === null || value === undefined || value === "") {
    return null
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be text or null`)
  }

  const cleaned = cleanWineText(value)

  if (cleaned.length === 0) {
    return null
  }

  if (cleaned.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `${field} must be ${MAX_TEXT_LENGTH} characters or fewer`,
    )
  }

  return cleaned
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
    throw new Error(`${field} must be an object`)
  }

  return value as Record<string, unknown>
}

function requiredText(value: unknown, field: string): string {
  const parsed = optionalText(value, field)

  if (parsed === null) {
    throw new Error(`${field} is required`)
  }

  return parsed
}

function jsonArray(value: unknown, field: string): unknown[] {
  if (value === null || value === undefined || value === "") {
    return []
  }

  let parsed = value

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${field} must contain valid JSON`)
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${field} must be an array`)
  }

  if (parsed.length > MAX_ITEMS) {
    throw new Error(`${field} may contain at most ${MAX_ITEMS} items`)
  }

  return parsed
}

function decimal(
  value: string,
  field: string,
): number | null {
  const cleaned = value.trim().replace(",", ".")

  if (cleaned.length === 0) {
    return null
  }

  if (!/^\d+(?:\.\d{1,2})?$/u.test(cleaned)) {
    throw new Error(`${field} must be a number with at most two decimals`)
  }

  return Number(cleaned)
}

function comparisonKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

function parseGrapeComposition(
  value: unknown,
): WineGrapeComposition[] {
  const entries = jsonArray(value, "Grape composition")

  return entries.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry)
    ) {
      throw new Error(
        `Grape composition item ${index + 1} must be an object`,
      )
    }

    const item = entry as Record<string, unknown>
    const name = optionalText(
      item.name,
      `Grape composition item ${index + 1} name`,
    )

    if (name === null) {
      throw new Error(
        `Grape composition item ${index + 1} needs a name`,
      )
    }

    const percentage = item.percentage

    if (
      percentage !== null &&
      (typeof percentage !== "number" ||
        !Number.isFinite(percentage) ||
        percentage <= 0 ||
        percentage > 100)
    ) {
      throw new Error(
        `Grape composition item ${index + 1} has an invalid percentage`,
      )
    }

    return { name, percentage: percentage as number | null }
  })
}

function parseCertifications(value: unknown): string[] {
  return jsonArray(value, "Certifications").map(
    (entry, index) => {
      const certification = optionalText(
        entry,
        `Certification ${index + 1}`,
      )

      if (certification === null) {
        throw new Error(`Certification ${index + 1} cannot be empty`)
      }

      return certification
    },
  )
}

export function parseWineFacts(source: WineFactsSource): WineFacts {
  const sweetness = source.sweetness_category

  if (
    sweetness !== null &&
    sweetness !== undefined &&
    !SWEETNESS_CATEGORIES.includes(
      sweetness as SweetnessCategory,
    )
  ) {
    throw new Error("Sweetness category is invalid")
  }

  const alcohol = source.alcohol_percent
  const parsedAlcohol =
    alcohol === null || alcohol === undefined || alcohol === ""
      ? null
      : Number(alcohol)

  if (
    parsedAlcohol !== null &&
    (!Number.isFinite(parsedAlcohol) ||
      parsedAlcohol <= 0 ||
      parsedAlcohol > 30)
  ) {
    throw new Error("Alcohol percentage is invalid")
  }

  return {
    country: optionalText(source.country, "Country"),
    region: optionalText(source.area, "Region"),
    classification: optionalText(
      source.classification,
      "Classification",
    ),
    vineyard: optionalText(source.vineyard, "Vineyard"),
    grapeComposition: parseGrapeComposition(
      source.grape_composition,
    ),
    sweetnessCategory:
      (sweetness as SweetnessCategory | null | undefined) ?? null,
    alcoholPercent: parsedAlcohol,
    certifications: parseCertifications(source.certifications),
  }
}

export function parseWineFactSuggestions(
  value: unknown,
): WineFactSuggestions {
  const item = record(value, "Wine fact suggestions")
  const status = item.status

  if (status !== "available" && status !== "unavailable") {
    throw new Error("Wine fact suggestion status is invalid")
  }

  const sourceItems = jsonArray(
    item.sources,
    "Wine fact suggestion sources",
  )
  const values =
    item.values === null
      ? null
      : record(item.values, "Wine fact suggestion values")

  if (
    status === "available" &&
    (sourceItems.length === 0 || values === null)
  ) {
    throw new Error("Available wine fact suggestions need sources and values")
  }

  return {
    status,
    reason: optionalText(item.reason, "Wine fact suggestion reason"),
    sources: sourceItems.map((sourceItem, index) => {
      const source = record(
        sourceItem,
        `Wine fact suggestion source ${index + 1}`,
      )
      const kind = source.kind

      if (kind !== "reference" && kind !== "reviewed-web") {
        throw new Error(`Suggestion source ${index + 1} kind is invalid`)
      }

      return {
        kind,
        identifierScheme: optionalText(
          source.identifier_scheme,
          `Suggestion source ${index + 1} identifier scheme`,
        ),
        identifierValue: optionalText(
          source.identifier_value,
          `Suggestion source ${index + 1} identifier value`,
        ),
        name: requiredText(
          source.name,
          `Suggestion source ${index + 1} name`,
        ),
        reviewedAt: requiredText(
          source.reviewed_at,
          `Suggestion source ${index + 1} review time`,
        ),
        url: optionalText(
          source.url,
          `Suggestion source ${index + 1} URL`,
        ),
      }
    }),
    values:
      values === null
        ? null
        : {
            classification: optionalText(
              values.classification,
              "Suggested classification",
            ),
            country: optionalText(
              values.country,
              "Suggested country",
            ),
            region: optionalText(
              values.region,
              "Suggested region",
            ),
            subregion: optionalText(
              values.subregion,
              "Suggested subregion",
            ),
            vineyard: optionalText(
              values.vineyard,
              "Suggested vineyard",
            ),
            grapeComposition: parseGrapeComposition(
              values.grape_composition,
            ),
            grapeNote: optionalText(
              values.grape_note,
              "Suggested grape note",
            ),
          },
  }
}

export function prepareWineFacts(
  input: PrepareWineFactsInput,
): WineFacts {
  const grapeComposition: WineGrapeComposition[] = []
  const grapeKeys = new Set<string>()

  for (const [index, draft] of input.grapeComposition.entries()) {
    const name = optionalText(draft.name, `Grape ${index + 1}`)
    const percentage = decimal(
      draft.percentage,
      `Grape ${index + 1} percentage`,
    )

    if (name === null && percentage === null) {
      continue
    }

    if (name === null) {
      throw new Error(`Grape ${index + 1} needs a name`)
    }

    if (percentage !== null && (percentage <= 0 || percentage > 100)) {
      throw new Error(
        `Grape ${index + 1} percentage must be greater than 0 and at most 100`,
      )
    }

    const key = comparisonKey(name)

    if (grapeKeys.has(key)) {
      throw new Error(`${name} is listed more than once`)
    }

    grapeKeys.add(key)
    grapeComposition.push({ name, percentage })
  }

  if (grapeComposition.length > MAX_ITEMS) {
    throw new Error(`Use at most ${MAX_ITEMS} grape varieties`)
  }

  const totalPercentage = grapeComposition.reduce(
    (total, grape) => total + (grape.percentage ?? 0),
    0,
  )

  if (totalPercentage > 100.001) {
    throw new Error("Grape percentages cannot total more than 100%")
  }

  const sweetness = input.sweetnessCategory.trim()

  if (
    sweetness.length > 0 &&
    !SWEETNESS_CATEGORIES.includes(
      sweetness as SweetnessCategory,
    )
  ) {
    throw new Error("Choose a valid sweetness category")
  }

  const alcoholPercent = decimal(
    input.alcoholPercent,
    "Alcohol percentage",
  )

  if (
    alcoholPercent !== null &&
    (alcoholPercent <= 0 || alcoholPercent > 30)
  ) {
    throw new Error(
      "Alcohol percentage must be greater than 0 and at most 30",
    )
  }

  const certifications: string[] = []
  const certificationKeys = new Set<string>()

  for (const raw of input.certifications.split(/[,;\n]/u)) {
    const certification = optionalText(raw, "Certification")

    if (certification === null) {
      continue
    }

    const key = comparisonKey(certification)

    if (!certificationKeys.has(key)) {
      certificationKeys.add(key)
      certifications.push(certification)
    }
  }

  if (certifications.length > MAX_ITEMS) {
    throw new Error(`Use at most ${MAX_ITEMS} certifications`)
  }

  return {
    country: optionalText(input.country, "Country"),
    region: optionalText(input.region, "Region"),
    classification: optionalText(
      input.classification,
      "Classification",
    ),
    vineyard: optionalText(input.vineyard, "Vineyard"),
    grapeComposition,
    sweetnessCategory:
      sweetness.length === 0
        ? null
        : (sweetness as SweetnessCategory),
    alcoholPercent,
    certifications,
  }
}

export function sweetnessLabel(
  sweetness: SweetnessCategory,
): string {
  switch (sweetness) {
    case "bone-dry":
      return "Bone dry"
    case "off-dry":
      return "Off-dry"
    case "medium-sweet":
      return "Medium-sweet"
    default:
      return sweetness[0].toUpperCase() + sweetness.slice(1)
  }
}

export async function updateWineFacts(
  wineId: string,
  facts: WineFacts,
  rpcClient?: RpcClient,
): Promise<void> {
  const client = rpcClient ?? (await defaultClient())
  const { error } = await client.rpc("update_wine_facts", {
    p_wine_id: wineId,
    p_country: facts.country,
    p_region: facts.region,
    p_classification: facts.classification,
    p_vineyard: facts.vineyard,
    p_grape_composition: facts.grapeComposition,
    p_sweetness_category: facts.sweetnessCategory,
    p_alcohol_percent: facts.alcoholPercent,
    p_certifications: facts.certifications,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function getWineFactSuggestions(
  wineId: string,
  rpcClient?: RpcClient,
): Promise<WineFactSuggestions> {
  const client = rpcClient ?? (await defaultClient())
  const { data, error } = await client.rpc(
    "get_wine_fact_suggestions",
    { p_wine_id: wineId },
  )

  if (error) {
    throw new Error(error.message)
  }

  return parseWineFactSuggestions(data)
}
