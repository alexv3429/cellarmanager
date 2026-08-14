import { useQuery } from "@powersync/react"
import { useMemo, useState } from "react"

import {
  buildInventoryActivity,
  filterInventoryActivity,
  summarizeInventoryActivity,
  type ActivityFilterValue,
  type ActivityStatusFilter,
  type InventoryActivityItem,
  type InventoryActivityRow,
} from "../data/activityView"
import { Notice } from "./Notice"

interface ActivityViewProps {
  householdId: string
  onOpenWine: (wineId: string) => void
}

const ACTIVITY_QUERY = `
  select
    operation.id,
    operation.user_id,
    operation.operation_type,
    operation.wine_id,
    wine.id as catalog_wine_id,
    coalesce(wine.producer, operation.wine_producer) as producer,
    coalesce(wine.cuvee, operation.wine_cuvee) as cuvee,
    coalesce(wine.vintage, operation.wine_vintage) as vintage,
    coalesce(wine.color, operation.wine_color) as color,
    coalesce(wine.format_ml, operation.wine_format_ml) as format_ml,
    source.code as source_code,
    source_cellar.name as source_cellar_name,
    destination.code as destination_code,
    destination_cellar.name as destination_cellar_name,
    operation.quantity,
    operation.remove_reason,
    operation.status,
    operation.error_code,
    operation.error_message,
    operation.created_at_client,
    operation.received_at_server,
    device.name as device_name
  from inventory_operations operation
  left join wines wine
    on wine.id = operation.wine_id
  left join locations source
    on source.id = operation.source_location_id
  left join cellars source_cellar
    on source_cellar.id = source.cellar_id
  left join locations destination
    on destination.id = operation.destination_location_id
  left join cellars destination_cellar
    on destination_cellar.id = destination.cellar_id
  left join devices device
    on device.id = operation.device_id
  where operation.household_id = ?
  order by operation.created_at_client desc, operation.id desc
  limit 100
`

const activityDateFormatter = new Intl.DateTimeFormat(
  undefined,
  {
    dateStyle: "medium",
    timeStyle: "short",
  },
)

function formatActivityDate(value: string): string {
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? value
    : activityDateFormatter.format(date)
}

function activityMovement(item: InventoryActivityItem): string {
  switch (item.operation_type) {
    case "ADD":
      return `to ${item.destinationLabel ?? "an unknown location"}`
    case "MOVE":
      return `from ${item.sourceLabel ?? "an unknown location"} to ${item.destinationLabel ?? "an unknown location"}`
    case "REMOVE":
      return `from ${item.sourceLabel ?? "an unknown location"}`
  }
}

export function ActivityView({
  householdId,
  onOpenWine,
}: ActivityViewProps) {
  const {
    data: activityRows,
    error,
    isLoading,
  } = useQuery<InventoryActivityRow>(
    ACTIVITY_QUERY,
    [householdId],
  )

  const [search, setSearch] = useState("")
  const [operationType, setOperationType] =
    useState<ActivityFilterValue>("ALL")
  const [status, setStatus] =
    useState<ActivityStatusFilter>("ALL")

  const activity = useMemo(
    () => buildInventoryActivity(activityRows),
    [activityRows],
  )
  const summary = useMemo(
    () => summarizeInventoryActivity(activity),
    [activity],
  )
  const visibleActivity = useMemo(
    () =>
      filterInventoryActivity(activity, {
        operationType,
        search,
        status,
      }),
    [activity, operationType, search, status],
  )
  const hasFilters =
    search.trim().length > 0 ||
    operationType !== "ALL" ||
    status !== "ALL"

  return (
    <main>
      <div className="activity-heading">
        <div>
          <h1>Activity</h1>
          <p>
            Recent inventory changes from every synchronized
            device in this household.
          </p>
        </div>
      </div>

      {error ? (
        <Notice role="alert" tone="error">
          Unable to load activity: {String(error)}
        </Notice>
      ) : null}

      <section
        aria-label="Activity summary"
        className="activity-summary"
      >
        <div>
          <strong>{summary.totalCount}</strong>
          <span>Recent operations</span>
        </div>
        <div>
          <strong>{summary.pendingCount}</strong>
          <span>Queued</span>
        </div>
        <div>
          <strong>{summary.rejectedCount}</strong>
          <span>Rejected</span>
        </div>
        <div>
          <strong>{summary.acceptedCount}</strong>
          <span>Synced</span>
        </div>
      </section>

      {summary.pendingCount > 0 ? (
        <Notice role="status" tone="warning">
          <strong>
            {summary.pendingCount} local {summary.pendingCount === 1 ? "change is" : "changes are"} waiting for server confirmation
          </strong>
          <p>
            Inventory already includes these optimistic changes.
            They will retry automatically when synchronization is
            available.
          </p>
        </Notice>
      ) : null}

      {summary.rejectedCount > 0 ? (
        <Notice role="status" tone="error">
          <strong>
            {summary.rejectedCount} {summary.rejectedCount === 1 ? "change was" : "changes were"} rejected
          </strong>
          <p>
            The server explanation is shown on each rejected
            activity card. Rejected changes are not included in
            authoritative holdings.
          </p>
        </Notice>
      ) : null}

      <section
        aria-labelledby="activity-filters-heading"
        className="activity-filters"
      >
        <h2 id="activity-filters-heading">
          Filter recent activity
        </h2>

        <label>
          Search
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Wine, cellar, location, device, error…"
            type="search"
            value={search}
          />
        </label>

        <label>
          Operation
          <select
            onChange={(event) =>
              setOperationType(
                event.target.value as ActivityFilterValue,
              )
            }
            value={operationType}
          >
            <option value="ALL">All operations</option>
            <option value="ADD">Add</option>
            <option value="MOVE">Move</option>
            <option value="REMOVE">Remove</option>
          </select>
        </label>

        <label>
          Synchronization
          <select
            onChange={(event) =>
              setStatus(
                event.target.value as ActivityStatusFilter,
              )
            }
            value={status}
          >
            <option value="ALL">All states</option>
            <option value="PENDING">Queued</option>
            <option value="ACCEPTED">Synced</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>

        <button
          disabled={!hasFilters}
          onClick={() => {
            setSearch("")
            setOperationType("ALL")
            setStatus("ALL")
          }}
          type="button"
        >
          Clear filters
        </button>
      </section>

      <p aria-live="polite" className="activity-results-summary">
        Showing {visibleActivity.length} of {activity.length} latest
        operations. Activity is limited to the most recent 100.
      </p>

      {isLoading ? (
        <Notice role="status">Loading activity…</Notice>
      ) : null}

      {!isLoading && activity.length === 0 ? (
        <p>No inventory activity found.</p>
      ) : null}

      {!isLoading &&
      activity.length > 0 &&
      visibleActivity.length === 0 ? (
        <p>No activity matches the current filters.</p>
      ) : null}

      <ol className="activity-list">
        {visibleActivity.map((item) => (
          <li className="activity-card" key={item.id}>
            <header>
              <div className="activity-card__wine">
                {item.catalog_wine_id ? (
                  <button
                    className="wine-detail-link"
                    onClick={() =>
                      onOpenWine(item.catalog_wine_id as string)
                    }
                    type="button"
                  >
                    {item.wineLabel}
                  </button>
                ) : (
                  <strong>{item.wineLabel}</strong>
                )}
                <span>{item.wineMeta}</span>
              </div>

              <span
                className={`activity-status activity-status--${item.statusTone}`}
              >
                {item.statusLabel}
              </span>
            </header>

            <p className="activity-card__movement">
              <strong>
                {item.actionLabel} {item.quantityLabel}
              </strong>{" "}
              {activityMovement(item)}
            </p>

            <p className="activity-card__meta">
              <time dateTime={item.created_at_client}>
                {formatActivityDate(item.created_at_client)}
              </time>
              <span aria-hidden="true"> · </span>
              {item.device_name ?? "Unknown device"}
              {item.reasonLabel ? (
                <>
                  <span aria-hidden="true"> · </span>
                  Reason: {item.reasonLabel}
                </>
              ) : null}
            </p>

            {item.status === "PENDING" ? (
              <p className="activity-card__pending">
                Stored locally and queued for automatic retry.
              </p>
            ) : null}

            {item.status === "REJECTED" ? (
              <div
                className="activity-card__error"
                role="alert"
              >
                <strong>
                  {item.error_code ?? "Server rejection"}
                </strong>
                <span>
                  {item.error_message ??
                    "The server rejected this inventory change."}
                </span>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </main>
  )
}
