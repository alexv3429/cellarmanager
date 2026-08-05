import { useQuery, useStatus } from "@powersync/react"
import { useState } from "react"

import {
  queueMove,
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
  quantity: number
  revision: number
}

interface LocationRow {
  id: string
  household_id: string
  code: string
}

interface DeviceRow {
  id: string
  household_id: string
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

const DEVICES_QUERY = `
  select id, household_id
  from devices
  order by created_at
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

  const {
    data: holdings,
    error,
    isLoading,
    isFetching,
  } = useQuery<HoldingRow>(HOLDINGS_QUERY)

  const { data: locations } =
    useQuery<LocationRow>(LOCATIONS_QUERY)

  const { data: devices } =
    useQuery<DeviceRow>(DEVICES_QUERY)

  const { data: operations } =
    useQuery<InventoryOperationRow>(OPERATIONS_QUERY)

  const [destinationByHolding, setDestinationByHolding] =
    useState<Record<string, string>>({})

  const [movingHoldingId, setMovingHoldingId] =
    useState<string | null>(null)

  const [moveMessage, setMoveMessage] =
    useState<string | null>(null)

  const [moveError, setMoveError] =
    useState<string | null>(null)

  async function signOut() {
    await supabase.auth.signOut({ scope: "local" })
  }

  async function handleMove(holding: HoldingRow) {
    setMoveMessage(null)
    setMoveError(null)

    const possibleDestinations = locations.filter(
      (location) =>
        location.household_id === holding.household_id &&
        location.id !== holding.location_id,
    )

    const destinationLocationId =
      destinationByHolding[holding.id] ??
      possibleDestinations[0]?.id

    const device = devices.find(
      (candidate) =>
        candidate.household_id === holding.household_id,
    )

    if (!destinationLocationId) {
      setMoveError("No destination location is available")
      return
    }

    if (!device) {
      setMoveError(
        "No registered device is available for this household",
      )
      return
    }

    const move: QueueMoveInput = {
      householdId: holding.household_id,
      deviceId: device.id,
      userId,
      wineId: holding.wine_id,
      sourceLocationId: holding.location_id,
      destinationLocationId,
      quantity: 1,
    }

    setMovingHoldingId(holding.id)

    try {
      const operationId = await queueMove(move)
      setMoveMessage(
        `Move ${operationId.slice(0, 8)} queued locally`,
      )
    } catch (caughtError: unknown) {
      setMoveError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to queue move",
      )
    } finally {
      setMovingHoldingId(null)
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
        </div>

        <button onClick={() => void signOut()} type="button">
          Sign out
        </button>
      </header>

      <h2>Holdings</h2>

      {isLoading ? <p>Opening local database…</p> : null}
      {error ? <p role="alert">{String(error)}</p> : null}
      {moveMessage ? <p>{moveMessage}</p> : null}
      {moveError ? <p role="alert">{moveError}</p> : null}

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
                <td>{holding.quantity}</td>
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
