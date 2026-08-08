export interface WineCatalogEntry {
  id: string
  household_id: string
  producer: string
  cuvee: string
  vintage: number | null
  color: string
  appellation: string | null
  area: string | null
  format_ml: number
}

export function cleanWineText(value: string): string {
  return value.trim().replace(/\s+/gu, " ")
}

function wineTextKey(value: string): string {
  return cleanWineText(value).toLowerCase()
}

export function parseWineVintage(
  value: string,
): number | null {
  const cleaned = value.trim()

  if (cleaned.length === 0) {
    return null
  }

  if (!/^\d{4}$/u.test(cleaned)) {
    throw new Error(
      "Vintage must be a four-digit year or blank for NV",
    )
  }

  const vintage = Number(cleaned)

  if (vintage < 1800 || vintage > 2200) {
    throw new Error(
      "Vintage must be between 1800 and 2200",
    )
  }

  return vintage
}

export function parseWineFormatMl(value: string): number {
  const cleaned = value.trim()

  if (!/^\d+$/u.test(cleaned)) {
    throw new Error(
      "Bottle format must be a positive whole number of millilitres",
    )
  }

  const formatMl = Number(cleaned)

  if (!Number.isSafeInteger(formatMl) || formatMl <= 0) {
    throw new Error(
      "Bottle format must be a positive whole number of millilitres",
    )
  }

  return formatMl
}

export function formatWineVolume(formatMl: number): string {
  if (formatMl % 10 === 0) {
    return `${formatMl / 10} cl`
  }

  return `${formatMl} ml`
}

export function findMatchingWines(
  wines: WineCatalogEntry[],
  householdId: string,
  producer: string,
  cuvee: string,
  vintage: number | null,
  color: string,
  formatMl: number,
): WineCatalogEntry[] {
  const producerKey = wineTextKey(producer)
  const cuveeKey = wineTextKey(cuvee)
  const colorKey = wineTextKey(color)

  if (
    producerKey.length === 0 ||
    cuveeKey.length === 0 ||
    colorKey.length === 0 ||
    formatMl <= 0
  ) {
    return []
  }

  return wines.filter(
    (wine) =>
      wine.household_id === householdId &&
      wineTextKey(wine.producer) === producerKey &&
      wineTextKey(wine.cuvee) === cuveeKey &&
      wine.vintage === vintage &&
      wineTextKey(wine.color) === colorKey &&
      wine.format_ml === formatMl,
  )
}

export function findExactWine(
  wines: WineCatalogEntry[],
  householdId: string,
  producer: string,
  cuvee: string,
  vintage: number | null,
  color: string,
  formatMl: number,
): WineCatalogEntry | undefined {
  const matches = findMatchingWines(
    wines,
    householdId,
    producer,
    cuvee,
    vintage,
    color,
    formatMl,
  )

  return matches.length === 1 ? matches[0] : undefined
}

function distinctSorted(values: string[]): string[] {
  const byKey = new Map<string, string>()

  for (const value of values) {
    const cleaned = cleanWineText(value)
    const key = wineTextKey(cleaned)

    if (key.length > 0 && !byKey.has(key)) {
      byKey.set(key, cleaned)
    }
  }

  return [...byKey.values()].sort((left, right) =>
    left.localeCompare(right),
  )
}

export function getProducerSuggestions(
  wines: WineCatalogEntry[],
  householdId: string,
): string[] {
  return distinctSorted(
    wines
      .filter(
        (wine) => wine.household_id === householdId,
      )
      .map((wine) => wine.producer),
  )
}

export function getCuveeSuggestions(
  wines: WineCatalogEntry[],
  householdId: string,
  producer: string,
): string[] {
  const producerKey = wineTextKey(producer)

  if (producerKey.length === 0) {
    return []
  }

  return distinctSorted(
    wines
      .filter(
        (wine) =>
          wine.household_id === householdId &&
          wineTextKey(wine.producer) === producerKey,
      )
      .map((wine) => wine.cuvee),
  )
}

function metadataSuggestions(
  wines: WineCatalogEntry[],
  householdId: string,
  producer: string,
  cuvee: string,
  field: "appellation" | "area",
): string[] {
  const producerKey = wineTextKey(producer)
  const cuveeKey = wineTextKey(cuvee)

  return distinctSorted(
    wines
      .filter((wine) => {
        if (wine.household_id !== householdId) {
          return false
        }

        if (
          producerKey.length > 0 &&
          wineTextKey(wine.producer) !== producerKey
        ) {
          return false
        }

        if (
          cuveeKey.length > 0 &&
          wineTextKey(wine.cuvee) !== cuveeKey
        ) {
          return false
        }

        return wine[field] !== null
      })
      .map((wine) => wine[field] ?? ""),
  )
}

export function getAppellationSuggestions(
  wines: WineCatalogEntry[],
  householdId: string,
  producer: string,
  cuvee: string,
): string[] {
  return metadataSuggestions(
    wines,
    householdId,
    producer,
    cuvee,
    "appellation",
  )
}

export function getAreaSuggestions(
  wines: WineCatalogEntry[],
  householdId: string,
  producer: string,
  cuvee: string,
): string[] {
  return metadataSuggestions(
    wines,
    householdId,
    producer,
    cuvee,
    "area",
  )
}

export function getVintageSuggestions(
  wines: WineCatalogEntry[],
  householdId: string,
  producer: string,
  cuvee: string,
): number[] {
  const producerKey = wineTextKey(producer)
  const cuveeKey = wineTextKey(cuvee)

  if (producerKey.length === 0 || cuveeKey.length === 0) {
    return []
  }

  return [
    ...new Set(
      wines
        .filter(
          (wine) =>
            wine.household_id === householdId &&
            wineTextKey(wine.producer) === producerKey &&
            wineTextKey(wine.cuvee) === cuveeKey &&
            wine.vintage !== null,
        )
        .map((wine) => wine.vintage as number),
    ),
  ].sort((left, right) => right - left)
}
