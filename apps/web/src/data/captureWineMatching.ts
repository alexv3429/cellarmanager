import type { CaptureWineSuggestion } from "./capturePhotos"
import type { WineCatalogEntry } from "./wineCatalog"
import maturityKnowledge from "../../../../scripts/enrichment/maturity_knowledge_v2.json"

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

function containsPrintedPhrase(transcript: string, phrase: string): boolean {
  const words = normalizedWords(phrase)
  return words.join(" ").length >= 5 && ` ${transcript} `.includes(` ${words.join(" ")} `)
}

function isOneEditApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false
  let leftIndex = 0
  let rightIndex = 0
  let edits = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1
      rightIndex += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (left.length >= right.length) leftIndex += 1
    if (right.length >= left.length) rightIndex += 1
  }
  return edits + (left.length - leftIndex) + (right.length - rightIndex) === 1
}

/** Only correct an OCR spelling when this household has one clear canonical appellation. */
export function findCatalogueAppellationSpelling(
  printed: string | null,
  wines: WineCatalogEntry[],
  householdId: string,
): string | null {
  if (!printed) return null
  const key = normalizedWords(printed).join("")
  if (key.length < 5) return null
  const candidates = [...new Set(wines
    .filter((wine) => wine.household_id === householdId && !wine.merged_into_wine_id && wine.appellation)
    .map((wine) => wine.appellation as string))]
  const exact = candidates.filter((appellation) => normalizedWords(appellation).join("") === key)
  if (exact.length > 0) return exact.length === 1 && exact[0] !== printed ? exact[0] : null
  if (key.length < 8) return null
  const near = candidates.filter((appellation) => isOneEditApart(key, normalizedWords(appellation).join("")))
  return near.length === 1 ? near[0] : null
}

export interface ReviewedAppellation {
  appellation: string
  region: string | null
}

/** A unique exact or one-edit match against the project's reviewed place names. */
export function findReviewedAppellation(printed: string | null): ReviewedAppellation | null {
  if (!printed) return null
  const key = normalizedWords(printed).join("")
  if (key.length < 5) return null
  const places = maturityKnowledge.places.filter((place) => place.type === "appellation")
  const ranked = places.map((place) => {
    const names = [place.name, ...place.aliases]
    const keys = names.map((name) => normalizedWords(name).join(""))
    const rank = keys.includes(key) ? 0 : key.length >= 8 && keys.some((candidate) => isOneEditApart(key, candidate)) ? 1 : 2
    return { place, rank }
  })
  const best = Math.min(...ranked.map((candidate) => candidate.rank))
  if (best > 1) return null
  const matches = ranked.filter((candidate) => candidate.rank === best)
  if (matches.length !== 1) return null
  const place = matches[0].place
  const canonicalKey = normalizedWords(place.name).join("")
  const appellation = [place.name, ...place.aliases]
    .filter((name) => normalizedWords(name).join("") === canonicalKey)
    .sort((left, right) => Array.from(right).filter((character) => character.codePointAt(0)! > 127).length
      - Array.from(left).filter((character) => character.codePointAt(0)! > 127).length)[0]
  const parent = maturityKnowledge.places.find((candidate) => candidate.id === place.parent)
  return { appellation, region: parent?.type === "region" ? parent.name : null }
}

export interface EnrichedCaptureWineSuggestion {
  suggestion: CaptureWineSuggestion
  catalogueFields: Array<"producer" | "cuvee" | "appellation" | "area" | "color">
  reviewedFields: Array<"appellation" | "area">
}

/** Only a unique identity match can supply missing or misclassified editable details. */
export function enrichCaptureWineSuggestion(
  original: CaptureWineSuggestion,
  knownWine: WineCatalogEntry | null,
  householdId: string,
): EnrichedCaptureWineSuggestion {
  const suggestion = { ...original }
  const catalogueFields: EnrichedCaptureWineSuggestion["catalogueFields"] = []
  const reviewedFields: EnrichedCaptureWineSuggestion["reviewedFields"] = []
  const reviewed = findReviewedAppellation(original.appellation.value)
  const safeWine = knownWine?.household_id === householdId && !knownWine.merged_into_wine_id ? knownWine : null
  const setText = (field: "producer" | "cuvee" | "appellation" | "area", value: string | null, source: "catalogue" | "reviewed") => {
    if (!value || value === suggestion[field].value) return
    suggestion[field] = { value, evidence: [], confidence: "medium" }
    if (source === "catalogue") catalogueFields.push(field)
    else if (field === "appellation" || field === "area") reviewedFields.push(field)
  }
  if (safeWine) {
    setText("producer", safeWine.producer, "catalogue")
    setText("cuvee", safeWine.cuvee, "catalogue")
    if (!original.color.value && ["red", "white", "rose", "sparkling"].includes(safeWine.color)) {
      suggestion.color = { value: safeWine.color as CaptureWineSuggestion["color"]["value"], evidence: [], confidence: "medium" }
      catalogueFields.push("color")
    }
  }
  const catalogueSpelling = safeWine
    ? findCatalogueAppellationSpelling(original.appellation.value, [safeWine], householdId)
    : null
  const reviewedFromWine = safeWine?.appellation ? findReviewedAppellation(safeWine.appellation) : null
  if (reviewed && (!safeWine?.appellation || reviewedFromWine?.appellation === reviewed.appellation)) {
    setText("appellation", reviewed.appellation, "reviewed")
  } else if (catalogueSpelling) {
    setText("appellation", catalogueSpelling, "catalogue")
  }
  if (safeWine?.area && normalizedWords(safeWine.area).join("") !== normalizedWords(safeWine.cuvee).join("")) {
    setText("area", safeWine.area, "catalogue")
  } else if (reviewed?.region && safeWine && (!safeWine.appellation || reviewedFromWine?.appellation === reviewed.appellation)) {
    setText("area", reviewed.region, "reviewed")
  }
  return { suggestion, catalogueFields, reviewedFields }
}

/**
 * A model can put a printed cuvée in `area` and an appellation in `cuvee`.
 * Resolve that only when producer, vintage and cuvée identify one wine, and
 * any clearly evidenced appellation does not contradict it.
 */
export function findCaptureWineCrossRoleMatch(
  suggestion: CaptureWineSuggestion,
  wines: WineCatalogEntry[],
  householdId: string,
): WineCatalogEntry | null {
  if (!suggestion.producer.value || suggestion.vintage.status !== "year" || suggestion.vintage.value === null) {
    return null
  }
  const printedFields = (["cuvee", "appellation", "area"] as const)
    .map((field) => ({ field, value: normalizedWords(suggestion[field].value ?? "").join("") }))
    .filter(({ value }) => value.length > 0)
  const matches = wines.filter((wine) => {
    if (wine.household_id !== householdId || wine.merged_into_wine_id) return false
    if (wine.vintage !== suggestion.vintage.value) return false
    if (similarity(suggestion.producer.value ?? "", wine.producer) < 0.78) return false
    if (suggestion.format_ml.value !== null && suggestion.format_ml.value !== wine.format_ml) return false
    if (suggestion.color.value && suggestion.color.value !== "other"
      && suggestion.color.value !== wine.color
      && suggestion.color.confidence === "high" && suggestion.color.evidence.length > 0) return false

    const cuvee = normalizedWords(wine.cuvee).join("")
    const appellation = normalizedWords(wine.appellation ?? "").join("")
    if (cuvee.length < 5) return false
    const cuveeFields = printedFields.filter(({ value }) => value === cuvee)
    if (cuveeFields.length === 0) return false
    const appellationFields = printedFields.filter(({ value }) => value === appellation
      || isOneEditApart(value, appellation))
    const corroboratedAppellation = appellation.length >= 8
      && cuveeFields.some((cuveeField) => appellationFields.some((appellationField) =>
        cuveeField.field !== appellationField.field))
    if (corroboratedAppellation) return true
    const claimedAppellation = normalizedWords(suggestion.appellation.value ?? "").join("")
    const confidentConflict = wine.appellation && claimedAppellation.length >= 5
      && suggestion.appellation.confidence === "high" && suggestion.appellation.evidence.length > 0
      && claimedAppellation !== cuvee
      && claimedAppellation !== appellation
      && !isOneEditApart(claimedAppellation, appellation)
    return !confidentConflict
  })
  return matches.length === 1 ? matches[0] : null
}

/** Catalogue-first candidates use only text actually read on the label, never an inferred field role. */
export function findCaptureWineMatchesFromTranscript(
  pages: readonly { text: string }[],
  wines: WineCatalogEntry[],
  householdId: string,
): WineCatalogEntry[] {
  const transcript = normalizedWords(pages.map((page) => page.text).join(" ")).join(" ")
  if (!transcript) return []
  const years = new Set((transcript.match(/\b(?:18|19|20)\d{2}\b/gu) ?? []).map(Number))
  return wines
    .filter((wine) => wine.household_id === householdId && !wine.merged_into_wine_id)
    .filter((wine) => containsPrintedPhrase(transcript, wine.producer)
      && containsPrintedPhrase(transcript, wine.cuvee))
    .filter((wine) => years.size === 0 || (years.size === 1 && wine.vintage === [...years][0]))
    .map((wine) => ({
      wine,
      appellationOnLabel: wine.appellation ? containsPrintedPhrase(transcript, wine.appellation) : false,
      vintageOnLabel: wine.vintage !== null && years.has(wine.vintage),
    }))
    .filter((match) => match.appellationOnLabel || match.vintageOnLabel)
    .sort((left, right) => Number(right.appellationOnLabel) - Number(left.appellationOnLabel)
      || Number(right.vintageOnLabel) - Number(left.vintageOnLabel)
      || left.wine.producer.localeCompare(right.wine.producer)
      || left.wine.cuvee.localeCompare(right.wine.cuvee)
      || left.wine.id.localeCompare(right.wine.id))
    .slice(0, 3)
    .map(({ wine }) => wine)
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
