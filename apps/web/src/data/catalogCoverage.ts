import { normalizeSearchText } from "./searchFilters"
import type { WineFacts } from "./wineFacts"
import type {
  MaturityAssessmentReason,
  MaturityOverviewItem,
} from "./wineMaturity"

export type CoreFactCoverage =
  | "complete"
  | "partial"
  | "missing"

export type ProfileCoverage =
  | "full"
  | "needs-refinement"
  | "unavailable"
  | "pending"

export type CatalogCoverageGap =
  | "fact-country"
  | "fact-grapes"
  | "fact-sweetness"
  | "fact-alcohol"
  | "profile-place"
  | "profile-vintage"
  | "profile-producer"
  | "profile-cuvee"
  | "wine-missing-vintage"
  | "wine-identity-conflict"

export type CatalogCoverageCategory =
  | "household-fact"
  | "shared-profile"
  | "wine-data"

export interface CatalogCoverageWine {
  alcoholPercent: number | null
  appellation: string | null
  area: string | null
  color: string
  cuvee: string
  facts: WineFacts
  id: string
  producer: string
  quantity: number
  vintage: number | null
}

export interface CatalogFactCoverage {
  missingCoreFacts: Array<"country" | "grapes" | "sweetness">
  presentCoreFactCount: number
  status: CoreFactCoverage
}

export interface CatalogProfileCoverage {
  missingLayers: Array<"vintage" | "producer" | "cuvee">
  status: ProfileCoverage
}

export interface CatalogCurationItem {
  bottleCount: number
  category: CatalogCoverageCategory
  detail: string
  gap: CatalogCoverageGap
  id: string
  priority: number
  title: string
  wineCount: number
  wineIds: string[]
}

interface CurationCandidate {
  category: CatalogCoverageCategory
  detail: string
  gap: CatalogCoverageGap
  subjectKey: string
  title: string
  weight: number
  wine: CatalogCoverageWine
}

const PROFILE_LAYERS = {
  vintage: "vintage",
  producer: "producer-era",
  cuvee: "cuvee",
} as const

export function getCatalogFactCoverage(
  facts: WineFacts,
): CatalogFactCoverage {
  const missingCoreFacts: CatalogFactCoverage["missingCoreFacts"] = []

  if (facts.country === null) {
    missingCoreFacts.push("country")
  }
  if (facts.grapeComposition.length === 0) {
    missingCoreFacts.push("grapes")
  }
  if (facts.sweetnessCategory === null) {
    missingCoreFacts.push("sweetness")
  }

  const presentCoreFactCount = 3 - missingCoreFacts.length

  return {
    missingCoreFacts,
    presentCoreFactCount,
    status:
      presentCoreFactCount === 3
        ? "complete"
        : presentCoreFactCount === 0
          ? "missing"
          : "partial",
  }
}

export function getCatalogProfileCoverage(
  maturity: MaturityOverviewItem | undefined,
): CatalogProfileCoverage {
  if (maturity?.assessmentReason) {
    return { missingLayers: [], status: "unavailable" }
  }

  if (!maturity?.state) {
    return { missingLayers: [], status: "pending" }
  }

  const layers = new Set(maturity.profileLayers)
  const missingLayers: CatalogProfileCoverage["missingLayers"] = []

  if (!layers.has(PROFILE_LAYERS.vintage)) {
    missingLayers.push("vintage")
  }
  if (!layers.has(PROFILE_LAYERS.producer)) {
    missingLayers.push("producer")
  }
  if (!layers.has(PROFILE_LAYERS.cuvee)) {
    missingLayers.push("cuvee")
  }

  return {
    missingLayers,
    status: missingLayers.length === 0 ? "full" : "needs-refinement",
  }
}

export function profileCoverageLabel(
  maturity: MaturityOverviewItem | undefined,
): string {
  const coverage = getCatalogProfileCoverage(maturity)

  switch (coverage.status) {
    case "full":
      return "Vintage, producer, and cuvée profiles"
    case "needs-refinement":
      return `Needs ${coverage.missingLayers.join(", ")}`
    case "unavailable":
      return "Profile unavailable"
    case "pending":
      return "Profile pending"
  }
}

function identityKey(values: Array<string | number | null>): string {
  return values
    .map((value) => normalizeSearchText(String(value ?? "")))
    .join("|")
}

function wineLabel(wine: CatalogCoverageWine): string {
  return `${wine.producer} — ${wine.cuvee}`
}

function placeLabel(wine: CatalogCoverageWine): string {
  return wine.appellation ?? wine.area ?? "Unknown place"
}

function factCandidate(
  wine: CatalogCoverageWine,
  gap: Extract<
    CatalogCoverageGap,
    "fact-country" | "fact-grapes" | "fact-sweetness" | "fact-alcohol"
  >,
  fieldLabel: string,
  weight: number,
): CurationCandidate {
  return {
    category: "household-fact",
    detail: "Attributable fact suggestion needed; nothing will be saved automatically.",
    gap,
    subjectKey: identityKey([
      wine.producer,
      wine.cuvee,
      wine.vintage,
      wine.color,
    ]),
    title: `${fieldLabel}: ${wineLabel(wine)}`,
    weight,
    wine,
  }
}

function assessmentCandidate(
  wine: CatalogCoverageWine,
  reason: MaturityAssessmentReason,
): CurationCandidate | null {
  if (reason === "unsupported-place-profile") {
    return {
      category: "shared-profile",
      detail: "A reviewed place-and-color baseline is required before guidance can be calculated.",
      gap: "profile-place",
      subjectKey: identityKey([placeLabel(wine), wine.color]),
      title: `Add place profile: ${placeLabel(wine)} · ${wine.color}`,
      weight: 100,
      wine,
    }
  }

  if (reason === "missing-vintage") {
    return {
      category: "wine-data",
      detail: "Add a vintage or another safe date anchor to this household wine.",
      gap: "wine-missing-vintage",
      subjectKey: identityKey([wine.id]),
      title: `Add a date anchor: ${wineLabel(wine)}`,
      weight: 95,
      wine,
    }
  }

  if (reason === "appellation-color-conflict") {
    return {
      category: "wine-data",
      detail: "Check the stored appellation and color before requesting new shared knowledge.",
      gap: "wine-identity-conflict",
      subjectKey: identityKey([wine.id]),
      title: `Check identity: ${wineLabel(wine)}`,
      weight: 100,
      wine,
    }
  }

  return null
}

function profileCandidates(
  wine: CatalogCoverageWine,
  maturity: MaturityOverviewItem,
): CurationCandidate[] {
  const coverage = getCatalogProfileCoverage(maturity)

  return coverage.missingLayers.map((layer): CurationCandidate => {
    switch (layer) {
      case "vintage":
        return {
          category: "shared-profile",
          detail: "The current estimate has no reviewed local vintage contribution.",
          gap: "profile-vintage",
          subjectKey: identityKey([
            placeLabel(wine),
            wine.vintage,
            wine.color,
          ]),
          title: `Add vintage profile: ${placeLabel(wine)} ${wine.vintage} · ${wine.color}`,
          weight: 80,
          wine,
        }
      case "producer":
        return {
          category: "shared-profile",
          detail: "The estimate currently relies on place and vintage without a reviewed producer era.",
          gap: "profile-producer",
          subjectKey: identityKey([wine.producer, wine.color]),
          title: `Add producer profile: ${wine.producer} · ${wine.color}`,
          weight: 70,
          wine,
        }
      case "cuvee":
        return {
          category: "shared-profile",
          detail: "The estimate has no confirmed cuvée or climat contribution.",
          gap: "profile-cuvee",
          subjectKey: identityKey([
            wine.producer,
            wine.cuvee,
            wine.color,
          ]),
          title: `Add cuvée profile: ${wineLabel(wine)} · ${wine.color}`,
          weight: 60,
          wine,
        }
    }
  })
}

export function buildCatalogCurationQueue(
  wines: CatalogCoverageWine[],
  maturityByWineId: ReadonlyMap<string, MaturityOverviewItem>,
): CatalogCurationItem[] {
  const candidates: CurationCandidate[] = []

  for (const wine of wines) {
    const factCoverage = getCatalogFactCoverage(wine.facts)

    if (factCoverage.missingCoreFacts.includes("country")) {
      candidates.push(factCandidate(wine, "fact-country", "Country", 30))
    }
    if (factCoverage.missingCoreFacts.includes("grapes")) {
      candidates.push(factCandidate(wine, "fact-grapes", "Grapes", 50))
    }
    if (factCoverage.missingCoreFacts.includes("sweetness")) {
      candidates.push(factCandidate(wine, "fact-sweetness", "Sweetness", 45))
    }
    if (wine.alcoholPercent === null) {
      candidates.push(factCandidate(wine, "fact-alcohol", "Label alcohol", 15))
    }

    const maturity = maturityByWineId.get(wine.id)
    if (!maturity) {
      continue
    }

    if (maturity.assessmentReason) {
      const candidate = assessmentCandidate(wine, maturity.assessmentReason)
      if (candidate) {
        candidates.push(candidate)
      }
      continue
    }

    if (maturity.state) {
      candidates.push(...profileCandidates(wine, maturity))
    }
  }

  const grouped = new Map<
    string,
    Omit<CatalogCurationItem, "bottleCount" | "priority" | "wineCount" | "wineIds"> & {
      weight: number
      wines: Map<string, CatalogCoverageWine>
    }
  >()

  for (const candidate of candidates) {
    const id = `${candidate.gap}:${candidate.subjectKey}`
    const existing = grouped.get(id)

    if (existing) {
      existing.wines.set(candidate.wine.id, candidate.wine)
      continue
    }

    grouped.set(id, {
      category: candidate.category,
      detail: candidate.detail,
      gap: candidate.gap,
      id,
      title: candidate.title,
      weight: candidate.weight,
      wines: new Map([[candidate.wine.id, candidate.wine]]),
    })
  }

  return [...grouped.values()]
    .map((item): CatalogCurationItem => {
      const winesForItem = [...item.wines.values()]
      const bottleCount = winesForItem.reduce(
        (sum, wine) => sum + wine.quantity,
        0,
      )

      return {
        bottleCount,
        category: item.category,
        detail: item.detail,
        gap: item.gap,
        id: item.id,
        priority:
          bottleCount * 100 + winesForItem.length * 10 + item.weight,
        title: item.title,
        wineCount: winesForItem.length,
        wineIds: winesForItem.map((wine) => wine.id),
      }
    })
    .sort(
      (left, right) =>
        right.priority - left.priority || left.title.localeCompare(right.title),
    )
}
