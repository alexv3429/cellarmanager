export interface WineCatalogEntry {
  id: string
  household_id: string
  producer: string
  cuvee: string
  vintage: number | null
}

export function cleanWineText(value: string): string {
  return value.trim().replace(/\s+/gu, " ")
}

function wineTextKey(value: string): string {
  return cleanWineText(value).toLowerCase()
}

export function parseWineVintage(value: string): number | null {
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
    throw new Error("Vintage must be between 1800 and 2200")
  }

  return vintage
}

export function findExactWine(
  wines: WineCatalogEntry[],
  householdId: string,
  producer: string,
  cuvee: string,
  vintage: number | null,
): WineCatalogEntry | undefined {
  const producerKey = wineTextKey(producer)
  const cuveeKey = wineTextKey(cuvee)

  if (producerKey.length === 0 || cuveeKey.length === 0) {
    return undefined
  }

  return wines.find(
    (wine) =>
      wine.household_id === householdId &&
      wineTextKey(wine.producer) === producerKey &&
      wineTextKey(wine.cuvee) === cuveeKey &&
      wine.vintage === vintage,
  )
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
      .filter((wine) => wine.household_id === householdId)
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
