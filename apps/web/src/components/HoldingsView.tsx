import { useQuery, useStatus } from "@powersync/react"
import { useState } from "react"

import { useRegisteredDevices } from "../devices/useRegisteredDevices"
import {
  queueConsume,
  queueMove,
  type QueueConsumeInput,
  type QueueMoveInput,
} from "../data/powersync/inventoryOperations"
import { supabase } from "../data/supabase"

interface HoldingsViewProps {
  userId: string
}

interface HoldingRow {
  id: string
  household_id: string
  wine_id: string
  location_id: string
  producer: string
  cuvee: string
  vintage: number | null
  location_code: string
  authoritative_quantity: number
  pending_delta: number
  pending_operation_count: number
  quantity: number
  revision: number
}

interface LocationRow {
  id: string
  household_id: string
  code: string
}


interface InventoryOperationRow {
  id: string
  operation_type: string
  source_code: string
  destination_code: string | null
  quantity: number
  status: string
  error_code: string | null
  created_at_client: string
}

const HOLDINGS_QUERY = `
  with pending_operations as (
    select
      operation_type,
      wine_id,
      source_location_id,
      destination_location_id,
      quantity
    from inventory_operations
    where status = 'PENDING'
      and operation_type in ('MOVE', 'CONSUME')
  ),
  pending_deltas as (
    select
      wine_id,
      source_location_id as location_id,
      -sum(quantity) as delta,
      count(*) as operation_count
    from pending_operations
    group by wine_id, source_location_id

    union all

    select
      wine_id,
      destination_location_id as location_id,
      sum(quantity) as delta,
      count(*) as operation_count
    from pending_operations
    where operation_type = 'MOVE'
      and destination_location_id is not null
    group by wine_id, destination_location_id
  ),
  pending_by_position as (
    select
      wine_id,
      location_id,
      sum(delta) as pending_delta,
      sum(operation_count) as pending_operation_count
    from pending_deltas
    group by wine_id, location_id
  ),
  position_keys as (
    select wine_id, location_id
    from holdings

    union

    select wine_id, location_id
    from pending_by_position
  ),
  projected_holdings as (
    select
      coalesce(
        holding.id,
        'optimistic:' ||
          position.wine_id ||
          ':' ||
          position.location_id
      ) as id,
      wine.household_id,
      position.wine_id,
      position.location_id,
      wine.producer,
      wine.cuvee,
      wine.vintage,
      location.code as location_code,
      coalesce(
        holding.quantity,
        0
      ) as authoritative_quantity,
      coalesce(
        pending.pending_delta,
        0
      ) as pending_delta,
      coalesce(
        pending.pending_operation_count,
        0
      ) as pending_operation_count,
      max(
        0,
        coalesce(holding.quantity, 0) +
          coalesce(pending.pending_delta, 0)
      ) as quantity,
      coalesce(holding.revision, 0) as revision
    from position_keys position
    join wines wine
      on wine.id = position.wine_id
    join locations location
      on location.id = position.location_id
    left join holdings holding
      on holding.wine_id = position.wine_id
      and holding.location_id = position.location_id
    left join pending_by_position pending
      on pending.wine_id = position.wine_id
      and pending.location_id = position.location_id
  )
  select *
  from projected_holdings
  where quantity > 0
    or pending_operation_count > 0
  order by
    producer,
    cuvee,
    vintage,
    location_code
`

const LOCATIONS_QUERY = `
  select id, household_id, code
  from locations
  order by code
`


const OPERATIONS_QUERY = `
  select
    operation.id,
    operation.operation_type,
    source.code as source_code,
    destination.code as destination_code,
    operation.quantity,
    operation.status,
    operation.error_code,
    operation.created_at_client
  from inventory_operations operation
  join locations source
    on source.id = operation.source_location_id
  left join locations destination
    on destination.id = operation.destination_location_id
  order by operation.created_at_client desc
  limit 10
`

export function HoldingsView({
  userId,
}: HoldingsViewProps) {
  const status = useStatus()

  const deviceRegistration = useRegisteredDevices(
    userId,
    status.hasSynced === true,
  )

  const {
    data: holdings,
    error,
    isLoading,
    isFetching,
  } = useQuery<HoldingRow>(HOLDINGS_QUERY)

  const { data: locations } =
    useQuery<LocationRow>(LOCATIONS_QUERY)

  const { data: operations } =
    useQuery<InventoryOperationRow>(OPERATIONS_QUERY)

  const [destinationByHolding, setDestinationByHolding] =
    useState<Record<string, string>>({})

  const [movingHoldingId, setMovingHoldingId] =
    useState<string | null>(null)

  const [consumingHoldingId, setConsumingHoldingId] =
    useState<string | null>(null)

  const [operationMessage, setOperationMessage] =
    useState<string | null>(null)

  const [operationError, setOperationError] =
    useState<string | null>(null)

  async function signOut() {
    await supabase.auth.signOut({ scope: "local" })
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

  async function handleConsume(holding: HoldingRow) {
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

    const consume: QueueConsumeInput = {
      householdId: holding.household_id,
      deviceId,
      userId,
      wineId: holding.wine_id,
      sourceLocationId: holding.location_id,
      quantity: 1,
    }

    setConsumingHoldingId(holding.id)

    try {
      const operationId = await queueConsume(consume)

      setOperationMessage(
        `Consume ${operationId.slice(0, 8)} queued locally`,
      )
    } catch (caughtError: unknown) {
      setOperationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue consumption",
      )
    } finally {
      setConsumingHoldingId(null)
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
        </div>

        <button onClick={() => void signOut()} type="button">
          Sign out
        </button>
      </header>

      <h2>Holdings</h2>

      {isLoading ? <p>Opening local database…</p> : null}
      {error ? <p role="alert">{String(error)}</p> : null}
      {operationMessage ? <p>{operationMessage}</p> : null}
      {operationError ? <p role="alert">{operationError}</p> : null}

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
            <th>Consume one bottle</th>
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
                  <button
                    disabled={
                      holding.quantity < 1 ||
                      !deviceRegistration.deviceIdByHousehold[
                        holding.household_id
                      ] ||
                      consumingHoldingId === holding.id
                    }
                    onClick={() =>
                      void handleConsume(holding)
                    }
                    type="button"
                  >
                    {consumingHoldingId === holding.id
                      ? "Queuing…"
                      : "Consume 1"}
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
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {operations.map((operation) => (
              <tr key={operation.id}>
                <td>{operation.operation_type}</td>
                <td>
                  {operation.source_code}
                  {" → "}
                  {operation.destination_code ?? "—"}
                </td>
                <td>{operation.quantity}</td>
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
