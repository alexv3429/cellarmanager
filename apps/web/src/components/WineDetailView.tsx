import { useQuery } from "@powersync/react"
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react"

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
  queueAdd,
  queueMove,
  queueRemove,
  type QueueAddInput,
  type QueueMoveInput,
  type QueueRemoveInput,
  type RemoveReason,
} from "../data/powersync/inventoryOperations"
import {
  formatWineVolume,
  type WineCatalogEntry,
} from "../data/wineCatalog"
import { prepareWineCatalogEdit } from "../data/wineCatalogEdit"
import { updateWineCatalog } from "../data/wineCatalogMutations"
import type { RegisteredDevicesState } from "../devices/useRegisteredDevices"
import type { AppView } from "../navigation/appNavigation"
import { Notice } from "./Notice"
import { WineFactsPanel } from "./WineFactsPanel"
import { WineReferenceMatchReview } from "./WineReferenceMatchReview"
import { WineMaturityPanel } from "./WineMaturityPanel"
import { WinePersonalGuidancePanel } from "./WinePersonalGuidancePanel"

interface WineDetailViewProps {
  deviceRegistration: RegisteredDevicesState
  householdId: string
  isOnline: boolean
  onBack: () => void
  onOpenMergedWine: (wineId: string) => void
  returnView: AppView
  userId: string
  wineId: string
}

interface WineDetailLocation extends InventoryLocation {
  cellar_id: string
  cellar_name: string
}

const WINE_QUERY = `
  select
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    country,
    classification,
    vineyard,
    grape_composition,
    sweetness_category,
    alcohol_percent,
    certifications,
    wine_reference_id,
    wine_reference_type,
    merged_into_wine_id,
    format_ml
  from wines
  where household_id = ?
    and id = ?
`

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
    and h.wine_id = ?
  order by l.code
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
    and wine_id = ?
    and status = 'PENDING'
    and operation_type in ('ADD', 'MOVE', 'REMOVE')
`

const DETAIL_ADD_ACTION_ID = "wine-detail-add"

function locationLabel(
  location: WineDetailLocation,
): string {
  return `${location.cellar_name} / ${location.code}`
}

function returnViewLabel(view: AppView): string {
  switch (view) {
    case "activity":
      return "activity"
    case "inventory":
      return "inventory"
    case "setup":
      return "cellar setup"
    default:
      return "catalog"
  }
}

export function WineDetailView({
  deviceRegistration,
  householdId,
  isOnline,
  onBack,
  onOpenMergedWine,
  returnView,
  userId,
  wineId,
}: WineDetailViewProps) {
  const {
    data: wines,
    error: wineError,
    isLoading: wineLoading,
  } = useQuery<WineCatalogEntry>(
    WINE_QUERY,
    [householdId, wineId],
  )

  const {
    data: authoritativeHoldings,
    error: holdingsError,
    isLoading: holdingsLoading,
  } = useQuery<AuthoritativeHolding>(
    HOLDINGS_QUERY,
    [householdId, wineId],
  )

  const {
    data: locations,
    error: locationsError,
    isLoading: locationsLoading,
  } = useQuery<WineDetailLocation>(
    LOCATIONS_QUERY,
    [householdId],
  )

  const {
    data: pendingOperations,
    error: pendingOperationsError,
    isLoading: pendingOperationsLoading,
  } = useQuery<InventoryOperation>(
    PENDING_OPERATIONS_QUERY,
    [householdId, wineId],
  )

  const wine = wines[0]

  useEffect(() => {
    if (wine?.merged_into_wine_id) {
      onOpenMergedWine(wine.merged_into_wine_id)
    }
  }, [onOpenMergedWine, wine?.merged_into_wine_id])

  const holdings = useMemo(
    () =>
      projectHoldings({
        holdings: authoritativeHoldings,
        locations,
        operations: pendingOperations,
        wines: wine ? [wine] : [],
      }),
    [
      authoritativeHoldings,
      locations,
      pendingOperations,
      wine,
    ],
  )

  const totalBottles = holdings.reduce(
    (sum, holding) => sum + holding.quantity,
    0,
  )

  const error =
    wineError ??
    holdingsError ??
    locationsError ??
    pendingOperationsError

  const isLoading =
    wineLoading ||
    holdingsLoading ||
    locationsLoading ||
    pendingOperationsLoading

  const deviceId =
    deviceRegistration.deviceIdByHousehold[householdId]

  const [isEditing, setIsEditing] = useState(false)
  const [editProducer, setEditProducer] = useState("")
  const [editCuvee, setEditCuvee] = useState("")
  const [editVintage, setEditVintage] = useState("")
  const [editColor, setEditColor] = useState("")
  const [editAppellation, setEditAppellation] =
    useState("")
  const [editFormatMl, setEditFormatMl] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [editMessage, setEditMessage] =
    useState<string | null>(null)
  const [editError, setEditError] =
    useState<string | null>(null)

  const [activeAction, setActiveAction] =
    useState<ActiveInventoryHoldingAction | null>(null)
  const [actionQuantity, setActionQuantity] = useState("1")
  const [actionDestinationId, setActionDestinationId] =
    useState("")
  const [removeReason, setRemoveReason] =
    useState<RemoveReason>("DRANK")
  const [submittingAction, setSubmittingAction] =
    useState<InventoryHoldingAction | null>(null)
  const [operationMessage, setOperationMessage] =
    useState<string | null>(null)
  const [operationError, setOperationError] =
    useState<string | null>(null)

  useEffect(() => {
    setIsEditing(false)
    setIsSaving(false)
    setEditMessage(null)
    setEditError(null)
    setActiveAction(null)
    setActionQuantity("1")
    setActionDestinationId("")
    setRemoveReason("DRANK")
    setSubmittingAction(null)
    setOperationMessage(null)
    setOperationError(null)
  }, [householdId, wineId])

  useEffect(() => {
    if (
      activeAction &&
      activeAction.holdingId !== DETAIL_ADD_ACTION_ID &&
      !holdings.some(
        (holding) =>
          holding.id === activeAction.holdingId,
      )
    ) {
      setActiveAction(null)
    }
  }, [activeAction, holdings])

  function startEditing() {
    if (!wine) {
      return
    }

    setEditMessage(null)
    setEditError(null)
    setEditProducer(wine.producer)
    setEditCuvee(wine.cuvee)
    setEditVintage(
      wine.vintage === null ? "" : String(wine.vintage),
    )
    setEditColor(wine.color)
    setEditAppellation(wine.appellation ?? "")
    setEditFormatMl(String(wine.format_ml))
    setIsEditing(true)
  }

  async function saveWine(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    setEditMessage(null)
    setEditError(null)

    if (!wine || !isOnline) {
      setEditError(
        "Reconnect before editing this catalog wine.",
      )
      return
    }

    setIsSaving(true)

    try {
      const edit = prepareWineCatalogEdit(
        editProducer,
        editCuvee,
        editVintage,
        editColor,
        editAppellation,
        wine.area ?? "",
        editFormatMl,
      )

      await updateWineCatalog(wine.id, edit)

      setIsEditing(false)
      setEditMessage(
        "Wine saved. Waiting for synchronization.",
      )
    } catch (caughtError: unknown) {
      setEditError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save wine",
      )
    } finally {
      setIsSaving(false)
    }
  }

  function selectAction(
    holdingId: string,
    action: InventoryHoldingAction,
    defaultDestinationId: string,
  ) {
    const nextAction = toggleInventoryHoldingAction(
      activeAction,
      holdingId,
      action,
    )

    setActiveAction(nextAction)

    if (nextAction) {
      setOperationMessage(null)
      setOperationError(null)
      setActionQuantity("1")
      setActionDestinationId(defaultDestinationId)
      setRemoveReason("DRANK")
    }
  }

  async function handleAdd(
    quantity: number,
    destinationLocationId: string,
  ) {
    setOperationMessage(null)
    setOperationError(null)

    const destination = locations.find(
      (location) =>
        location.id === destinationLocationId &&
        location.household_id === householdId,
    )

    if (!wine || !destination) {
      setOperationError("Select a destination location")
      return
    }

    if (!deviceId) {
      setOperationError(
        "This browser is not registered for this household yet",
      )
      return
    }

    const add: QueueAddInput = {
      householdId,
      deviceId,
      userId,
      wineId: wine.id,
      destinationLocationId: destination.id,
      quantity,
    }

    setSubmittingAction("add")

    try {
      const operationId = await queueAdd(add)

      setOperationMessage(
        `Add ${quantity} bottle${quantity === 1 ? "" : "s"} (${operationId.slice(0, 8)}) queued locally`,
      )
      setActionQuantity("1")
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue add",
      )
    } finally {
      setSubmittingAction(null)
    }
  }

  async function handleMove(
    holding: ProjectedHolding,
    quantity: number,
    destinationLocationId: string,
  ) {
    setOperationMessage(null)
    setOperationError(null)

    const destination = locations.find(
      (location) =>
        location.id === destinationLocationId &&
        location.household_id === householdId &&
        location.id !== holding.location_id,
    )

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
      householdId,
      deviceId,
      userId,
      wineId: holding.wine_id,
      sourceLocationId: holding.location_id,
      destinationLocationId: destination.id,
      quantity,
    }

    setSubmittingAction("move")

    try {
      const operationId = await queueMove(move)

      setOperationMessage(
        `Move ${quantity} bottle${quantity === 1 ? "" : "s"} (${operationId.slice(0, 8)}) queued locally`,
      )
      setActionQuantity("1")
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue move",
      )
    } finally {
      setSubmittingAction(null)
    }
  }

  async function handleRemove(
    holding: ProjectedHolding,
    quantity: number,
    selectedReason: RemoveReason,
  ) {
    setOperationMessage(null)
    setOperationError(null)

    if (!deviceId) {
      setOperationError(
        "This browser is not registered for this household yet",
      )
      return
    }

    const remove: QueueRemoveInput = {
      householdId,
      deviceId,
      userId,
      wineId: holding.wine_id,
      sourceLocationId: holding.location_id,
      quantity,
      removeReason: selectedReason,
    }

    setSubmittingAction("remove")

    try {
      const operationId = await queueRemove(remove)

      setOperationMessage(
        `Remove ${quantity} bottle${quantity === 1 ? "" : "s"} (${operationId.slice(0, 8)}) queued locally`,
      )
      setActionQuantity("1")
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue removal",
      )
    } finally {
      setSubmittingAction(null)
    }
  }

  function renderActionPanel(
    actionOwnerId: string,
    holding: ProjectedHolding | null,
    destinations: WineDetailLocation[],
  ) {
    if (activeAction?.holdingId !== actionOwnerId) {
      return null
    }

    const action = activeAction.action
    const isNewPositionAdd =
      actionOwnerId === DETAIL_ADD_ACTION_ID
    const availableDestinations =
      isNewPositionAdd ? locations : destinations
    const destinationLocationId =
      actionDestinationId ||
      availableDestinations[0]?.id ||
      ""
    const quantity = parseInventoryActionQuantity(
      actionQuantity,
      action === "add" ? null : (holding?.quantity ?? 0),
    )
    const panelId = `wine-action-${actionOwnerId}`
    const currentLocation = holding
      ? locations.find(
          (location) =>
            location.id === holding.location_id,
        )
      : null
    const currentLocationLabel = currentLocation
      ? locationLabel(currentLocation)
      : holding?.location_code ?? "this position"
    const isBusy = submittingAction !== null

    return (
      <div className="inventory-action-panel" id={panelId}>
        <strong>
          {isNewPositionAdd
            ? "Add bottles"
            : action === "add"
              ? `Add bottles to ${currentLocationLabel}`
              : action === "move"
                ? `Move bottles from ${currentLocationLabel}`
                : `Consume or remove from ${currentLocationLabel}`}
        </strong>

        <form
          className="inventory-action-form"
          onSubmit={(event) => {
            event.preventDefault()

            if (quantity === null) {
              return
            }

            if (action === "add") {
              void handleAdd(
                quantity,
                isNewPositionAdd
                  ? destinationLocationId
                  : (holding?.location_id ?? ""),
              )
            } else if (action === "move" && holding) {
              void handleMove(
                holding,
                quantity,
                destinationLocationId,
              )
            } else if (holding) {
              void handleRemove(
                holding,
                quantity,
                removeReason,
              )
            }
          }}
        >
          <label>
            Quantity
            <input
              aria-describedby={`${panelId}-quantity-help`}
              disabled={isBusy}
              inputMode="numeric"
              max={
                action === "add"
                  ? undefined
                  : holding?.quantity
              }
              min="1"
              onChange={(event) =>
                setActionQuantity(event.target.value)
              }
              required
              step="1"
              type="number"
              value={actionQuantity}
            />
          </label>

          {isNewPositionAdd || action === "move" ? (
            <label>
              {isNewPositionAdd ? "Location" : "Destination"}
              <select
                disabled={isBusy}
                onChange={(event) =>
                  setActionDestinationId(event.target.value)
                }
                required
                value={destinationLocationId}
              >
                {availableDestinations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {locationLabel(location)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {action === "remove" ? (
            <label>
              Reason
              <select
                disabled={isBusy}
                onChange={(event) =>
                  setRemoveReason(
                    event.target.value as RemoveReason,
                  )
                }
                value={removeReason}
              >
                <option value="DRANK">Drank</option>
                <option value="GIFTED">Gifted</option>
                <option value="BROKEN">Broken</option>
                <option value="LOST">Lost</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
          ) : null}

          <small id={`${panelId}-quantity-help`}>
            {action === "add"
              ? "Enter a positive whole number."
              : `Up to ${holding?.quantity ?? 0} bottle${holding?.quantity === 1 ? "" : "s"} available.`}
          </small>

          <div className="inventory-action-form__buttons">
            <button
              disabled={
                quantity === null ||
                ((isNewPositionAdd || action === "move") &&
                  destinationLocationId.length === 0) ||
                isBusy
              }
              type="submit"
            >
              {submittingAction === action
                ? "Queuing…"
                : action === "add"
                  ? "Queue add"
                  : action === "move"
                    ? "Queue move"
                    : "Queue removal"}
            </button>

            <button
              disabled={isBusy}
              onClick={() => setActiveAction(null)}
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
    )
  }

  if (isLoading) {
    return (
      <main className="wine-detail-view">
        <button
          className="wine-detail-view__back"
          onClick={onBack}
          type="button"
        >
          ← Back to {returnViewLabel(returnView)}
        </button>
        <Notice>Opening wine details…</Notice>
      </main>
    )
  }

  if (error) {
    return (
      <main className="wine-detail-view">
        <button
          className="wine-detail-view__back"
          onClick={onBack}
          type="button"
        >
          ← Back to {returnViewLabel(returnView)}
        </button>
        <Notice role="alert" tone="error">
          {String(error)}
        </Notice>
      </main>
    )
  }

  if (!wine) {
    return (
      <main className="wine-detail-view">
        <button
          className="wine-detail-view__back"
          onClick={onBack}
          type="button"
        >
          ← Back to {returnViewLabel(returnView)}
        </button>
        <h1>Wine not found</h1>
        <Notice role="alert" tone="warning">
          This wine is not available in the active household.
        </Notice>
      </main>
    )
  }

  if (wine.merged_into_wine_id) {
    return (
      <main className="wine-detail-view">
        <Notice>
          This catalog entry was merged. Opening the active wine…
        </Notice>
      </main>
    )
  }

  return (
    <main className="wine-detail-view">
      <button
        className="wine-detail-view__back"
        onClick={onBack}
        type="button"
      >
        ← Back to {returnViewLabel(returnView)}
      </button>

      <header className="wine-detail-hero">
        <div>
          <p className="wine-detail-hero__eyebrow">
            {wine.vintage ?? "NV"} · {wine.color} ·{" "}
            {formatWineVolume(wine.format_ml)}
          </p>
          <h1>{wine.producer}</h1>
          <p className="wine-detail-hero__cuvee">
            {wine.cuvee}
          </p>
        </div>

        <div className="wine-detail-total" aria-live="polite">
          <strong>{totalBottles}</strong>
          <span>
            bottle{totalBottles === 1 ? "" : "s"} in stock
          </span>
          <small>
            {holdings.length} physical position
            {holdings.length === 1 ? "" : "s"}
            {pendingOperations.length > 0
              ? ` · ${pendingOperations.length} pending operation${pendingOperations.length === 1 ? "" : "s"}`
              : ""}
          </small>
        </div>
      </header>

      {!isOnline ? (
        <Notice tone="warning">
          Offline · inventory actions remain available, but wine
          reference editing is disabled.
        </Notice>
      ) : null}

      {editMessage ? (
        <Notice role="status" tone="success">
          {editMessage}
        </Notice>
      ) : null}

      {editError ? (
        <Notice role="alert" tone="error">
          {editError}
        </Notice>
      ) : null}

      {operationMessage && !activeAction ? (
        <Notice role="status" tone="success">
          {operationMessage}
        </Notice>
      ) : null}

      {operationError && !activeAction ? (
        <Notice role="alert" tone="error">
          {operationError}
        </Notice>
      ) : null}

      <section
        aria-labelledby="wine-reference-heading"
        className="wine-detail-reference"
      >
        <div className="wine-detail-section-heading">
          <div>
            <h2 id="wine-reference-heading">Wine reference</h2>
            <p>Identity and metadata synchronized for this wine.</p>
          </div>

          {!isEditing ? (
            <button
              disabled={!isOnline}
              onClick={startEditing}
              title={
                isOnline
                  ? undefined
                  : "Reconnect before editing"
              }
              type="button"
            >
              Edit wine
            </button>
          ) : null}
        </div>

        {isEditing ? (
          <form
            className="wine-detail-edit-form"
            onSubmit={(event) => void saveWine(event)}
          >
            <label>
              Producer / winery
              <input
                disabled={isSaving}
                onChange={(event) =>
                  setEditProducer(event.target.value)
                }
                required
                value={editProducer}
              />
            </label>

            <label>
              Cuvée
              <input
                disabled={isSaving}
                onChange={(event) =>
                  setEditCuvee(event.target.value)
                }
                required
                value={editCuvee}
              />
            </label>

            <label>
              Vintage
              <input
                disabled={isSaving}
                inputMode="numeric"
                onChange={(event) =>
                  setEditVintage(event.target.value)
                }
                placeholder="NV"
                value={editVintage}
              />
            </label>

            <label>
              Color
              <input
                disabled={isSaving}
                onChange={(event) =>
                  setEditColor(event.target.value)
                }
                required
                value={editColor}
              />
            </label>

            <label>
              Appellation
              <input
                disabled={isSaving}
                onChange={(event) =>
                  setEditAppellation(event.target.value)
                }
                placeholder="Optional"
                value={editAppellation}
              />
            </label>

            <label>
              Bottle format (ml)
              <input
                disabled={isSaving}
                inputMode="numeric"
                min="1"
                onChange={(event) =>
                  setEditFormatMl(event.target.value)
                }
                required
                step="1"
                type="number"
                value={editFormatMl}
              />
            </label>

            <div className="wine-detail-edit-form__buttons">
              <button
                disabled={!isOnline || isSaving}
                type="submit"
              >
                {isSaving ? "Saving…" : "Save wine"}
              </button>

              <button
                disabled={isSaving}
                onClick={() => {
                  setIsEditing(false)
                  setEditError(null)
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="wine-detail-metadata">
            <div>
              <dt>Producer</dt>
              <dd>{wine.producer}</dd>
            </div>
            <div>
              <dt>Cuvée</dt>
              <dd>{wine.cuvee}</dd>
            </div>
            <div>
              <dt>Vintage</dt>
              <dd>{wine.vintage ?? "NV"}</dd>
            </div>
            <div>
              <dt>Color</dt>
              <dd>{wine.color}</dd>
            </div>
            <div>
              <dt>Appellation</dt>
              <dd>{wine.appellation ?? "—"}</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>{formatWineVolume(wine.format_ml)}</dd>
            </div>
          </dl>
        )}

        {!isEditing ? (
          <WineReferenceMatchReview
            isOnline={isOnline}
            wine={wine}
          />
        ) : null}
      </section>

      <WineFactsPanel isOnline={isOnline} wine={wine} />

      <WineMaturityPanel
        householdId={householdId}
        isOnline={isOnline}
        wineId={wine.id}
      />

      <WinePersonalGuidancePanel isOnline={isOnline} wineId={wine.id} />

      <section
        aria-labelledby="wine-stock-heading"
        className="wine-detail-stock"
      >
        <div className="wine-detail-section-heading">
          <div>
            <h2 id="wine-stock-heading">Stock positions</h2>
            <p>
              Projected local stock, including queued offline
              operations.
            </p>
          </div>

          <button
            aria-controls={`wine-action-${DETAIL_ADD_ACTION_ID}`}
            aria-expanded={
              activeAction?.holdingId ===
                DETAIL_ADD_ACTION_ID &&
              activeAction.action === "add"
            }
            disabled={
              locations.length === 0 ||
              !deviceId ||
              submittingAction !== null
            }
            onClick={() =>
              selectAction(
                DETAIL_ADD_ACTION_ID,
                "add",
                locations[0]?.id ?? "",
              )
            }
            type="button"
          >
            Add bottles
          </button>
        </div>

        {!deviceId && locations.length > 0 ? (
          <Notice tone="warning">
            Inventory actions will be available when device
            registration finishes.
          </Notice>
        ) : null}

        {locations.length === 0 ? (
          <Notice tone="warning">
            Create a cellar location before adding bottles.
          </Notice>
        ) : null}

        {renderActionPanel(
          DETAIL_ADD_ACTION_ID,
          null,
          locations,
        )}

        {holdings.length === 0 ? (
          <p>No bottles are currently held for this wine.</p>
        ) : (
          <div className="wine-detail-positions">
            {holdings.map((holding) => {
              const currentLocation = locations.find(
                (location) =>
                  location.id === holding.location_id,
              )
              const possibleDestinations = locations.filter(
                (location) =>
                  location.id !== holding.location_id,
              )
              const currentLocationLabel = currentLocation
                ? locationLabel(currentLocation)
                : holding.location_code
              const isBusy = submittingAction !== null

              return (
                <article
                  className="wine-detail-position"
                  key={holding.id}
                >
                  <div className="wine-detail-position__summary">
                    <div>
                      <h3>{currentLocationLabel}</h3>
                      <small>Revision {holding.revision}</small>
                    </div>
                    <div className="wine-detail-position__quantity">
                      <strong>{holding.quantity}</strong>
                      <span>
                        bottle{holding.quantity === 1 ? "" : "s"}
                      </span>
                      {holding.pending_delta !== 0 ? (
                        <small>
                          {holding.pending_delta > 0 ? "+" : ""}
                          {holding.pending_delta} pending
                        </small>
                      ) : null}
                    </div>
                  </div>

                  <div
                    aria-label={`Actions for ${currentLocationLabel}`}
                    className="inventory-action-picker"
                    role="group"
                  >
                    <button
                      aria-controls={`wine-action-${holding.id}`}
                      aria-expanded={
                        activeAction?.holdingId === holding.id &&
                        activeAction.action === "add"
                      }
                      disabled={!deviceId || isBusy}
                      onClick={() =>
                        selectAction(
                          holding.id,
                          "add",
                          holding.location_id,
                        )
                      }
                      type="button"
                    >
                      Add more
                    </button>

                    <button
                      aria-controls={`wine-action-${holding.id}`}
                      aria-expanded={
                        activeAction?.holdingId === holding.id &&
                        activeAction.action === "move"
                      }
                      disabled={
                        holding.quantity < 1 ||
                        possibleDestinations.length === 0 ||
                        !deviceId ||
                        isBusy
                      }
                      onClick={() =>
                        selectAction(
                          holding.id,
                          "move",
                          possibleDestinations[0]?.id ?? "",
                        )
                      }
                      title={
                        possibleDestinations.length === 0
                          ? "Create another location before moving bottles"
                          : undefined
                      }
                      type="button"
                    >
                      Move
                    </button>

                    <button
                      aria-controls={`wine-action-${holding.id}`}
                      aria-expanded={
                        activeAction?.holdingId === holding.id &&
                        activeAction.action === "remove"
                      }
                      disabled={
                        holding.quantity < 1 ||
                        !deviceId ||
                        isBusy
                      }
                      onClick={() =>
                        selectAction(
                          holding.id,
                          "remove",
                          "",
                        )
                      }
                      type="button"
                    >
                      Consume/remove
                    </button>
                  </div>

                  {renderActionPanel(
                    holding.id,
                    holding,
                    possibleDestinations,
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
