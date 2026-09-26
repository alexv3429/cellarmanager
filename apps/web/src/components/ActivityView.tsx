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
import { describeInventoryRejection } from "../data/inventoryRecovery"
import { formatWineVolume } from "../data/wineCatalog"
import { InventoryQueueReview } from "./InventoryQueueReview"
import { useLanguage } from "../i18n/useLanguage"
import { formatLocalizedDateTime, formatLocalizedNumber } from "../i18n/formatting"

interface ActivityViewProps {
  householdId: string
  userId: string
  isOnline: boolean
  onOpenWine: (wineId: string) => void
}

const ACTIVITY_QUERY = `
  select
    operation.id,
    operation.user_id,
    operation.operation_type,
    operation.wine_id,
    coalesce(wine.merged_into_wine_id, wine.id) as catalog_wine_id,
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

function formatActivityDate(value: string, language: "en" | "fr"): string {
  return formatLocalizedDateTime(value, language, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function activityMovement(
  item: InventoryActivityItem,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  switch (item.operation_type) {
    case "ADD":
      return t("to {location}", {
        location: item.destinationLabel ?? t("an unknown location"),
      })
    case "MOVE":
      return t("from {source} to {destination}", {
        source: item.sourceLabel ?? t("an unknown location"),
        destination: item.destinationLabel ?? t("an unknown location"),
      })
    case "REMOVE":
      return t("from {location}", {
        location: item.sourceLabel ?? t("an unknown location"),
      })
  }
}

function activityWineMeta(
  item: InventoryActivityItem,
  t: (key: string) => string,
): string {
  return [
    item.vintage ?? "NV",
    item.color ? t(item.color.trim().toLowerCase()) : null,
    item.format_ml ? formatWineVolume(item.format_ml) : null,
  ]
    .filter((value): value is string | number => value !== null)
    .join(" · ")
}

export function ActivityView({
  householdId,
  userId,
  isOnline,
  onOpenWine,
}: ActivityViewProps) {
  const { language, t } = useLanguage()
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
          <h1>{t("Activity")}</h1>
          <p>{t("Recent inventory changes from every synchronized device in this household.")}</p>
        </div>
      </div>

      <InventoryQueueReview householdId={householdId} userId={userId} isOnline={isOnline} />

      {error ? (
        <Notice role="alert" tone="error">{t("Unable to load activity:")}{String(error)}
        </Notice>
      ) : null}

      <section
        aria-label={t("Activity summary")}
        className="activity-summary"
      >
        <div>
          <strong>{formatLocalizedNumber(summary.totalCount, language)}</strong>
          <span>{t("Recent operations")}</span>
        </div>
        <div>
          <strong>{formatLocalizedNumber(summary.pendingCount, language)}</strong>
          <span>{t("Queued")}</span>
        </div>
        <div>
          <strong>{formatLocalizedNumber(summary.rejectedCount, language)}</strong>
          <span>{t("Rejected")}</span>
        </div>
        <div>
          <strong>{formatLocalizedNumber(summary.acceptedCount, language)}</strong>
          <span>{t("Synced")}</span>
        </div>
      </section>

      {summary.pendingCount > 0 ? (
        <Notice role="status" tone="warning">
          <strong>
            {formatLocalizedNumber(summary.pendingCount, language)}{t(" ")}{t("local")}{t(" ")}{summary.pendingCount === 1 ? "change is" : "changes are"}{t("waiting for server confirmation")}</strong>
          <p>{t("These are not yet confirmed stock changes. Temporary connection failures retry automatically. If an upload is blocked by access or registration changes, review this browser’s queue above.")}</p>
        </Notice>
      ) : null}

      {summary.rejectedCount > 0 ? (
        <Notice role="status" tone="error">
          <strong>
            {formatLocalizedNumber(summary.rejectedCount, language)} {summary.rejectedCount === 1 ? "change was" : "changes were"}{t("rejected")}</strong>
          <p>{t("These are historical rejections, not changes still waiting to upload. They did not change stock. Review the explanation and current stock before making a separate new request.")}</p>
          <button type="button" onClick={() => { setStatus("REJECTED"); setOperationType("ALL"); setSearch("") }}>{t("Show rejected changes")}</button>
        </Notice>
      ) : null}

      <section
        aria-labelledby="activity-filters-heading"
        className="activity-filters"
      >
        <h2 id="activity-filters-heading">{t("Filter recent activity")}</h2>

        <label>{t("Search")}<input
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Wine, cellar, location, device, error…")}
            type="search"
            value={search}
          />
        </label>

        <label>{t("Operation")}<select
            onChange={(event) =>
              setOperationType(
                event.target.value as ActivityFilterValue,
              )
            }
            value={operationType}
          >
            <option value="ALL">{t("All operations")}</option>
            <option value="ADD">{t("Add")}</option>
            <option value="MOVE">{t("Move")}</option>
            <option value="REMOVE">{t("Remove")}</option>
          </select>
        </label>

        <label>{t("Synchronization")}<select
            onChange={(event) =>
              setStatus(
                event.target.value as ActivityStatusFilter,
              )
            }
            value={status}
          >
            <option value="ALL">{t("All states")}</option>
            <option value="PENDING">{t("Queued")}</option>
            <option value="ACCEPTED">{t("Synced")}</option>
            <option value="REJECTED">{t("Rejected")}</option>
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
        >{t("Clear filters")}</button>
      </section>

      <p aria-live="polite" className="activity-results-summary">{t("activity.resultsSummary", { shown: String(visibleActivity.length), total: String(activity.length) })}</p>

      {isLoading ? (
        <Notice role="status">{t("Loading activity…")}</Notice>
      ) : null}

      {!isLoading && activity.length === 0 ? (
        <p>{t("No inventory activity found.")}</p>
      ) : null}

      {!isLoading &&
      activity.length > 0 &&
      visibleActivity.length === 0 ? (
        <p>{t("No activity matches the current filters.")}</p>
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
                <span>{activityWineMeta(item, t)}</span>
              </div>

              <span
                className={`activity-status activity-status--${item.statusTone}`}
              >
                {t(item.statusLabel)}
              </span>
            </header>

            <p className="activity-card__movement">
              <strong>
                {t(item.actionLabel)} {formatLocalizedNumber(item.quantity, language)} {t(item.quantity === 1 ? "bottle" : "bottles")}
              </strong>{" "}
              {activityMovement(item, t)}
            </p>

            <p className="activity-card__meta">
              <time dateTime={item.created_at_client}>
                {formatActivityDate(item.created_at_client, language)}
              </time>
              <span aria-hidden="true"> · </span>
              {item.device_name ?? t("Unknown device")}
              {item.reasonLabel ? (
                <>
                  <span aria-hidden="true"> · </span>{t("Reason:")}{" "}{t(item.reasonLabel)}
                </>
              ) : null}
            </p>

            {item.status === "PENDING" ? (
              <p className="activity-card__pending">{t("Stored locally and queued for automatic retry.")}</p>
            ) : null}

            {item.status === "REJECTED" ? (
              <div className="activity-card__error">
                <strong>{describeInventoryRejection(item.error_code).title}</strong>
                <p>{describeInventoryRejection(item.error_code).explanation}</p>
                <p><strong>{t("No stock change was applied by this request.")}</strong> {describeInventoryRejection(item.error_code).nextStep}</p>
                {item.catalog_wine_id ? <button type="button" onClick={() => onOpenWine(item.catalog_wine_id as string)}>{t("Review current stock")}</button> : <p>{t("The wine is not available in the synchronized catalog yet. Wait for synchronization or ask an Owner to review the catalog.")}</p>}
                <details><summary>{t("Show technical details")}</summary><dl>
                  <div><dt>{t("Request ID")}</dt><dd>{item.id}</dd></div>
                  <div><dt>{t("Server code")}</dt><dd>{item.error_code ?? "Not provided"}</dd></div>
                  <div><dt>{t("Server message")}</dt><dd>{item.error_message ?? "Not provided"}</dd></div>
                </dl></details>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </main>
  )
}
