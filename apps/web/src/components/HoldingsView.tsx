import { useQuery, useStatus } from "@powersync/react"
import { useMemo, useState } from "react"

import {
  type AuthoritativeHolding,
  type InventoryLocation,
  type InventoryOperation,
  type ProjectedHolding,
  projectHoldings,
} from "../data/inventoryProjection"
import { useRegisteredDevices } from "../devices/useRegisteredDevices"
import {
  queueMove,
  queueRemove,
  type QueueMoveInput,
  type QueueRemoveInput,
  type RemoveReason,
} from "../data/powersync/inventoryOperations"

interface HoldingsViewProps {
  userId: string
  isOnline: boolean
  isOfflineAccess: boolean
  syncError: string | null
  onSignOut: () => Promise<void>
}

type HoldingRow = ProjectedHolding

interface InventoryOperationRow {
  id: string
  operation_type: string
  source_code: string | null
  destination_code: string | null
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
    l.code as location_code,
    h.quantity,
    h.revision
  from holdings h
  join wines w on w.id = h.wine_id
  join locations l on l.id = h.location_id
  order by
    w.producer,
    w.cuvee,
    w.vintage,
    l.code
`

const LOCATIONS_QUERY = `
  select id, household_id, code
  from locations
  order by code
`


const PENDING_OPERATIONS_QUERY = `
  select
    id,
    operation_type,
    wine_id,
    source_location_id,
    destination_location_id,
    quantity,
    status
  from inventory_operations
  where status = 'PENDING'
    and operation_type in ('ADD', 'MOVE', 'REMOVE')
`

const OPERATIONS_QUERY = `
  select
    operation.id,
    operation.operation_type,
    source.code as source_code,
    destination.code as destination_code,
    operation.quantity,
    operation.remove_reason,
    operation.status,
    operation.error_code,
    operation.created_at_client
  from inventory_operations operation
  left join locations source
    on source.id = operation.source_location_id
  left join locations destination
    on destination.id = operation.destination_location_id
  order by operation.created_at_client desc
  limit 10
`

export function HoldingsView({
  userId,
  isOnline,
  isOfflineAccess,
  syncError,
  onSignOut,
}: HoldingsViewProps) {
  const status = useStatus()

  const deviceRegistration = useRegisteredDevices(
    userId,
    status.hasSynced === true,
  )

  const {
    data: authoritativeHoldings,
    error: holdingsError,
    isLoading: holdingsLoading,
    isFetching,
  } = useQuery<AuthoritativeHolding>(HOLDINGS_QUERY)

  const {
    data: locations,
    error: locationsError,
    isLoading: locationsLoading,
  } = useQuery<InventoryLocation>(LOCATIONS_QUERY)

  const {
    data: pendingOperations,
    error: pendingOperationsError,
    isLoading: pendingOperationsLoading,
  } = useQuery<InventoryOperation>(
    PENDING_OPERATIONS_QUERY,
  )

  const { data: operations } =
    useQuery<InventoryOperationRow>(OPERATIONS_QUERY)

  const holdings = useMemo(
    () =>
      projectHoldings({
        holdings: authoritativeHoldings,
        locations,
        operations: pendingOperations,
      }),
    [authoritativeHoldings, locations, pendingOperations],
  )

  const error =
    holdingsError ??
    locationsError ??
    pendingOperationsError

  const isLoading =
    holdingsLoading ||
    locationsLoading ||
    pendingOperationsLoading

  const [destinationByHolding, setDestinationByHolding] =
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

  async function signOut() {
    setOperationError(null)

    if (!isOnline) {
      setOperationError(
        "Reconnect before signing out. Signing out offline would prevent access until the next online login.",
      )
      return
    }

    try {
      await onSignOut()
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to sign out",
      )
    }
  }

  async function handleMove(holding: HoldingRow) {
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
      quantity: 1,
    }

    setMovingHoldingId(holding.id)

    try {
      const operationId = await queueMove(move)
      setOperationMessage(
        `Move ${operationId.slice(0, 8)} queued locally`,
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

  async function handleRemove(holding: HoldingRow) {
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
      quantity: 1,
      removeReason,
    }

    setRemovingHoldingId(holding.id)

    try {
      const operationId = await queueRemove(remove)

      setOperationMessage(
        `Remove ${operationId.slice(0, 8)} queued locally`,
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
      <header>
        <div>
          <h1>CellarManager</h1>
          <p>
            {status.connected ? "Connected" : "Offline"}
            {" · "}
            {status.hasSynced
              ? "Local data ready"
              : "Initial synchronization pending"}
            {isFetching ? " · Refreshing" : ""}
          </p>

          <p>
            Device:{" "}
            {deviceRegistration.isReady
              ? "Ready"
              : deviceRegistration.isRegistering
                ? "Registering…"
                : deviceRegistration.isLoading
                  ? "Waiting for synchronized data…"
                  : "Not ready"}
          </p>

          {isOfflineAccess ? (
            <p>
              Local access only · authentication will refresh
              after reconnection
            </p>
          ) : null}
        </div>

        <button
          onClick={() => void signOut()}
          title={
            isOnline
              ? undefined
              : "Reconnect before signing out"
          }
          type="button"
        >
          Sign out
        </button>
      </header>

      <h2>Holdings</h2>

      {isLoading ? <p>Opening local database…</p> : null}
      {error ? <p role="alert">{String(error)}</p> : null}
      {operationMessage ? <p>{operationMessage}</p> : null}
      {operationError ? <p role="alert">{operationError}</p> : null}
      {syncError ? (
        <p role="alert">
          Synchronization paused: {syncError}
        </p>
      ) : null}

      {deviceRegistration.error ? (
        <div role="alert">
          <p>{deviceRegistration.error}</p>
          <button
            onClick={deviceRegistration.retryRegistration}
            type="button"
          >
            Retry device registration
          </button>
        </div>
      ) : null}

      {!isLoading && holdings.length === 0 ? (
        <p>No synchronized holdings found.</p>
      ) : null}

      <table>
        <thead>
          <tr>
            <th>Wine</th>
            <th>Vintage</th>
            <th>Location</th>
            <th>Quantity</th>
            <th>Revision</th>
            <th>Move one bottle</th>
            <th>Remove one bottle</th>
          </tr>
        </thead>

        <tbody>
          {holdings.map((holding) => {
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

            return (
              <tr key={holding.id}>
                <td>
                  {holding.producer} — {holding.cuvee}
                </td>
                <td>{holding.vintage ?? "NV"}</td>
                <td>{holding.location_code}</td>
                <td>
                  {holding.quantity}
                  {holding.pending_delta !== 0 ? (
                    <span>
                      {" "}
                      ({holding.pending_delta > 0 ? "+" : ""}
                      {holding.pending_delta} pending)
                    </span>
                  ) : null}
                </td>
                <td>{holding.revision}</td>
                <td>
                  <select
                    aria-label={`Destination for ${holding.location_code}`}
                    disabled={
                      possibleDestinations.length === 0
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
                        {location.code}
                      </option>
                    ))}
                  </select>

                  <button
                    disabled={
                      holding.quantity < 1 ||
                      destinationLocationId.length === 0 ||
                      !deviceRegistration.deviceIdByHousehold[
                        holding.household_id
                      ] ||
                      movingHoldingId === holding.id
                    }
                    onClick={() => void handleMove(holding)}
                    type="button"
                  >
                    {movingHoldingId === holding.id
                      ? "Queuing…"
                      : "Move 1"}
                  </button>
                </td>
                <td>
                  <select
                    aria-label={`Removal reason for ${holding.producer} ${holding.cuvee}`}
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
                      holding.quantity < 1 ||
                      !deviceRegistration.deviceIdByHousehold[
                        holding.household_id
                      ] ||
                      removingHoldingId === holding.id
                    }
                    onClick={() =>
                      void handleRemove(holding)
                    }
                    type="button"
                  >
                    {removingHoldingId === holding.id
                      ? "Queuing…"
                      : "Remove 1"}
                  </button>
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
                  {operation.source_code ?? "—"}
                  {" → "}
                  {operation.destination_code ?? "—"}
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
