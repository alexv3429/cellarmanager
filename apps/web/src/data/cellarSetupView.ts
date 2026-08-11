import { matchesSearch } from "./searchFilters"

type SyncedBoolean = boolean | number | null | undefined

export interface CellarSetupCellar {
  household_id: string
  id: string
  is_active: SyncedBoolean
  name: string
}

export interface CellarSetupLocation {
  capacity: number | null
  cellar_id: string
  code: string
  display_order: number | null
  household_id: string
  id: string
  is_active: SyncedBoolean
}

export interface CellarSetupHolding {
  location_id: string
  quantity: number
}

export interface CellarSetupLocationSummary
  extends CellarSetupLocation {
  bottleCount: number
}

export interface CellarSetupCellarSummary
  extends CellarSetupCellar {
  archivedLocations: CellarSetupLocationSummary[]
  bottleCount: number
  configuredCapacity: number
  locations: CellarSetupLocationSummary[]
}

export type LocationOccupancyTone =
  | "almost-full"
  | "available"
  | "empty"
  | "full"
  | "over-capacity"
  | "unknown"

export interface LocationOccupancy {
  detail: string
  label: string
  tone: LocationOccupancyTone
}

const setupLabelCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
})

export function isSetupRecordActive(
  value: SyncedBoolean,
): boolean {
  return value !== false && value !== 0
}

function sortLocations(
  locations: CellarSetupLocation[],
): CellarSetupLocation[] {
  const hasCompleteCustomOrder = locations.every(
    (location) => location.display_order !== null,
  )

  return [...locations].sort((left, right) => {
    if (hasCompleteCustomOrder) {
      const order =
        (left.display_order ?? 0) -
        (right.display_order ?? 0)

      if (order !== 0) {
        return order
      }
    }

    return setupLabelCollator.compare(
      left.code,
      right.code,
    )
  })
}

export function buildCellarSetupSummaries({
  cellars,
  holdings,
  locations,
}: {
  cellars: CellarSetupCellar[]
  holdings: CellarSetupHolding[]
  locations: CellarSetupLocation[]
}): CellarSetupCellarSummary[] {
  const bottleCountByLocation = new Map<string, number>()

  for (const holding of holdings) {
    bottleCountByLocation.set(
      holding.location_id,
      (bottleCountByLocation.get(holding.location_id) ?? 0) +
        holding.quantity,
    )
  }

  return [...cellars]
    .sort((left, right) =>
      setupLabelCollator.compare(left.name, right.name),
    )
    .map((cellar) => {
      const cellarLocations = locations.filter(
        (location) => location.cellar_id === cellar.id,
      )

      const summarizeLocation = (
        location: CellarSetupLocation,
      ): CellarSetupLocationSummary => ({
        ...location,
        bottleCount:
          bottleCountByLocation.get(location.id) ?? 0,
      })

      const activeLocations = sortLocations(
        cellarLocations.filter((location) =>
          isSetupRecordActive(location.is_active),
        ),
      ).map(summarizeLocation)

      const archivedLocations = sortLocations(
        cellarLocations.filter(
          (location) =>
            !isSetupRecordActive(location.is_active),
        ),
      ).map(summarizeLocation)

      return {
        ...cellar,
        archivedLocations,
        bottleCount: cellarLocations.reduce(
          (total, location) =>
            total +
            (bottleCountByLocation.get(location.id) ?? 0),
          0,
        ),
        configuredCapacity: activeLocations.reduce(
          (total, location) =>
            total + (location.capacity ?? 0),
          0,
        ),
        locations: activeLocations,
      }
    })
}

export function filterCellarSetupSummaries(
  cellars: CellarSetupCellarSummary[],
  search: string,
): CellarSetupCellarSummary[] {
  return cellars.flatMap((cellar) => {
    if (matchesSearch([cellar.name], search)) {
      return [cellar]
    }

    const matchingLocations = cellar.locations.filter(
      (location) =>
        matchesSearch([location.code], search),
    )

    if (matchingLocations.length === 0) {
      return []
    }

    return [
      {
        ...cellar,
        locations: matchingLocations,
      },
    ]
  })
}

export function moveLocationId(
  locationIds: string[],
  locationId: string,
  direction: -1 | 1,
): string[] {
  const currentIndex = locationIds.indexOf(locationId)
  const nextIndex = currentIndex + direction

  if (
    currentIndex < 0 ||
    nextIndex < 0 ||
    nextIndex >= locationIds.length
  ) {
    return locationIds
  }

  const reordered = [...locationIds]
  const current = reordered[currentIndex]
  const next = reordered[nextIndex]

  if (current === undefined || next === undefined) {
    return locationIds
  }

  reordered[currentIndex] = next
  reordered[nextIndex] = current
  return reordered
}

export function getLocationOccupancy(
  bottleCount: number,
  capacity: number | null,
): LocationOccupancy {
  if (bottleCount === 0) {
    return {
      detail: capacity
        ? `0 / ${capacity} bottles`
        : "0 bottles",
      label: "Empty",
      tone: "empty",
    }
  }

  if (capacity === null) {
    return {
      detail: formatBottleCount(bottleCount),
      label: "Capacity not set",
      tone: "unknown",
    }
  }

  const detail = `${bottleCount} / ${capacity} bottles`

  if (bottleCount > capacity) {
    return {
      detail,
      label: "Over capacity",
      tone: "over-capacity",
    }
  }

  if (bottleCount === capacity) {
    return { detail, label: "Full", tone: "full" }
  }

  if (bottleCount / capacity >= 0.8) {
    return {
      detail,
      label: "Almost full",
      tone: "almost-full",
    }
  }

  return { detail, label: "Available", tone: "available" }
}

export function formatBottleCount(count: number): string {
  return `${count} ${count === 1 ? "bottle" : "bottles"}`
}

export function formatLocationCount(count: number): string {
  return `${count} ${count === 1 ? "location" : "locations"}`
}
