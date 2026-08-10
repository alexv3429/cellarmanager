import { useQuery } from "@powersync/react"
import {
  type FormEvent,
  useMemo,
  useState,
} from "react"

import {
  type AuthoritativeHolding,
  type InventoryLocation,
  type InventoryOperation,
  type ProjectedHolding,
  projectHoldings,
} from "../data/inventoryProjection"
import { matchesSearch } from "../data/searchFilters"
import {
  cleanWineText,
  findExactWine,
  findMatchingWines,
  formatWineVolume,
  getAppellationSuggestions,
  getAreaSuggestions,
  getCuveeSuggestions,
  getProducerSuggestions,
  getVintageSuggestions,
  parseWineFormatMl,
  parseWineVintage,
  type WineCatalogEntry,
} from "../data/wineCatalog"
import type {
  RegisteredDevicesState,
} from "../devices/useRegisteredDevices"
import {
  queueAdd,
  queueMove,
  queueRemove,
  type QueueAddInput,
  type QueueMoveInput,
  type QueueRemoveInput,
  type RemoveReason,
} from "../data/powersync/inventoryOperations"
import { Notice } from "./Notice"

interface HoldingsViewProps {
  userId: string
  householdId: string
  deviceRegistration: RegisteredDevicesState
}

type HoldingRow = ProjectedHolding

interface InventoryLocationRow extends InventoryLocation {
  cellar_name: string
}

interface InventoryOperationRow {
  id: string
  operation_type: string
  source_code: string | null
  source_cellar_name: string | null
  destination_code: string | null
  destination_cellar_name: string | null
  quantity: number
  remove_reason: string | null
  status: string
  error_code: string | null
  created_at_client: string
}

const HOLDINGS_QUERY = `
  select
    h.id,
    h.household_id,
    h.wine_id,
    h.location_id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color,
    w.appellation,
    w.area,
    w.format_ml,
    l.code as location_code,
    h.quantity,
    h.revision
  from holdings h
  join wines w on w.id = h.wine_id
  join locations l on l.id = h.location_id
  where h.household_id = ?
  order by
    w.producer,
    w.cuvee,
    w.vintage,
    l.code
`

const LOCATIONS_QUERY = `
  select
    l.id,
    l.household_id,
    l.code,
    c.name as cellar_name
  from locations l
  join cellars c on c.id = l.cellar_id
  where l.household_id = ?
  order by c.name, l.code
`

const WINE_CATALOG_QUERY = `
  select
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    format_ml
  from wines
  where household_id = ?
  order by producer, cuvee, vintage
`

const PENDING_OPERATIONS_QUERY = `
  select
    id,
    household_id,
    operation_type,
    wine_id,
    wine_producer,
    wine_cuvee,
    wine_vintage,
    wine_color,
    wine_appellation,
    wine_area,
    wine_format_ml,
    source_location_id,
    destination_location_id,
    quantity,
    status
  from inventory_operations
  where household_id = ?
    and status = 'PENDING'
    and operation_type in ('ADD', 'MOVE', 'REMOVE')
`

const OPERATIONS_QUERY = `
  select
    operation.id,
    operation.operation_type,
    source.code as source_code,
    source_cellar.name as source_cellar_name,
    destination.code as destination_code,
    destination_cellar.name as destination_cellar_name,
    operation.quantity,
    operation.remove_reason,
    operation.status,
    operation.error_code,
    operation.created_at_client
  from inventory_operations operation
  left join locations source
    on source.id = operation.source_location_id
  left join cellars source_cellar
    on source_cellar.id = source.cellar_id
  left join locations destination
    on destination.id = operation.destination_location_id
  left join cellars destination_cellar
    on destination_cellar.id = destination.cellar_id
  where operation.household_id = ?
  order by operation.created_at_client desc
  limit 10
`

function locationLabel(
  location: InventoryLocationRow,
): string {
  return `${location.cellar_name} / ${location.code}`
}

function operationLocationLabel(
  cellarName: string | null,
  code: string | null,
): string {
  if (!code) {
    return "—"
  }

  return cellarName
    ? `${cellarName} / ${code}`
    : code
}

function parseActionQuantity(
  value: string,
  available: number,
): number | null {
  const quantity = Number(value)

  if (
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    quantity > available
  ) {
    return null
  }

  return quantity
}

export function HoldingsView({
  userId,
  householdId,
  deviceRegistration,
}: HoldingsViewProps) {

  const {
    data: authoritativeHoldings,
    error: holdingsError,
    isLoading: holdingsLoading,
    isFetching,
  } = useQuery<AuthoritativeHolding>(
    HOLDINGS_QUERY,
    [householdId],
  )

  const {
    data: locations,
    error: locationsError,
    isLoading: locationsLoading,
  } = useQuery<InventoryLocationRow>(
    LOCATIONS_QUERY,
    [householdId],
  )

  const {
    data: wines,
    error: winesError,
    isLoading: winesLoading,
  } = useQuery<WineCatalogEntry>(
    WINE_CATALOG_QUERY,
    [householdId],
  )

  const {
    data: pendingOperations,
    error: pendingOperationsError,
    isLoading: pendingOperationsLoading,
  } = useQuery<InventoryOperation>(
    PENDING_OPERATIONS_QUERY,
    [householdId],
  )

  const { data: operations } =
    useQuery<InventoryOperationRow>(
      OPERATIONS_QUERY,
      [householdId],
    )

  const holdings = useMemo(
    () =>
      projectHoldings({
        holdings: authoritativeHoldings,
        locations,
        operations: pendingOperations,
        wines,
      }),
    [
      authoritativeHoldings,
      locations,
      pendingOperations,
      wines,
    ],
  )

  const locationsById = useMemo(
    () =>
      new Map(
        locations.map((location) => [
          location.id,
          location,
        ]),
      ),
    [locations],
  )

  const pendingNewWineIds = useMemo(
    () =>
      new Set(
        pendingOperations
          .filter(
            (operation) =>
              operation.operation_type === "ADD" &&
              operation.status === "PENDING" &&
              Boolean(operation.wine_producer) &&
              Boolean(operation.wine_cuvee),
          )
          .map((operation) => operation.wine_id),
      ),
    [pendingOperations],
  )

  const error =
    holdingsError ??
    locationsError ??
    winesError ??
    pendingOperationsError

  const isLoading =
    holdingsLoading ||
    locationsLoading ||
    winesLoading ||
    pendingOperationsLoading

  const [inventorySearch, setInventorySearch] =
    useState("")
  const [locationFilter, setLocationFilter] =
    useState("ALL")

  const visibleHoldings = useMemo(
    () =>
      holdings.filter((holding) => {
        if (
          locationFilter !== "ALL" &&
          holding.location_id !== locationFilter
        ) {
          return false
        }

        const location =
          locationsById.get(holding.location_id)

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
          inventorySearch,
        )
      }),
    [
      holdings,
      inventorySearch,
      locationFilter,
      locationsById,
    ],
  )

  const totalBottleCount = holdings.reduce(
    (sum, holding) => sum + holding.quantity,
    0,
  )

  const visibleBottleCount = visibleHoldings.reduce(
    (sum, holding) => sum + holding.quantity,
    0,
  )

  const totalWineCount = new Set(
    holdings.map((holding) => holding.wine_id),
  ).size

  const visibleWineCount = new Set(
    visibleHoldings.map((holding) => holding.wine_id),
  ).size

  const hasInventoryFilters =
    inventorySearch.trim().length > 0 ||
    locationFilter !== "ALL"

  const [addProducer, setAddProducer] = useState("")
  const [addCuvee, setAddCuvee] = useState("")
  const [addVintage, setAddVintage] = useState("")
  const [addColor, setAddColor] = useState("")
  const [addAppellation, setAddAppellation] = useState("")
  const [addArea, setAddArea] = useState("")
  const [addFormatMl, setAddFormatMl] = useState("750")
  const [addQuantity, setAddQuantity] = useState("1")
  const [addLocationId, setAddLocationId] = useState("")
  const [adding, setAdding] = useState(false)

  const selectedAddLocationId =
    addLocationId || locations[0]?.id || ""

  const selectedAddLocation = locations.find(
    (location) => location.id === selectedAddLocationId,
  )

  const selectedAddHouseholdId =
    selectedAddLocation?.household_id ?? ""

  const cleanedAddProducer = cleanWineText(addProducer)
  const cleanedAddCuvee = cleanWineText(addCuvee)

  let parsedAddVintage: number | null = null
  let addVintageError: string | null = null

  try {
    parsedAddVintage = parseWineVintage(addVintage)
  } catch (caughtError: unknown) {
    addVintageError =
      caughtError instanceof Error
        ? caughtError.message
        : "Invalid vintage"
  }

  let parsedAddFormatMl = 750
  let addFormatError: string | null = null

  try {
    parsedAddFormatMl = parseWineFormatMl(addFormatMl)
  } catch (caughtError: unknown) {
    addFormatError =
      caughtError instanceof Error
        ? caughtError.message
        : "Invalid bottle format"
  }

  const matchingWineCandidates =
    selectedAddLocation &&
    cleanedAddProducer.length > 0 &&
    cleanedAddCuvee.length > 0 &&
    addColor.length > 0 &&
    addVintageError === null &&
    addFormatError === null
      ? findMatchingWines(
          wines,
          selectedAddHouseholdId,
          cleanedAddProducer,
          cleanedAddCuvee,
          parsedAddVintage,
          addColor,
          parsedAddFormatMl,
        )
      : []

  const matchingWine =
    matchingWineCandidates.length === 1
      ? findExactWine(
          wines,
          selectedAddHouseholdId,
          cleanedAddProducer,
          cleanedAddCuvee,
          parsedAddVintage,
          addColor,
          parsedAddFormatMl,
        )
      : undefined

  const ambiguousWineIdentity =
    matchingWineCandidates.length > 1

  const producerSuggestions = getProducerSuggestions(
    wines,
    selectedAddHouseholdId,
  )

  const cuveeSuggestions = getCuveeSuggestions(
    wines,
    selectedAddHouseholdId,
    addProducer,
  )

  const vintageSuggestions = getVintageSuggestions(
    wines,
    selectedAddHouseholdId,
    addProducer,
    addCuvee,
  )

  const appellationSuggestions = getAppellationSuggestions(
    wines,
    selectedAddHouseholdId,
    addProducer,
    addCuvee,
  )

  const areaSuggestions = getAreaSuggestions(
    wines,
    selectedAddHouseholdId,
    addProducer,
    addCuvee,
  )

  const [destinationByHolding, setDestinationByHolding] =
    useState<Record<string, string>>({})

  const [moveQuantityByHolding, setMoveQuantityByHolding] =
    useState<Record<string, string>>({})

  const [removeQuantityByHolding, setRemoveQuantityByHolding] =
    useState<Record<string, string>>({})

  const [movingHoldingId, setMovingHoldingId] =
    useState<string | null>(null)

  const [removingHoldingId, setRemovingHoldingId] =
    useState<string | null>(null)

  const [removeReasonByHolding, setRemoveReasonByHolding] =
    useState<Record<string, RemoveReason>>({})

  const [operationMessage, setOperationMessage] =
    useState<string | null>(null)

  const [operationError, setOperationError] =
    useState<string | null>(null)

  async function handleAdd(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    setOperationMessage(null)
    setOperationError(null)

    if (!selectedAddLocation) {
      setOperationError("Select a destination location")
      return
    }

    if (
      cleanedAddProducer.length === 0 ||
      cleanedAddCuvee.length === 0
    ) {
      setOperationError(
        "Producer and cuvée are required",
      )
      return
    }

    if (addVintageError !== null) {
      setOperationError(addVintageError)
      return
    }

    if (addColor.length === 0) {
      setOperationError("Select a wine color")
      return
    }

    if (addFormatError !== null) {
      setOperationError(addFormatError)
      return
    }

    if (ambiguousWineIdentity) {
      setOperationError(
        "Multiple catalog wines share this identity. Select the existing reference explicitly before adding stock.",
      )
      return
    }

    const quantity = Number(addQuantity)

    if (
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      setOperationError(
        "Quantity must be a positive integer",
      )
      return
    }

    const deviceId =
      deviceRegistration.deviceIdByHousehold[
        selectedAddLocation.household_id
      ]

    if (!deviceId) {
      setOperationError(
        "This browser is not registered for this household yet",
      )
      return
    }

    const existingWine = findExactWine(
      wines,
      selectedAddLocation.household_id,
      cleanedAddProducer,
      cleanedAddCuvee,
      parsedAddVintage,
      addColor,
      parsedAddFormatMl,
    )

    const add: QueueAddInput = existingWine
      ? {
          householdId: selectedAddLocation.household_id,
          deviceId,
          userId,
          wineId: existingWine.id,
          destinationLocationId: selectedAddLocation.id,
          quantity,
        }
      : {
          householdId: selectedAddLocation.household_id,
          deviceId,
          userId,
          wineId: crypto.randomUUID(),
          destinationLocationId: selectedAddLocation.id,
          quantity,
          wineProducer: cleanedAddProducer,
          wineCuvee: cleanedAddCuvee,
          wineVintage: parsedAddVintage,
          wineColor: addColor,
          wineAppellation:
            cleanWineText(addAppellation) || null,
          wineArea: cleanWineText(addArea) || null,
          wineFormatMl: parsedAddFormatMl,
        }

    setAdding(true)

    try {
      const operationId = await queueAdd(add)

      setOperationMessage(
        `Add ${operationId.slice(0, 8)} queued locally`,
      )

      setAddProducer("")
      setAddCuvee("")
      setAddVintage("")
      setAddColor("")
      setAddAppellation("")
      setAddArea("")
      setAddFormatMl("750")
      setAddQuantity("1")
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue add",
      )
    } finally {
      setAdding(false)
    }
  }

  async function handleMove(
    holding: HoldingRow,
    quantity: number,
  ) {
    setOperationMessage(null)
    setOperationError(null)

    const possibleDestinations = locations.filter(
      (location) =>
        location.household_id === holding.household_id &&
        location.id !== holding.location_id,
    )

    const destinationLocationId =
      destinationByHolding[holding.id] ??
      possibleDestinations[0]?.id

    const deviceId =
      deviceRegistration.deviceIdByHousehold[
        holding.household_id
      ]

    if (!destinationLocationId) {
      setOperationError("No destination location is available")
      return
    }

    if (!deviceId) {
      setOperationError(
        "This browser is not registered for this household yet",
      )
      return
    }

    const move: QueueMoveInput = {
      householdId: holding.household_id,
      deviceId,
      userId,
      wineId: holding.wine_id,
      sourceLocationId: holding.location_id,
      destinationLocationId,
      quantity,
    }

    setMovingHoldingId(holding.id)

    try {
      const operationId = await queueMove(move)
      setOperationMessage(
        `Move ${quantity} bottle${quantity === 1 ? "" : "s"} (${operationId.slice(0, 8)}) queued locally`,
      )
      setMoveQuantityByHolding(
        (currentQuantities) => ({
          ...currentQuantities,
          [holding.id]: "1",
        }),
      )
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue move",
      )
    } finally {
      setMovingHoldingId(null)
    }
  }

  async function handleRemove(
    holding: HoldingRow,
    quantity: number,
  ) {
    setOperationMessage(null)
    setOperationError(null)

    const deviceId =
      deviceRegistration.deviceIdByHousehold[
        holding.household_id
      ]

    if (!deviceId) {
      setOperationError(
        "This browser is not registered for this household yet",
      )
      return
    }

    const removeReason =
      removeReasonByHolding[holding.id] ?? "DRANK"

    const remove: QueueRemoveInput = {
      householdId: holding.household_id,
      deviceId,
      userId,
      wineId: holding.wine_id,
      sourceLocationId: holding.location_id,
      quantity,
      removeReason,
    }

    setRemovingHoldingId(holding.id)

    try {
      const operationId = await queueRemove(remove)

      setOperationMessage(
        `Remove ${quantity} bottle${quantity === 1 ? "" : "s"} (${operationId.slice(0, 8)}) queued locally`,
      )
      setRemoveQuantityByHolding(
        (currentQuantities) => ({
          ...currentQuantities,
          [holding.id]: "1",
        }),
      )
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue removal",
      )
    } finally {
      setRemovingHoldingId(null)
    }
  }

  return (
    <main>
      <h1>Inventory</h1>

      <h2>Add bottles</h2>

      {isLoading ? (
        <Notice>Opening local database…</Notice>
      ) : null}

      {isFetching && !isLoading ? (
        <Notice>Refreshing holdings…</Notice>
      ) : null}

      {error ? (
        <Notice role="alert" tone="error">
          {String(error)}
        </Notice>
      ) : null}

      {operationMessage ? (
        <Notice role="status" tone="success">
          {operationMessage}
        </Notice>
      ) : null}

      {operationError ? (
        <Notice role="alert" tone="error">
          {operationError}
        </Notice>
      ) : null}

      <form className="add-bottles-form" onSubmit={(event) => void handleAdd(event)}>
        <label>
          Producer / winery
          <input
            list="add-producer-suggestions"
            onChange={(event) =>
              setAddProducer(event.target.value)
            }
            required
            value={addProducer}
          />
        </label>

        <datalist id="add-producer-suggestions">
          {producerSuggestions.map((producer) => (
            <option key={producer} value={producer} />
          ))}
        </datalist>

        <label>
          Cuvée
          <input
            list="add-cuvee-suggestions"
            onChange={(event) =>
              setAddCuvee(event.target.value)
            }
            required
            value={addCuvee}
          />
        </label>

        <datalist id="add-cuvee-suggestions">
          {cuveeSuggestions.map((cuvee) => (
            <option key={cuvee} value={cuvee} />
          ))}
        </datalist>

        <label>
          Vintage
          <input
            inputMode="numeric"
            list="add-vintage-suggestions"
            onChange={(event) =>
              setAddVintage(event.target.value)
            }
            placeholder="NV"
            value={addVintage}
          />
        </label>

        <datalist id="add-vintage-suggestions">
          {vintageSuggestions.map((vintage) => (
            <option
              key={vintage}
              value={String(vintage)}
            />
          ))}
        </datalist>

        <label>
          Color
          <select
            onChange={(event) =>
              setAddColor(event.target.value)
            }
            required
            value={addColor}
          >
            <option value="">Select color…</option>
            <option value="red">Red</option>
            <option value="white">White</option>
            <option value="rose">Rosé</option>
            <option value="sparkling">Sparkling</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label>
          Appellation
          <input
            list="add-appellation-suggestions"
            onChange={(event) =>
              setAddAppellation(event.target.value)
            }
            placeholder="Optional"
            value={addAppellation}
          />
        </label>

        <datalist id="add-appellation-suggestions">
          {appellationSuggestions.map((appellation) => (
            <option
              key={appellation}
              value={appellation}
            />
          ))}
        </datalist>

        <label>
          Area / region
          <input
            list="add-area-suggestions"
            onChange={(event) =>
              setAddArea(event.target.value)
            }
            placeholder="Optional"
            value={addArea}
          />
        </label>

        <datalist id="add-area-suggestions">
          {areaSuggestions.map((area) => (
            <option key={area} value={area} />
          ))}
        </datalist>

        <label>
          Bottle format (ml)
          <input
            inputMode="numeric"
            list="add-format-suggestions"
            min="1"
            onChange={(event) =>
              setAddFormatMl(event.target.value)
            }
            required
            step="1"
            type="number"
            value={addFormatMl}
          />
        </label>

        <datalist id="add-format-suggestions">
          <option value="500">50 cl</option>
          <option value="750">75 cl</option>
          <option value="1500">150 cl / magnum</option>
        </datalist>

        <label>
          Quantity
          <input
            min="1"
            onChange={(event) =>
              setAddQuantity(event.target.value)
            }
            required
            step="1"
            type="number"
            value={addQuantity}
          />
        </label>

        <label>
          Location
          <select
            onChange={(event) =>
              setAddLocationId(event.target.value)
            }
            value={selectedAddLocationId}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </select>
        </label>

        {addVintageError ? (
          <p role="alert">{addVintageError}</p>
        ) : null}

        {addFormatError ? (
          <p role="alert">{addFormatError}</p>
        ) : null}

        {cleanedAddProducer.length > 0 &&
        cleanedAddCuvee.length > 0 &&
        addColor.length > 0 &&
        addVintageError === null &&
        addFormatError === null ? (
          <p>
            {ambiguousWineIdentity
              ? "Multiple catalog wines share this producer, cuvée, vintage, color, and format. Stock will not be added until the reference is selected explicitly."
              : matchingWine
                ? "Existing wine — stock will be increased."
                : "New wine — the catalog entry will be created when this operation synchronizes."}
          </p>
        ) : null}

        <button
          disabled={
            adding ||
            !selectedAddLocation ||
            addVintageError !== null ||
            addFormatError !== null ||
            addColor.length === 0 ||
            ambiguousWineIdentity ||
            !deviceRegistration.deviceIdByHousehold[
              selectedAddHouseholdId
            ]
          }
          type="submit"
        >
          {adding ? "Queuing…" : "Add bottles"}
        </button>
      </form>

      <h2>Holdings</h2>

      <section aria-labelledby="inventory-filters-heading">
        <h3 id="inventory-filters-heading">
          Find bottles
        </h3>

        <label>
          Search
          <input
            onChange={(event) =>
              setInventorySearch(event.target.value)
            }
            placeholder="Producer, cuvée, appellation, area, vintage, cellar…"
            type="search"
            value={inventorySearch}
          />
        </label>

        <label>
          Location
          <select
            onChange={(event) =>
              setLocationFilter(event.target.value)
            }
            value={locationFilter}
          >
            <option value="ALL">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </select>
        </label>

        <button
          disabled={!hasInventoryFilters}
          onClick={() => {
            setInventorySearch("")
            setLocationFilter("ALL")
          }}
          type="button"
        >
          Clear filters
        </button>
      </section>

      <p>
        Showing {visibleBottleCount} of {totalBottleCount} bottles
        {" · "}
        {visibleWineCount} of {totalWineCount} wines
        {" · "}
        {visibleHoldings.length} of {holdings.length} positions
        {" · "}
        {pendingOperations.length} pending operation
        {pendingOperations.length === 1 ? "" : "s"}
      </p>

      {!isLoading && holdings.length === 0 ? (
        <p>No synchronized holdings found.</p>
      ) : null}

      {!isLoading &&
      holdings.length > 0 &&
      visibleHoldings.length === 0 ? (
        <p>No holdings match the current filters.</p>
      ) : null}

      <table className="inventory-table">
        <thead>
          <tr>
            <th>Wine</th>
            <th>Holding</th>
            <th>Move bottles</th>
            <th>Remove bottles</th>
          </tr>
        </thead>

        <tbody>
          {visibleHoldings.map((holding) => {
            const possibleDestinations = locations.filter(
              (location) =>
                location.household_id ===
                  holding.household_id &&
                location.id !== holding.location_id,
            )

            const destinationLocationId =
              destinationByHolding[holding.id] ??
              possibleDestinations[0]?.id ??
              ""

            const moveQuantityValue =
              moveQuantityByHolding[holding.id] ?? "1"

            const removeQuantityValue =
              removeQuantityByHolding[holding.id] ?? "1"

            const moveQuantity = parseActionQuantity(
              moveQuantityValue,
              holding.quantity,
            )

            const removeQuantity = parseActionQuantity(
              removeQuantityValue,
              holding.quantity,
            )

            const isPendingNewWine =
              pendingNewWineIds.has(holding.wine_id)

            const currentLocation =
              locationsById.get(holding.location_id)

            return (
              <tr key={holding.id}>
                <td data-label="Wine">
                  <div>
                    {holding.producer} — {holding.cuvee}
                  </div>
                  <small>
                    {[
                      holding.appellation,
                      holding.area,
                      holding.color,
                      formatWineVolume(holding.format_ml),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </td>
                <td className="inventory-holding" data-label="Holding">
                  <div>
                    <strong>{holding.vintage ?? "NV"}</strong>
                    {" · "}
                    {currentLocation
                      ? locationLabel(currentLocation)
                      : holding.location_code}
                  </div>
                  <small>
                    {holding.quantity} bottle
                    {holding.quantity === 1 ? "" : "s"}
                    {holding.pending_delta !== 0 ? (
                      <span>
                        {" · "}
                        {holding.pending_delta > 0 ? "+" : ""}
                        {holding.pending_delta} pending
                      </span>
                    ) : null}
                    {" · "}
                    Rev {holding.revision}
                  </small>
                </td>
                <td className="inventory-actions" data-label="Move bottles">
                  <div className="inventory-action-controls">
                  <input
                    aria-label={`Move quantity for ${holding.producer} ${holding.cuvee}`}
                    disabled={
                      holding.quantity < 1 ||
                      isPendingNewWine
                    }
                    max={holding.quantity}
                    min="1"
                    onChange={(event) => {
                      setMoveQuantityByHolding(
                        (currentQuantities) => ({
                          ...currentQuantities,
                          [holding.id]: event.target.value,
                        }),
                      )
                    }}
                    step="1"
                    type="number"
                    value={moveQuantityValue}
                  />

                  <select
                    aria-label={`Destination for ${holding.location_code}`}
                    disabled={
                      possibleDestinations.length === 0 ||
                      isPendingNewWine
                    }
                    onChange={(event) => {
                      setDestinationByHolding(
                        (currentDestinations) => ({
                          ...currentDestinations,
                          [holding.id]: event.target.value,
                        }),
                      )
                    }}
                    value={destinationLocationId}
                  >
                    {possibleDestinations.map((location) => (
                      <option
                        key={location.id}
                        value={location.id}
                      >
                        {locationLabel(location)}
                      </option>
                    ))}
                  </select>

                  <button
                    disabled={
                      moveQuantity === null ||
                      destinationLocationId.length === 0 ||
                      isPendingNewWine ||
                      !deviceRegistration.deviceIdByHousehold[
                        holding.household_id
                      ] ||
                      movingHoldingId === holding.id
                    }
                    onClick={() => {
                      if (moveQuantity !== null) {
                        void handleMove(
                          holding,
                          moveQuantity,
                        )
                      }
                    }}
                    title={
                      isPendingNewWine
                        ? "Wait for this new wine ADD to synchronize before moving it"
                        : undefined
                    }
                    type="button"
                  >
                    {movingHoldingId === holding.id
                      ? "Queuing…"
                      : "Move"}
                  </button>
                  </div>
                </td>
                <td className="inventory-actions" data-label="Remove bottles">
                  <div className="inventory-action-controls">
                  <input
                    aria-label={`Remove quantity for ${holding.producer} ${holding.cuvee}`}
                    disabled={
                      holding.quantity < 1 ||
                      isPendingNewWine
                    }
                    max={holding.quantity}
                    min="1"
                    onChange={(event) => {
                      setRemoveQuantityByHolding(
                        (currentQuantities) => ({
                          ...currentQuantities,
                          [holding.id]: event.target.value,
                        }),
                      )
                    }}
                    step="1"
                    type="number"
                    value={removeQuantityValue}
                  />

                  <select
                    aria-label={`Removal reason for ${holding.producer} ${holding.cuvee}`}
                    disabled={isPendingNewWine}
                    onChange={(event) => {
                      setRemoveReasonByHolding(
                        (currentReasons) => ({
                          ...currentReasons,
                          [holding.id]:
                            event.target.value as RemoveReason,
                        }),
                      )
                    }}
                    value={
                      removeReasonByHolding[holding.id] ??
                      "DRANK"
                    }
                  >
                    <option value="DRANK">Drank</option>
                    <option value="GIFTED">Gifted</option>
                    <option value="BROKEN">Broken</option>
                    <option value="LOST">Lost</option>
                    <option value="OTHER">Other</option>
                  </select>

                  <button
                    disabled={
                      removeQuantity === null ||
                      isPendingNewWine ||
                      !deviceRegistration.deviceIdByHousehold[
                        holding.household_id
                      ] ||
                      removingHoldingId === holding.id
                    }
                    onClick={() => {
                      if (removeQuantity !== null) {
                        void handleRemove(
                          holding,
                          removeQuantity,
                        )
                      }
                    }}
                    title={
                      isPendingNewWine
                        ? "Wait for this new wine ADD to synchronize before removing it"
                        : undefined
                    }
                    type="button"
                  >
                    {removingHoldingId === holding.id
                      ? "Queuing…"
                      : "Remove"}
                  </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2>Recent operations</h2>

      {operations.length === 0 ? (
        <p>No inventory operations found.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Operation</th>
              <th>Movement</th>
              <th>Quantity</th>
              <th>Reason</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {operations.map((operation) => (
              <tr key={operation.id}>
                <td>{operation.operation_type}</td>
                <td>
                  {operationLocationLabel(
                    operation.source_cellar_name,
                    operation.source_code,
                  )}
                  {" → "}
                  {operationLocationLabel(
                    operation.destination_cellar_name,
                    operation.destination_code,
                  )}
                </td>
                <td>{operation.quantity}</td>
                <td>
                  {operation.remove_reason ?? "—"}
                </td>
                <td>
                  {operation.status}
                  {operation.error_code
                    ? ` (${operation.error_code})`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
