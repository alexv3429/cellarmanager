import {
  getWineIdentityKey,
  type WineCatalogEntry,
} from "./wineCatalog"

export interface WineDuplicateCandidate
  extends WineCatalogEntry {
  quantity: number
  position_count: number
}

export type WineDuplicateBasis =
  | "catalog-identity"
  | "confirmed-reference"

export interface WineDuplicateGroup {
  id: string
  basis: WineDuplicateBasis
  wines: WineDuplicateCandidate[]
}

export interface WineMergeResult {
  mergeEventId: string
  sourceWineId: string
  targetWineId: string
  detectionBasis: WineDuplicateBasis
  bottlesTransferred: number
  positionsTransferred: number
  positionsCombined: number
  observationsTransferred: number
  servingOverrideTransferred: boolean
  servingOverrideConflict: boolean
  maturityOverrideTransferred: boolean
  maturityOverrideConflict: boolean
}

export type WineMergeResolutionField =
  | "producer"
  | "cuvee"
  | "vintage"
  | "color"
  | "appellation"
  | "area"
  | "formatMl"

export type WineMergeResolutionValue = string | number | null

export type WineMergeResolution = Partial<
  Record<WineMergeResolutionField, WineMergeResolutionValue>
>

export interface WineDuplicateDifference {
  field: WineMergeResolutionField
  label: string
  sourceValue: WineMergeResolutionValue
  targetValue: WineMergeResolutionValue
  input: "text" | "vintage" | "format"
  optional: boolean
}

const DIFFERENCE_FIELDS: Array<{
  field: WineMergeResolutionField
  label: string
  input: WineDuplicateDifference["input"]
  optional: boolean
  value: (wine: WineDuplicateCandidate) => WineMergeResolutionValue
}> = [
  {
    field: "producer",
    label: "Producer",
    input: "text",
    optional: false,
    value: (wine) => wine.producer,
  },
  {
    field: "cuvee",
    label: "Cuvée",
    input: "text",
    optional: false,
    value: (wine) => wine.cuvee,
  },
  {
    field: "vintage",
    label: "Vintage",
    input: "vintage",
    optional: true,
    value: (wine) => wine.vintage,
  },
  {
    field: "color",
    label: "Color",
    input: "text",
    optional: false,
    value: (wine) => wine.color,
  },
  {
    field: "appellation",
    label: "Appellation",
    input: "text",
    optional: true,
    value: (wine) => wine.appellation,
  },
  {
    field: "area",
    label: "Area",
    input: "text",
    optional: true,
    value: (wine) => wine.area,
  },
  {
    field: "formatMl",
    label: "Bottle format",
    input: "format",
    optional: false,
    value: (wine) => wine.format_ml,
  },
]

function cleanKey(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase()
}

function referenceKey(
  wine: WineDuplicateCandidate,
): string | null {
  if (!wine.wine_reference_id || !wine.wine_reference_type) {
    return null
  }

  return JSON.stringify([
    wine.wine_reference_type,
    wine.wine_reference_id,
    wine.vintage,
    cleanKey(wine.color),
    wine.format_ml,
  ])
}

function groupByKey(
  wines: WineDuplicateCandidate[],
  keyForWine: (wine: WineDuplicateCandidate) => string | null,
): Map<string, WineDuplicateCandidate[]> {
  const grouped = new Map<string, WineDuplicateCandidate[]>()

  for (const wine of wines) {
    const key = keyForWine(wine)
    if (key === null) continue
    const group = grouped.get(key) ?? []
    group.push(wine)
    grouped.set(key, group)
  }

  return grouped
}

function compareCandidate(
  left: WineDuplicateCandidate,
  right: WineDuplicateCandidate,
): number {
  return (
    right.quantity - left.quantity ||
    cleanKey(left.producer).localeCompare(cleanKey(right.producer)) ||
    cleanKey(left.cuvee).localeCompare(cleanKey(right.cuvee)) ||
    left.id.localeCompare(right.id)
  )
}

function idSet(group: WineDuplicateGroup): Set<string> {
  return new Set(group.wines.map((wine) => wine.id))
}

function isSubset(
  candidate: Set<string>,
  selected: Set<string>,
): boolean {
  return [...candidate].every((id) => selected.has(id))
}

export function findWineDuplicateGroups(
  wines: WineDuplicateCandidate[],
): WineDuplicateGroup[] {
  const activeWines = wines.filter(
    (wine) => !wine.merged_into_wine_id,
  )
  const candidates: WineDuplicateGroup[] = []

  for (const [key, groupedWines] of groupByKey(
    activeWines,
    referenceKey,
  )) {
    if (groupedWines.length < 2) continue
    candidates.push({
      id: `reference:${key}`,
      basis: "confirmed-reference",
      wines: [...groupedWines].sort(compareCandidate),
    })
  }

  for (const [key, groupedWines] of groupByKey(
    activeWines,
    (wine) =>
      getWineIdentityKey(
        wine.producer,
        wine.cuvee,
        wine.vintage,
        wine.color,
        wine.format_ml,
      ),
  )) {
    if (groupedWines.length < 2) continue

    const confirmedReferences = new Set(
      groupedWines
        .map((wine) =>
          wine.wine_reference_id && wine.wine_reference_type
            ? `${wine.wine_reference_type}:${wine.wine_reference_id}`
            : null,
        )
        .filter((value): value is string => value !== null),
    )

    if (confirmedReferences.size > 1) continue

    candidates.push({
      id: `identity:${key}`,
      basis: "catalog-identity",
      wines: [...groupedWines].sort(compareCandidate),
    })
  }

  const selected: WineDuplicateGroup[] = []
  for (const candidate of candidates.sort((left, right) => {
    return (
      right.wines.length - left.wines.length ||
      (left.basis === right.basis
        ? left.id.localeCompare(right.id)
        : left.basis === "confirmed-reference"
          ? -1
          : 1)
    )
  })) {
    const candidateIds = idSet(candidate)
    if (
      selected.some((group) =>
        isSubset(candidateIds, idSet(group)),
      )
    ) {
      continue
    }
    selected.push(candidate)
  }

  return selected.sort((left, right) =>
    left.wines[0].producer.localeCompare(right.wines[0].producer),
  )
}

function sameDifferenceValue(
  left: WineMergeResolutionValue,
  right: WineMergeResolutionValue,
): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return left.trim().replace(/\s+/gu, " ") ===
      right.trim().replace(/\s+/gu, " ")
  }
  return left === right
}

export function getWineDuplicateDifferences(
  source: WineDuplicateCandidate,
  target: WineDuplicateCandidate,
): WineDuplicateDifference[] {
  return DIFFERENCE_FIELDS.flatMap((descriptor) => {
    const sourceValue = descriptor.value(source)
    const targetValue = descriptor.value(target)

    if (sameDifferenceValue(sourceValue, targetValue)) return []

    return [{
      field: descriptor.field,
      label: descriptor.label,
      sourceValue,
      targetValue,
      input: descriptor.input,
      optional: descriptor.optional,
    }]
  })
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid wine merge response")
  }
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invalid wine merge response")
  }
  return value
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Invalid wine merge response")
  }
  return value
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("Invalid wine merge response")
  }
  return value
}

export function parseWineMergeResult(value: unknown): WineMergeResult {
  const result = object(value)
  const basis = string(result.detection_basis)

  if (basis !== "catalog-identity" && basis !== "confirmed-reference") {
    throw new Error("Invalid wine merge response")
  }

  return {
    mergeEventId: string(result.merge_event_id),
    sourceWineId: string(result.source_wine_id),
    targetWineId: string(result.target_wine_id),
    detectionBasis: basis,
    bottlesTransferred: number(result.bottles_transferred),
    positionsTransferred: number(result.positions_transferred),
    positionsCombined: number(result.positions_combined),
    observationsTransferred: number(result.observations_transferred),
    servingOverrideTransferred: boolean(
      result.serving_override_transferred,
    ),
    servingOverrideConflict: boolean(result.serving_override_conflict),
    maturityOverrideTransferred: boolean(
      result.maturity_override_transferred,
    ),
    maturityOverrideConflict: boolean(result.maturity_override_conflict),
  }
}

export async function mergeWineDuplicates(
  sourceWineId: string,
  targetWineId: string,
  resolution: WineMergeResolution,
): Promise<WineMergeResult> {
  const { supabase } = await import("./supabase")
  const resolvedValues = Object.fromEntries(
    Object.entries(resolution).map(([field, value]) => [
      field === "formatMl" ? "format_ml" : field,
      value,
    ]),
  )
  const { data, error } = await supabase.rpc("merge_wines", {
    p_source_wine_id: sourceWineId,
    p_target_wine_id: targetWineId,
    p_resolved_values: resolvedValues,
  })

  if (error) throw new Error(error.message)
  return parseWineMergeResult(data)
}
