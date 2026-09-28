import type { CaptureWineSuggestion } from "./capturePhotos"
import type { WineCatalogEntry } from "./wineCatalog"

export interface CaptureWineMatchCandidate {
  wine: WineCatalogEntry
  producerSimilarity: number
  cuveeSimilarity: number
  supportingFields: Array<"vintage" | "appellation" | "color" | "format">
}

interface RankedCaptureWineMatchCandidate extends CaptureWineMatchCandidate {
  rank: number
}

function normalizedWords(value: string): string[] {
  return value.normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
}

function trigramSet(value: string): Set<string> {
  const compact = value.replaceAll(" ", "")
  if (compact.length <= 3) return new Set([compact])
  return new Set(Array.from({ length: compact.length - 2 }, (_, index) => compact.slice(index, index + 3)))
}

function similarity(left: string, right: string): number {
  const leftWords = normalizedWords(left)
  const rightWords = normalizedWords(right)
  if (leftWords.length === 0 || rightWords.length === 0) return 0
  const leftNormalized = leftWords.join(" ")
  const rightNormalized = rightWords.join(" ")
  if (leftNormalized === rightNormalized) return 1

  const leftSet = new Set(leftWords)
  const rightSet = new Set(rightWords)
  const commonWords = [...leftSet].filter((word) => rightSet.has(word)).length
  const wordDice = (2 * commonWords) / (leftSet.size + rightSet.size)
  const leftTrigrams = trigramSet(leftNormalized)
  const rightTrigrams = trigramSet(rightNormalized)
  const commonTrigrams = [...leftTrigrams].filter((part) => rightTrigrams.has(part)).length
  const trigramDice = (2 * commonTrigrams) / (leftTrigrams.size + rightTrigrams.size)
  const containment = Math.min(leftNormalized.length, rightNormalized.length) >= 5
    && (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized))
    ? 0.72 + 0.16 * (Math.min(leftNormalized.length, rightNormalized.length)
      / Math.max(leftNormalized.length, rightNormalized.length))
    : 0
  return Math.max(wordDice, trigramDice, containment)
}

function explicitConflict(
  candidate: CaptureWineSuggestion,
  wine: WineCatalogEntry,
): boolean {
  if (candidate.vintage.status === "year" && candidate.vintage.value !== wine.vintage) return true
  if (candidate.vintage.status === "non_vintage" && wine.vintage !== null) return true
  if (candidate.color.value && candidate.color.value !== "other"
      && wine.color !== "other" && candidate.color.value !== wine.color) return true
  if (candidate.format_ml.value !== null && candidate.format_ml.value !== wine.format_ml) return true
  return false
}

function scoreCandidate(
  candidate: CaptureWineSuggestion,
  wine: WineCatalogEntry,
): RankedCaptureWineMatchCandidate | null {
  if (wine.merged_into_wine_id || explicitConflict(candidate, wine)) return null
  const producerSimilarity = similarity(candidate.producer.value ?? "", wine.producer)
  const cuveeSimilarity = similarity(candidate.cuvee.value ?? "", wine.cuvee)
  if (producerSimilarity < 0.68 || cuveeSimilarity < 0.4) return null

  const supportingFields: CaptureWineMatchCandidate["supportingFields"] = []
  let weightedTotal = producerSimilarity * 0.4 + cuveeSimilarity * 0.4
  let weight = 0.8
  if (candidate.vintage.status === "year" || candidate.vintage.status === "non_vintage") {
    const compatible = candidate.vintage.status === "year"
      ? wine.vintage === candidate.vintage.value
      : wine.vintage === null
    if (compatible) supportingFields.push("vintage")
    weightedTotal += (compatible ? 1 : 0) * 0.12
    weight += 0.12
  }
  if (candidate.appellation.value && wine.appellation) {
    const appellationSimilarity = similarity(candidate.appellation.value, wine.appellation)
    weightedTotal += appellationSimilarity * 0.08
    weight += 0.08
    if (appellationSimilarity >= 0.65) supportingFields.push("appellation")
  }
  if (candidate.color.value && candidate.color.value !== "other") {
    weightedTotal += 0.04
    weight += 0.04
    supportingFields.push("color")
  }
  if (candidate.format_ml.value !== null) {
    weightedTotal += 0.04
    weight += 0.04
    supportingFields.push("format")
  }
  return {
    wine,
    producerSimilarity,
    cuveeSimilarity,
    supportingFields,
    rank: weightedTotal / weight,
  }
}

export function findCaptureWineMatchCandidates(
  candidate: CaptureWineSuggestion,
  wines: WineCatalogEntry[],
  householdId: string,
): CaptureWineMatchCandidate[] {
  if (!candidate.producer.value || !candidate.cuvee.value) return []
  return wines
    .filter((wine) => wine.household_id === householdId)
    .map((wine) => scoreCandidate(candidate, wine))
    .filter((match): match is RankedCaptureWineMatchCandidate => match !== null)
    .sort((left, right) => {
      return right.rank - left.rank
        || left.wine.producer.localeCompare(right.wine.producer)
        || left.wine.cuvee.localeCompare(right.wine.cuvee)
        || left.wine.id.localeCompare(right.wine.id)
    })
    .slice(0, 3)
    .map(({ rank: _rank, ...match }) => match)
}
