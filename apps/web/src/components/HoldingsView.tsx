import { useQuery } from "@powersync/react"
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  matchesInventoryBrowseFilters,
} from "../data/inventoryBrowsing"
import {
  parseInventoryActionQuantity,
  toggleInventoryHoldingAction,
  type ActiveInventoryHoldingAction,
  type InventoryHoldingAction,
} from "../data/inventoryActionForms"
import {
  type AuthoritativeHolding,
  type InventoryLocation,
  type InventoryOperation,
  type ProjectedHolding,
  projectHoldings,
} from "../data/inventoryProjection"
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
  onOpenWine: (wineId: string) => void
}

type HoldingRow = ProjectedHolding

interface InventoryLocationRow extends InventoryLocation {
  cellar_id: string
  cellar_name: string
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
    l.cellar_id,
    l.code,
    c.name as cellar_name
  from locations l
  join cellars c on c.id = l.cellar_id
  where l.household_id = ?
    and coalesce(l.is_active, 1) = 1
    and coalesce(c.is_active, 1) = 1
  order by
    c.name,
    coalesce(l.display_order, 2147483647),
    l.code
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

function locationLabel(
  location: InventoryLocationRow,
): string {
  return `${location.cellar_name} / ${location.code}`
}

export function HoldingsView({
  userId,
  householdId,
  deviceRegistration,
  onOpenWine,
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
  const [cellarFilter, setCellarFilter] =
    useState("ALL")
  const [locationFilter, setLocationFilter] =
    useState("ALL")

  useEffect(() => {
    setInventorySearch("")
    setCellarFilter("ALL")
    setLocationFilter("ALL")
  }, [householdId])

  const cellars = useMemo(() => {
    const cellarNamesById = new Map<string, string>()

    for (const location of locations) {
      cellarNamesById.set(
        location.cellar_id,
        location.cellar_name,
      )
    }

    return Array.from(cellarNamesById, ([id, name]) => ({
      id,
      name,
    })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )
  }, [locations])

  const availableLocationFilters = useMemo(
    () =>
      cellarFilter === "ALL"
        ? locations
        : locations.filter(
            (location) =>
              location.cellar_id === cellarFilter,
          ),
    [cellarFilter, locations],
  )

  const visibleHoldings = useMemo(
    () =>
      holdings.filter((holding) => {
        const location =
          locationsById.get(holding.location_id)

        return matchesInventoryBrowseFilters(
          holding,
          location,
          {
            cellarId:
              cellarFilter === "ALL"
                ? null
                : cellarFilter,
            locationId:
              locationFilter === "ALL"
                ? null
                : locationFilter,
            search: inventorySearch,
          },
        )
      }),
    [
      cellarFilter,
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
    cellarFilter !== "ALL" ||
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

  const [activeHoldingAction, setActiveHoldingAction] =
    useState<ActiveInventoryHoldingAction | null>(null)

  const [holdingActionQuantity, setHoldingActionQuantity] =
    useState("1")

  const [moveDestinationId, setMoveDestinationId] =
    useState("")

  const [holdingRemoveReason, setHoldingRemoveReason] =
    useState<RemoveReason>("DRANK")

  const [submittingHoldingAction, setSubmittingHoldingAction] =
    useState<InventoryHoldingAction | null>(null)

  const [operationMessage, setOperationMessage] =
    useState<string | null>(null)

  const [operationError, setOperationError] =
    useState<string | null>(null)

  useEffect(() => {
    setActiveHoldingAction(null)
    setHoldingActionQuantity("1")
    setMoveDestinationId("")
    setHoldingRemoveReason("DRANK")
    setSubmittingHoldingAction(null)
  }, [householdId])

  function selectHoldingAction(
    holdingId: string,
    action: InventoryHoldingAction,
    defaultDestinationId = "",
  ) {
    const nextAction = toggleInventoryHoldingAction(
      activeHoldingAction,
      holdingId,
      action,
    )

    setActiveHoldingAction(nextAction)

    if (nextAction) {
      setOperationMessage(null)
      setOperationError(null)
      setHoldingActionQuantity("1")
      setMoveDestinationId(defaultDestinationId)
      setHoldingRemoveReason("DRANK")
    }
  }

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

  async function handleAddMore(
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

    const add: QueueAddInput = {
      householdId: holding.household_id,
      deviceId,
      userId,
      wineId: holding.wine_id,
      destinationLocationId: holding.location_id,
      quantity,
    }

    setSubmittingHoldingAction("add")

    try {
      const operationId = await queueAdd(add)

      setOperationMessage(
        `Add ${quantity} bottle${quantity === 1 ? "" : "s"} (${operationId.slice(0, 8)}) queued locally`,
      )
      setHoldingActionQuantity("1")
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue add",
      )
    } finally {
      setSubmittingHoldingAction(null)
    }
  }

  async function handleMove(
    holding: HoldingRow,
    quantity: number,
    destinationLocationId: string,
  ) {
    setOperationMessage(null)
    setOperationError(null)

    const destination = locations.find(
      (location) =>
        location.household_id === holding.household_id &&
        location.id !== holding.location_id &&
        location.id === destinationLocationId,
    )

    const deviceId =
      deviceRegistration.deviceIdByHousehold[
        holding.household_id
      ]

    if (!destination) {
      setOperationError("Select a destination location")
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

    setSubmittingHoldingAction("move")

    try {
      const operationId = await queueMove(move)
      setOperationMessage(
        `Move ${quantity} bottle${quantity === 1 ? "" : "s"} (${operationId.slice(0, 8)}) queued locally`,
      )
      setHoldingActionQuantity("1")
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue move",
      )
    } finally {
      setSubmittingHoldingAction(null)
    }
  }

  async function handleRemove(
    holding: HoldingRow,
    quantity: number,
    removeReason: RemoveReason,
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

    const remove: QueueRemoveInput = {
      householdId: holding.household_id,
      deviceId,
      userId,
      wineId: holding.wine_id,
      sourceLocationId: holding.location_id,
      quantity,
      removeReason,
    }

    setSubmittingHoldingAction("remove")

    try {
      const operationId = await queueRemove(remove)

      setOperationMessage(
        `Remove ${quantity} bottle${quantity === 1 ? "" : "s"} (${operationId.slice(0, 8)}) queued locally`,
      )
      setHoldingActionQuantity("1")
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue removal",
      )
    } finally {
      setSubmittingHoldingAction(null)
    }
  }

  return (
    <main className="inventory-view">
      <h1>Inventory</h1>

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

      {operationMessage && !activeHoldingAction ? (
        <Notice role="status" tone="success">
          {operationMessage}
        </Notice>
      ) : null}

      {operationError && !activeHoldingAction ? (
        <Notice role="alert" tone="error">
          {operationError}
        </Notice>
      ) : null}

      <details className="inventory-add-panel">
        <summary>
          <span className="inventory-add-panel__summary">
            <strong>Add bottles</strong>
            <small>
              Queue stock for an existing or new wine
            </small>
          </span>
        </summary>

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
      </details>

      <h2>Holdings</h2>

      <section
        aria-labelledby="inventory-filters-heading"
        className="inventory-filters"
      >
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
          Cellar
          <select
            onChange={(event) => {
              const nextCellarFilter = event.target.value

              setCellarFilter(nextCellarFilter)

              if (
                locationFilter !== "ALL" &&
                nextCellarFilter !== "ALL" &&
                locationsById.get(locationFilter)
                  ?.cellar_id !== nextCellarFilter
              ) {
                setLocationFilter("ALL")
              }
            }}
            value={cellarFilter}
          >
            <option value="ALL">All cellars</option>
            {cellars.map((cellar) => (
              <option key={cellar.id} value={cellar.id}>
                {cellar.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Location
          <select
            onChange={(event) =>
              setLocationFilter(event.target.value)
            }
            value={locationFilter}
          >
            <option value="ALL">
              {cellarFilter === "ALL"
                ? "All locations"
                : "All locations in cellar"}
            </option>
            {availableLocationFilters.map((location) => (
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
            setCellarFilter("ALL")
            setLocationFilter("ALL")
          }}
          type="button"
        >
          Clear filters
        </button>
      </section>

      <p
        aria-live="polite"
        className="inventory-results-summary"
      >
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
            <th>Actions</th>
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

            const activeAction =
              activeHoldingAction?.holdingId ===
              holding.id
                ? activeHoldingAction.action
                : null

            const destinationLocationId =
              moveDestinationId ||
              (possibleDestinations[0]?.id ?? "")

            const actionQuantity =
              parseInventoryActionQuantity(
                holdingActionQuantity,
                activeAction === "add"
                  ? null
                  : holding.quantity,
              )

            const hasRegisteredDevice = Boolean(
              deviceRegistration.deviceIdByHousehold[
                holding.household_id
              ],
            )

            const isPendingNewWine =
              pendingNewWineIds.has(holding.wine_id)

            const currentLocation =
              locationsById.get(holding.location_id)

            const currentLocationLabel = currentLocation
              ? locationLabel(currentLocation)
              : holding.location_code

            const actionPanelId =
              `holding-actions-${holding.id}`

            const actionsBusy =
              submittingHoldingAction !== null

            return (
              <tr key={holding.id}>
                <td data-label="Wine">
                  {isPendingNewWine ? (
                    <div>
                      {holding.producer} — {holding.cuvee}
                    </div>
                  ) : (
                    <button
                      className="wine-detail-link"
                      onClick={() =>
                        onOpenWine(holding.wine_id)
                      }
                      type="button"
                    >
                      {holding.producer} — {holding.cuvee}
                    </button>
                  )}
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
                    {currentLocationLabel}
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
                <td
                  className="inventory-actions"
                  data-label="Actions"
                >
                  <div className="inventory-action-cell-content">
                    <div
                      aria-label={`Actions for ${holding.producer} ${holding.cuvee}`}
                      className="inventory-action-picker"
                      role="group"
                    >
                      <button
                        aria-controls={actionPanelId}
                        aria-expanded={activeAction === "add"}
                        disabled={
                          isPendingNewWine ||
                          !hasRegisteredDevice ||
                          actionsBusy
                        }
                        onClick={() =>
                          selectHoldingAction(
                            holding.id,
                            "add",
                          )
                        }
                        title={
                          isPendingNewWine
                            ? "Wait for this new wine to synchronize before adding more"
                            : undefined
                        }
                        type="button"
                      >
                        Add more
                      </button>

                      <button
                        aria-controls={actionPanelId}
                        aria-expanded={activeAction === "move"}
                        disabled={
                          holding.quantity < 1 ||
                          isPendingNewWine ||
                          !hasRegisteredDevice ||
                          possibleDestinations.length === 0 ||
                          actionsBusy
                        }
                        onClick={() =>
                          selectHoldingAction(
                            holding.id,
                            "move",
                            possibleDestinations[0]?.id ?? "",
                          )
                        }
                        title={
                          possibleDestinations.length === 0
                            ? "Create another location before moving bottles"
                            : isPendingNewWine
                              ? "Wait for this new wine to synchronize before moving it"
                              : undefined
                        }
                        type="button"
                      >
                        Move
                      </button>

                      <button
                        aria-controls={actionPanelId}
                        aria-expanded={activeAction === "remove"}
                        disabled={
                          holding.quantity < 1 ||
                          isPendingNewWine ||
                          !hasRegisteredDevice ||
                          actionsBusy
                        }
                        onClick={() =>
                          selectHoldingAction(
                            holding.id,
                            "remove",
                          )
                        }
                        title={
                          isPendingNewWine
                            ? "Wait for this new wine to synchronize before removing it"
                            : undefined
                        }
                        type="button"
                      >
                        Consume/remove
                      </button>
                    </div>

                    {activeAction ? (
                      <div
                        className="inventory-action-panel"
                        id={actionPanelId}
                      >
                        <strong>
                          {activeAction === "add"
                            ? `Add bottles to ${currentLocationLabel}`
                            : activeAction === "move"
                              ? `Move bottles from ${currentLocationLabel}`
                              : `Consume or remove from ${currentLocationLabel}`}
                        </strong>

                        <form
                          className="inventory-action-form"
                          onSubmit={(event) => {
                            event.preventDefault()

                            if (actionQuantity === null) {
                              return
                            }

                            if (activeAction === "add") {
                              void handleAddMore(
                                holding,
                                actionQuantity,
                              )
                            } else if (
                              activeAction === "move"
                            ) {
                              void handleMove(
                                holding,
                                actionQuantity,
                                destinationLocationId,
                              )
                            } else {
                              void handleRemove(
                                holding,
                                actionQuantity,
                                holdingRemoveReason,
                              )
                            }
                          }}
                        >
                          <label>
                            Quantity
                            <input
                              aria-describedby={`${actionPanelId}-quantity-help`}
                              disabled={actionsBusy}
                              inputMode="numeric"
                              max={
                                activeAction === "add"
                                  ? undefined
                                  : holding.quantity
                              }
                              min="1"
                              onChange={(event) =>
                                setHoldingActionQuantity(
                                  event.target.value,
                                )
                              }
                              required
                              step="1"
                              type="number"
                              value={holdingActionQuantity}
                            />
                          </label>

                          {activeAction === "move" ? (
                            <label>
                              Destination
                              <select
                                disabled={actionsBusy}
                                onChange={(event) =>
                                  setMoveDestinationId(
                                    event.target.value,
                                  )
                                }
                                required
                                value={destinationLocationId}
                              >
                                {possibleDestinations.map(
                                  (location) => (
                                    <option
                                      key={location.id}
                                      value={location.id}
                                    >
                                      {locationLabel(location)}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                          ) : null}

                          {activeAction === "remove" ? (
                            <label>
                              Reason
                              <select
                                disabled={actionsBusy}
                                onChange={(event) =>
                                  setHoldingRemoveReason(
                                    event.target
                                      .value as RemoveReason,
                                  )
                                }
                                value={holdingRemoveReason}
                              >
                                <option value="DRANK">
                                  Drank
                                </option>
                                <option value="GIFTED">
                                  Gifted
                                </option>
                                <option value="BROKEN">
                                  Broken
                                </option>
                                <option value="LOST">
                                  Lost
                                </option>
                                <option value="OTHER">
                                  Other
                                </option>
                              </select>
                            </label>
                          ) : null}

                          <small id={`${actionPanelId}-quantity-help`}>
                            {activeAction === "add"
                              ? "Enter a positive whole number."
                              : `Up to ${holding.quantity} bottle${holding.quantity === 1 ? "" : "s"} available.`}
                          </small>

                          <div className="inventory-action-form__buttons">
                            <button
                              disabled={
                                actionQuantity === null ||
                                (activeAction === "move" &&
                                  destinationLocationId.length ===
                                    0) ||
                                actionsBusy
                              }
                              type="submit"
                            >
                              {submittingHoldingAction ===
                              activeAction
                                ? "Queuing…"
                                : activeAction === "add"
                                  ? "Queue add"
                                  : activeAction === "move"
                                    ? "Queue move"
                                    : "Queue removal"}
                            </button>

                            <button
                              disabled={actionsBusy}
                              onClick={() =>
                                setActiveHoldingAction(null)
                              }
                              type="button"
                            >
                              Close
                            </button>
                          </div>
                        </form>

                        {operationMessage ? (
                          <p
                            className="inventory-action-feedback inventory-action-feedback--success"
                            role="status"
                          >
                            {operationMessage}
                          </p>
                        ) : null}

                        {operationError ? (
                          <p
                            className="inventory-action-feedback inventory-action-feedback--error"
                            role="alert"
                          >
                            {operationError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

    </main>
  )
}
