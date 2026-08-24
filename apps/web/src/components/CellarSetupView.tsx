import { useQuery } from "@powersync/react"
import {
  type FormEvent,
  useMemo,
  useState,
} from "react"

import {
  archiveCellar,
  archiveLocation,
  createCellar,
  createLocation,
  type LocationStoragePurpose,
  renameCellar,
  restoreCellar,
  restoreLocation,
  setLocationOrder,
  updateLocation,
} from "../data/cellarSetup"
import {
  buildCellarSetupSummaries,
  filterCellarSetupSummaries,
  formatBottleCount,
  formatLocationCount,
  getLocationOccupancy,
  getLocationStoragePurposeLabel,
  isSetupRecordActive,
  moveLocationId,
  LOCATION_STORAGE_PURPOSES,
  type CellarSetupCellar,
  type CellarSetupCellarSummary,
  type CellarSetupHolding,
  type CellarSetupLocation,
  type CellarSetupLocationSummary,
} from "../data/cellarSetupView"
import { Notice } from "./Notice"

interface CellarSetupViewProps {
  householdId: string
  isOnline: boolean
}

const CELLARS_QUERY = `
  select id, household_id, name, is_active
  from cellars
  where household_id = ?
`

const LOCATIONS_QUERY = `
  select
    id,
    household_id,
    cellar_id,
    code,
    is_active,
    display_order,
    capacity,
    storage_purpose
  from locations
  where household_id = ?
`

const HOLDINGS_QUERY = `
  select location_id, quantity
  from holdings
  where household_id = ?
`

function formValue(
  form: HTMLFormElement,
  name: string,
): string {
  return String(new FormData(form).get(name) ?? "")
}

export function CellarSetupView({
  householdId,
  isOnline,
}: CellarSetupViewProps) {
  const { data: cellars, error: cellarsError } =
    useQuery<CellarSetupCellar>(
      CELLARS_QUERY,
      [householdId],
    )

  const { data: locations, error: locationsError } =
    useQuery<CellarSetupLocation>(
      LOCATIONS_QUERY,
      [householdId],
    )

  const { data: holdings, error: holdingsError } =
    useQuery<CellarSetupHolding>(
      HOLDINGS_QUERY,
      [householdId],
    )

  const [busyAction, setBusyAction] =
    useState<string | null>(null)

  const [message, setMessage] =
    useState<string | null>(null)

  const [mutationError, setMutationError] =
    useState<string | null>(null)

  const [search, setSearch] = useState("")

  const [expandedCellarIds, setExpandedCellarIds] =
    useState<Set<string>>(() => new Set())

  const [editingCellarId, setEditingCellarId] =
    useState<string | null>(null)

  const [editingLocationId, setEditingLocationId] =
    useState<string | null>(null)

  const cellarSummaries = useMemo(
    () =>
      buildCellarSetupSummaries({
        cellars,
        holdings,
        locations,
      }),
    [cellars, holdings, locations],
  )

  const activeCellars = useMemo(
    () =>
      cellarSummaries.filter((cellar) =>
        isSetupRecordActive(cellar.is_active),
      ),
    [cellarSummaries],
  )

  const archivedCellars = useMemo(
    () =>
      cellarSummaries.filter(
        (cellar) =>
          !isSetupRecordActive(cellar.is_active),
      ),
    [cellarSummaries],
  )

  const visibleCellars = useMemo(
    () =>
      filterCellarSetupSummaries(
        activeCellars,
        search,
      ),
    [activeCellars, search],
  )

  const totalLocations = activeCellars.reduce(
    (total, cellar) => total + cellar.locations.length,
    0,
  )

  const archivedLocationCount = cellarSummaries.reduce(
    (total, cellar) =>
      total + cellar.archivedLocations.length,
    0,
  )

  const totalBottles = activeCellars.reduce(
    (total, cellar) => total + cellar.bottleCount,
    0,
  )

  const error =
    cellarsError ?? locationsError ?? holdingsError

  const hasSearch = search.trim().length > 0

  async function runMutation(
    action: string,
    successMessage: string,
    mutation: () => Promise<void>,
  ): Promise<boolean> {
    setMessage(null)
    setMutationError(null)

    if (!isOnline) {
      setMutationError(
        "Reconnect before changing cellar setup.",
      )
      return false
    }

    setBusyAction(action)

    try {
      await mutation()
      setMessage(successMessage)
      return true
    } catch (caughtError: unknown) {
      setMutationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save cellar setup",
      )
      return false
    } finally {
      setBusyAction(null)
    }
  }

  function toggleCellar(cellarId: string) {
    setExpandedCellarIds((currentIds) => {
      const nextIds = new Set(currentIds)

      if (nextIds.has(cellarId)) {
        nextIds.delete(cellarId)
      } else {
        nextIds.add(cellarId)
      }

      return nextIds
    })
  }

  async function handleCreateCellar(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    const form = event.currentTarget

    const saved = await runMutation(
      "create-cellar",
      "Cellar saved. Waiting for synchronization.",
      async () => {
        await createCellar(
          householdId,
          formValue(form, "name"),
        )
      },
    )

    if (saved) {
      form.reset()
    }
  }

  async function handleCreateLocation(
    event: FormEvent<HTMLFormElement>,
    cellar: CellarSetupCellarSummary,
  ) {
    event.preventDefault()
    const form = event.currentTarget

    const saved = await runMutation(
      `create-location:${cellar.id}`,
      `Location saved in ${cellar.name}. Waiting for synchronization.`,
      async () => {
        await createLocation(
          cellar.household_id,
          cellar.id,
          formValue(form, "code"),
          formValue(form, "capacity"),
          formValue(form, "storagePurpose") as LocationStoragePurpose,
        )
      },
    )

    if (saved) {
      form.reset()
    }
  }

  async function handleRenameCellar(
    event: FormEvent<HTMLFormElement>,
    cellar: CellarSetupCellarSummary,
  ) {
    event.preventDefault()
    const form = event.currentTarget

    const saved = await runMutation(
      `rename-cellar:${cellar.id}`,
      "Cellar renamed. Waiting for synchronization.",
      () =>
        renameCellar(
          cellar.id,
          formValue(form, "name"),
        ),
    )

    if (saved) {
      setEditingCellarId(null)
    }
  }

  async function handleUpdateLocation(
    event: FormEvent<HTMLFormElement>,
    location: CellarSetupLocationSummary,
  ) {
    event.preventDefault()
    const form = event.currentTarget

    const saved = await runMutation(
      `update-location:${location.id}`,
      "Location updated. Waiting for synchronization.",
      () =>
        updateLocation(
          location.id,
          formValue(form, "code"),
          formValue(form, "capacity"),
          formValue(form, "storagePurpose") as LocationStoragePurpose,
        ),
    )

    if (saved) {
      setEditingLocationId(null)
    }
  }

  async function handleOrderLocations(
    cellar: CellarSetupCellarSummary,
    locationIds: string[],
    successMessage: string,
  ) {
    await runMutation(
      `order-locations:${cellar.id}`,
      successMessage,
      () => setLocationOrder(cellar.id, locationIds),
    )
  }

  async function handleArchiveLocation(
    location: CellarSetupLocationSummary,
  ) {
    const saved = await runMutation(
      `archive-location:${location.id}`,
      `${location.code} archived. It is no longer available for inventory operations.`,
      () => archiveLocation(location.id),
    )

    if (saved) {
      setEditingLocationId(null)
    }
  }

  async function handleRestoreLocation(
    location: CellarSetupLocationSummary,
  ) {
    await runMutation(
      `restore-location:${location.id}`,
      `${location.code} restored.`,
      () => restoreLocation(location.id),
    )
  }

  async function handleArchiveCellar(
    cellar: CellarSetupCellarSummary,
  ) {
    const saved = await runMutation(
      `archive-cellar:${cellar.id}`,
      `${cellar.name} archived.`,
      () => archiveCellar(cellar.id),
    )

    if (saved) {
      setEditingCellarId(null)
      setExpandedCellarIds((currentIds) => {
        const nextIds = new Set(currentIds)
        nextIds.delete(cellar.id)
        return nextIds
      })
    }
  }

  async function handleRestoreCellar(
    cellar: CellarSetupCellarSummary,
  ) {
    await runMutation(
      `restore-cellar:${cellar.id}`,
      `${cellar.name} restored. Restore any locations you still need separately.`,
      () => restoreCellar(cellar.id),
    )
  }

  return (
    <main className="cellar-setup-view">
      <div className="cellar-setup-intro">
        <h1>Cellar setup</h1>
        <p>
          Organize the physical places where you store wine.
          Setup changes synchronize to every device and require a
          connection; inventory ADD, MOVE, and REMOVE remain
          local-first.
        </p>
      </div>

      {!isOnline ? (
        <Notice tone="warning">
          Offline · setup changes are disabled, but your saved
          layout remains available.
        </Notice>
      ) : null}

      {error ? (
        <Notice role="alert" tone="error">
          {String(error)}
        </Notice>
      ) : null}

      {message ? (
        <Notice role="status" tone="success">
          {message}
        </Notice>
      ) : null}

      {mutationError ? (
        <Notice role="alert" tone="error">
          {mutationError}
        </Notice>
      ) : null}

      <section
        aria-labelledby="storage-overview-heading"
        className="cellar-setup-overview"
      >
        <h2 id="storage-overview-heading">
          Storage overview
        </h2>

        <dl>
          <div>
            <dt>Active cellars</dt>
            <dd>{activeCellars.length}</dd>
          </div>
          <div>
            <dt>Active locations</dt>
            <dd>{totalLocations}</dd>
          </div>
          <div>
            <dt>Bottles placed</dt>
            <dd>{totalBottles}</dd>
          </div>
          <div>
            <dt>Archived locations</dt>
            <dd>{archivedLocationCount}</dd>
          </div>
        </dl>
      </section>

      <details className="cellar-setup-create">
        <summary>Add a cellar</summary>

        <form
          onSubmit={(event) =>
            void handleCreateCellar(event)
          }
        >
          <label>
            Cellar name
            <input
              autoComplete="off"
              name="name"
              placeholder="For example: Main cellar"
              required
            />
          </label>

          <button
            disabled={!isOnline || busyAction !== null}
            type="submit"
          >
            {busyAction === "create-cellar"
              ? "Saving…"
              : "Create cellar"}
          </button>
        </form>
      </details>

      <section
        aria-labelledby="cellars-heading"
        className="cellar-setup-management"
      >
        <div className="cellar-setup-management__heading">
          <div>
            <h2 id="cellars-heading">Your cellars</h2>
            <p>
              The first location in each list appears at the top
              of the physical layout. Archive unused positions
              instead of deleting their history.
            </p>
          </div>

          <label className="cellar-setup-search">
            <span>Find a cellar or location</span>
            <input
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search by name or code"
              type="search"
              value={search}
            />
          </label>
        </div>

        {activeCellars.length === 0 ? (
          <Notice>
            No active cellars found. Add a new cellar above or
            restore an archived one below.
          </Notice>
        ) : null}

        {activeCellars.length > 0 &&
        visibleCellars.length === 0 ? (
          <Notice role="status">
            No cellar or location matches “{search}”.
          </Notice>
        ) : null}

        <div className="cellar-card-list">
          {visibleCellars.map((visibleCellar) => {
            const cellar =
              activeCellars.find(
                (candidate) =>
                  candidate.id === visibleCellar.id,
              ) ?? visibleCellar

            const isExpanded =
              hasSearch || expandedCellarIds.has(cellar.id)

            const isEditingCellar =
              editingCellarId === cellar.id

            const canArchiveCellar =
              cellar.locations.length === 0 &&
              cellar.bottleCount === 0

            return (
              <article className="cellar-card" key={cellar.id}>
                <header className="cellar-card__header">
                  <div>
                    <h3>{cellar.name}</h3>
                    <p>
                      {formatLocationCount(
                        cellar.locations.length,
                      )}
                      <span aria-hidden="true"> · </span>
                      {formatBottleCount(cellar.bottleCount)}
                    </p>
                  </div>

                  <div className="cellar-card__actions">
                    <button
                      disabled={busyAction !== null}
                      onClick={() => {
                        setEditingCellarId(cellar.id)
                        setEditingLocationId(null)
                      }}
                      type="button"
                    >
                      Rename cellar
                    </button>

                    {!hasSearch ? (
                      <button
                        aria-expanded={isExpanded}
                        aria-controls={`cellar-locations-${cellar.id}`}
                        onClick={() => toggleCellar(cellar.id)}
                        type="button"
                      >
                        {isExpanded
                          ? "Hide locations"
                          : "Manage locations"}
                      </button>
                    ) : null}
                  </div>
                </header>

                {isEditingCellar ? (
                  <form
                    className="cellar-card__rename-form"
                    onSubmit={(event) =>
                      void handleRenameCellar(event, cellar)
                    }
                  >
                    <label>
                      Cellar name
                      <input
                        autoFocus
                        defaultValue={cellar.name}
                        name="name"
                        required
                      />
                    </label>

                    <div>
                      <button
                        disabled={
                          !isOnline || busyAction !== null
                        }
                        type="submit"
                      >
                        {busyAction ===
                        `rename-cellar:${cellar.id}`
                          ? "Saving…"
                          : "Save name"}
                      </button>
                      <button
                        disabled={busyAction !== null}
                        onClick={() =>
                          setEditingCellarId(null)
                        }
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}

                {isExpanded ? (
                  <div
                    className="cellar-card__locations"
                    id={`cellar-locations-${cellar.id}`}
                  >
                    <div className="cellar-location-toolbar">
                      <div>
                        <strong>Display order</strong>
                        <span>
                          Top of the list = top of the cellar.
                        </span>
                      </div>
                      <button
                        disabled={
                          !isOnline ||
                          busyAction !== null ||
                          hasSearch ||
                          cellar.locations.length < 2
                        }
                        onClick={() =>
                          void handleOrderLocations(
                            cellar,
                            cellar.locations
                              .map((location) => location.id)
                              .reverse(),
                            `${cellar.name} display order reversed.`,
                          )
                        }
                        title={
                          hasSearch
                            ? "Clear the search before changing display order"
                            : undefined
                        }
                        type="button"
                      >
                        Reverse order
                      </button>
                    </div>

                    <form
                      className="cellar-location-create-form"
                      onSubmit={(event) =>
                        void handleCreateLocation(event, cellar)
                      }
                    >
                      <label>
                        New location in {cellar.name}
                        <input
                          autoComplete="off"
                          name="code"
                          placeholder="For example: Rack A-01"
                          required
                        />
                      </label>

                      <label>
                        Capacity (optional)
                        <input
                          inputMode="numeric"
                          min="1"
                          name="capacity"
                          placeholder="For example: 20"
                          step="1"
                          type="number"
                        />
                      </label>

                      <label>
                        Purpose
                        <select
                          defaultValue="mixed"
                          name="storagePurpose"
                        >
                          {LOCATION_STORAGE_PURPOSES.map(
                            (purpose) => (
                              <option
                                key={purpose.value}
                                value={purpose.value}
                              >
                                {purpose.label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>

                      <button
                        disabled={
                          !isOnline || busyAction !== null
                        }
                        type="submit"
                      >
                        {busyAction ===
                        `create-location:${cellar.id}`
                          ? "Saving…"
                          : "Add location"}
                      </button>
                    </form>

                    {hasSearch &&
                    visibleCellar.locations.length !==
                      cellar.locations.length ? (
                      <p className="cellar-card__filter-summary">
                        Showing {formatLocationCount(
                          visibleCellar.locations.length,
                        )} of {cellar.locations.length}. Clear the
                        search to change display order.
                      </p>
                    ) : null}

                    {visibleCellar.locations.length === 0 ? (
                      <p className="cellar-card__empty">
                        No active locations in this cellar yet.
                      </p>
                    ) : (
                      <ol className="cellar-location-list">
                        {visibleCellar.locations.map(
                          (location) => {
                            const isEditingLocation =
                              editingLocationId === location.id

                            const locationIndex =
                              cellar.locations.findIndex(
                                (candidate) =>
                                  candidate.id === location.id,
                              )

                            const occupancy =
                              getLocationOccupancy(
                                location.bottleCount,
                                location.capacity,
                              )

                            return (
                              <li key={location.id}>
                                <div className="cellar-location__summary">
                                  <strong>{location.code}</strong>
                                  <span
                                    className={`cellar-location__occupancy cellar-location__occupancy--${occupancy.tone}`}
                                  >
                                    {occupancy.label}
                                  </span>
                                  <span className="cellar-location__purpose">
                                    {getLocationStoragePurposeLabel(
                                      location.storage_purpose,
                                    )}
                                  </span>
                                  <span>{occupancy.detail}</span>
                                </div>

                                {isEditingLocation ? (
                                  <form
                                    className="cellar-location__rename-form"
                                    onSubmit={(event) =>
                                      void handleUpdateLocation(
                                        event,
                                        location,
                                      )
                                    }
                                  >
                                    <label>
                                      <span>Location code</span>
                                      <input
                                        autoFocus
                                        defaultValue={location.code}
                                        name="code"
                                        required
                                      />
                                    </label>
                                    <label>
                                      <span>Purpose</span>
                                      <select
                                        defaultValue={
                                          location.storage_purpose
                                        }
                                        name="storagePurpose"
                                      >
                                        {LOCATION_STORAGE_PURPOSES.map(
                                          (purpose) => (
                                            <option
                                              key={purpose.value}
                                              value={purpose.value}
                                            >
                                              {purpose.label}
                                            </option>
                                          ),
                                        )}
                                      </select>
                                    </label>
                                    <label>
                                      <span>Capacity (optional)</span>
                                      <input
                                        defaultValue={
                                          location.capacity ?? ""
                                        }
                                        inputMode="numeric"
                                        min="1"
                                        name="capacity"
                                        step="1"
                                        type="number"
                                      />
                                    </label>
                                    <div>
                                      <button
                                        disabled={
                                          !isOnline ||
                                          busyAction !== null
                                        }
                                        type="submit"
                                      >
                                        {busyAction ===
                                        `update-location:${location.id}`
                                          ? "Saving…"
                                          : "Save"}
                                      </button>
                                      <button
                                        disabled={
                                          busyAction !== null
                                        }
                                        onClick={() =>
                                          setEditingLocationId(null)
                                        }
                                        type="button"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </form>
                                ) : (
                                  <div className="cellar-location__actions">
                                    {!hasSearch ? (
                                      <div className="cellar-location__order-actions">
                                        <button
                                          aria-label={`Move ${location.code} up`}
                                          disabled={
                                            !isOnline ||
                                            busyAction !== null ||
                                            locationIndex <= 0
                                          }
                                          onClick={() =>
                                            void handleOrderLocations(
                                              cellar,
                                              moveLocationId(
                                                cellar.locations.map(
                                                  (candidate) =>
                                                    candidate.id,
                                                ),
                                                location.id,
                                                -1,
                                              ),
                                              `${location.code} moved up.`,
                                            )
                                          }
                                          type="button"
                                        >
                                          Up
                                        </button>
                                        <button
                                          aria-label={`Move ${location.code} down`}
                                          disabled={
                                            !isOnline ||
                                            busyAction !== null ||
                                            locationIndex ===
                                              cellar.locations.length - 1
                                          }
                                          onClick={() =>
                                            void handleOrderLocations(
                                              cellar,
                                              moveLocationId(
                                                cellar.locations.map(
                                                  (candidate) =>
                                                    candidate.id,
                                                ),
                                                location.id,
                                                1,
                                              ),
                                              `${location.code} moved down.`,
                                            )
                                          }
                                          type="button"
                                        >
                                          Down
                                        </button>
                                      </div>
                                    ) : null}

                                    <button
                                      disabled={busyAction !== null}
                                      onClick={() => {
                                        setEditingLocationId(
                                          location.id,
                                        )
                                        setEditingCellarId(null)
                                      }}
                                      type="button"
                                    >
                                      Edit
                                    </button>

                                    <button
                                      aria-describedby={
                                        location.bottleCount > 0
                                          ? `archive-location-hint-${location.id}`
                                          : undefined
                                      }
                                      disabled={
                                        !isOnline ||
                                        busyAction !== null ||
                                        location.bottleCount > 0
                                      }
                                      onClick={() =>
                                        void handleArchiveLocation(
                                          location,
                                        )
                                      }
                                      title={
                                        location.bottleCount > 0
                                          ? "Move or remove every bottle before archiving this location"
                                          : undefined
                                      }
                                      type="button"
                                    >
                                      Archive
                                    </button>
                                    {location.bottleCount > 0 ? (
                                      <span
                                        className="cellar-location__archive-hint"
                                        id={`archive-location-hint-${location.id}`}
                                      >
                                        Move bottles first
                                      </span>
                                    ) : null}
                                  </div>
                                )}
                              </li>
                            )
                          },
                        )}
                      </ol>
                    )}

                    {cellar.archivedLocations.length > 0 ? (
                      <details className="cellar-archived-locations">
                        <summary>
                          Archived locations (
                          {cellar.archivedLocations.length})
                        </summary>
                        <ul>
                          {cellar.archivedLocations.map(
                            (location) => (
                              <li key={location.id}>
                                <span>{location.code}</span>
                                <button
                                  disabled={
                                    !isOnline ||
                                    busyAction !== null
                                  }
                                  onClick={() =>
                                    void handleRestoreLocation(
                                      location,
                                    )
                                  }
                                  type="button"
                                >
                                  {busyAction ===
                                  `restore-location:${location.id}`
                                    ? "Restoring…"
                                    : "Restore"}
                                </button>
                              </li>
                            ),
                          )}
                        </ul>
                      </details>
                    ) : null}

                    <div className="cellar-card__archive-action">
                      <div>
                        <strong>Archive this cellar</strong>
                        <span>
                          Archive every active location first. The
                          cellar and its history can be restored.
                        </span>
                      </div>
                      <button
                        disabled={
                          !isOnline ||
                          busyAction !== null ||
                          !canArchiveCellar
                        }
                        onClick={() =>
                          void handleArchiveCellar(cellar)
                        }
                        title={
                          canArchiveCellar
                            ? undefined
                            : "Archive all empty locations first"
                        }
                        type="button"
                      >
                        {busyAction ===
                        `archive-cellar:${cellar.id}`
                          ? "Archiving…"
                          : canArchiveCellar
                            ? "Archive cellar"
                            : "Archive locations first"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      {archivedCellars.length > 0 ? (
        <section
          aria-labelledby="archived-cellars-heading"
          className="cellar-setup-archived"
        >
          <div>
            <h2 id="archived-cellars-heading">
              Archived cellars
            </h2>
            <p>
              Restore a cellar first, then restore only the
              locations that still exist in its physical layout.
            </p>
          </div>

          <ul>
            {archivedCellars.map((cellar) => (
              <li key={cellar.id}>
                <div>
                  <strong>{cellar.name}</strong>
                  <span>
                    {formatLocationCount(
                      cellar.archivedLocations.length,
                    )} archived
                  </span>
                </div>
                <button
                  disabled={!isOnline || busyAction !== null}
                  onClick={() =>
                    void handleRestoreCellar(cellar)
                  }
                  type="button"
                >
                  {busyAction ===
                  `restore-cellar:${cellar.id}`
                    ? "Restoring…"
                    : "Restore cellar"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
