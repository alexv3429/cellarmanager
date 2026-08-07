import type { WineCatalogEntry } from "./wineCatalog"

export interface InventoryLocation {
  id: string
  household_id: string
  code: string
}

export interface AuthoritativeHolding {
  id: string
  household_id: string
  wine_id: string
  location_id: string
  producer: string
  cuvee: string
  vintage: number | null
  location_code: string
  quantity: number
  revision: number
}

export interface InventoryOperation {
  id: string
  household_id?: string
  operation_type: "ADD" | "MOVE" | "REMOVE"
  wine_id: string
  wine_producer?: string | null
  wine_cuvee?: string | null
  wine_vintage?: number | null
  source_location_id: string | null
  destination_location_id: string | null
  quantity: number
  status: string
}

export interface ProjectedHolding
  extends Omit<AuthoritativeHolding, "quantity"> {
  authoritative_quantity: number
  pending_delta: number
  pending_operation_count: number
  quantity: number
}

interface ProjectionInput {
  holdings: AuthoritativeHolding[]
  locations: InventoryLocation[]
  operations: InventoryOperation[]
  wines?: WineCatalogEntry[]
}

interface WineTemplate {
  household_id: string
  producer: string
  cuvee: string
  vintage: number | null
}

function positionKey(
  wineId: string,
  locationId: string,
): string {
  return `${wineId}:${locationId}`
}

export function projectHoldings({
  holdings,
  locations,
  operations,
  wines = [],
}: ProjectionInput): ProjectedHolding[] {
  const locationsById = new Map(
    locations.map((location) => [location.id, location]),
  )

  const wineTemplates = new Map<
    string,
    WineTemplate
  >()

  for (const wine of wines) {
    wineTemplates.set(wine.id, {
      household_id: wine.household_id,
      producer: wine.producer,
      cuvee: wine.cuvee,
      vintage: wine.vintage,
    })
  }

  const projectedByPosition = new Map<
    string,
    ProjectedHolding
  >()

  for (const holding of holdings) {
    wineTemplates.set(holding.wine_id, {
      household_id: holding.household_id,
      producer: holding.producer,
      cuvee: holding.cuvee,
      vintage: holding.vintage,
    })

    projectedByPosition.set(
      positionKey(
        holding.wine_id,
        holding.location_id,
      ),
      {
        ...holding,
        authoritative_quantity: holding.quantity,
        pending_delta: 0,
        pending_operation_count: 0,
        quantity: holding.quantity,
      },
    )
  }

  for (const operation of operations) {
    if (
      operation.status !== "PENDING" ||
      operation.operation_type !== "ADD" ||
      !operation.wine_producer ||
      !operation.wine_cuvee ||
      wineTemplates.has(operation.wine_id)
    ) {
      continue
    }

    const destination =
      operation.destination_location_id
        ? locationsById.get(
            operation.destination_location_id,
          )
        : undefined

    const householdId =
      operation.household_id ??
      destination?.household_id

    if (!householdId) {
      continue
    }

    wineTemplates.set(operation.wine_id, {
      household_id: householdId,
      producer: operation.wine_producer,
      cuvee: operation.wine_cuvee,
      vintage: operation.wine_vintage ?? null,
    })
  }

  function ensurePosition(
    wineId: string,
    locationId: string,
  ): ProjectedHolding | undefined {
    const key = positionKey(wineId, locationId)
    const existing = projectedByPosition.get(key)

    if (existing) {
      return existing
    }

    const wineTemplate = wineTemplates.get(wineId)
    const location = locationsById.get(locationId)

    if (
      !wineTemplate ||
      !location ||
      location.household_id !==
        wineTemplate.household_id
    ) {
      return undefined
    }

    const projected: ProjectedHolding = {
      id: `optimistic:${wineId}:${locationId}`,
      household_id: wineTemplate.household_id,
      wine_id: wineId,
      location_id: locationId,
      producer: wineTemplate.producer,
      cuvee: wineTemplate.cuvee,
      vintage: wineTemplate.vintage,
      location_code: location.code,
      authoritative_quantity: 0,
      pending_delta: 0,
      pending_operation_count: 0,
      quantity: 0,
      revision: 0,
    }

    projectedByPosition.set(key, projected)
    return projected
  }

  function applyPendingDelta(
    wineId: string,
    locationId: string,
    delta: number,
  ): void {
    const position = ensurePosition(
      wineId,
      locationId,
    )

    if (!position) {
      return
    }

    position.pending_delta += delta
    position.pending_operation_count += 1
  }

  for (const operation of operations) {
    if (
      operation.status !== "PENDING" ||
      !Number.isInteger(operation.quantity) ||
      operation.quantity <= 0
    ) {
      continue
    }

    if (operation.operation_type === "ADD") {
      if (operation.destination_location_id) {
        applyPendingDelta(
          operation.wine_id,
          operation.destination_location_id,
          operation.quantity,
        )
      }

      continue
    }

    if (operation.source_location_id) {
      applyPendingDelta(
        operation.wine_id,
        operation.source_location_id,
        -operation.quantity,
      )
    }

    if (
      operation.operation_type === "MOVE" &&
      operation.destination_location_id
    ) {
      applyPendingDelta(
        operation.wine_id,
        operation.destination_location_id,
        operation.quantity,
      )
    }
  }

  return [...projectedByPosition.values()]
    .map((holding) => ({
      ...holding,
      quantity: Math.max(
        0,
        holding.authoritative_quantity +
          holding.pending_delta,
      ),
    }))
    .filter(
      (holding) =>
        holding.quantity > 0 ||
        holding.pending_operation_count > 0,
    )
    .sort((left, right) => {
      const producerOrder =
        left.producer.localeCompare(right.producer)

      if (producerOrder !== 0) {
        return producerOrder
      }

      const cuveeOrder =
        left.cuvee.localeCompare(right.cuvee)

      if (cuveeOrder !== 0) {
        return cuveeOrder
      }

      const vintageOrder =
        (left.vintage ?? Number.NEGATIVE_INFINITY) -
        (right.vintage ?? Number.NEGATIVE_INFINITY)

      if (vintageOrder !== 0) {
        return vintageOrder
      }

      return left.location_code.localeCompare(
        right.location_code,
      )
    })
}
