import { matchesSearch } from "./searchFilters"
import { formatWineVolume } from "./wineCatalog"

export interface InventoryBrowseHolding {
  appellation: string | null
  area: string | null
  color: string
  cuvee: string
  format_ml: number
  location_code: string
  location_id: string
  producer: string
  vintage: number | null
}

export interface InventoryBrowseLocation {
  cellar_id: string
  cellar_name: string
  code: string
  id: string
}

interface InventoryBrowseFilters {
  cellarId: string | null
  locationId: string | null
  search: string
}

export function matchesInventoryBrowseFilters(
  holding: InventoryBrowseHolding,
  location: InventoryBrowseLocation | undefined,
  filters: InventoryBrowseFilters,
): boolean {
  if (
    filters.cellarId !== null &&
    location?.cellar_id !== filters.cellarId
  ) {
    return false
  }

  if (
    filters.locationId !== null &&
    holding.location_id !== filters.locationId
  ) {
    return false
  }

  return matchesSearch(
    [
      holding.producer,
      holding.cuvee,
      holding.vintage ?? "NV",
      holding.color,
      holding.appellation,
      holding.area,
      formatWineVolume(holding.format_ml),
      holding.format_ml,
      holding.location_code,
      location?.cellar_name,
    ],
    filters.search,
  )
}
