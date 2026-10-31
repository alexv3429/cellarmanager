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
import { StatisticsView } from "./StatisticsView"
import { DrinkingWindowDashboard } from "./DrinkingWindowDashboard"
import { useLanguage } from "../i18n/useLanguage"
import { formatLocalizedDateTime, formatLocalizedNumber } from "../i18n/formatting"
import {
  buildLegacyActivity,
  filterLegacyActivity,
  type LegacyActivityItem,
  type LegacyActivityRow,
} from "../data/legacyActivity"

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

const LEGACY_ACTIVITY_QUERY = `
  select
    legacy.*,
    coalesce(wine.merged_into_wine_id, wine.id) as catalog_wine_id,
    wine.producer,
    wine.cuvee,
    wine.vintage,
    wine.color,
    wine.format_ml
  from legacy_inventory_events legacy
  left join wines wine on wine.id = legacy.wine_id
  where legacy.household_id = ?
  order by legacy.occurred_at desc, legacy.id desc
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

function ArchivedActivityCard({
  item,
  language,
  onOpenWine,
  t,
}: {
  item: LegacyActivityItem
  language: "en" | "fr"
  onOpenWine: (wineId: string) => void
  t: (key: string, values?: Record<string, string>) => string
}) {
  if (item.kind === "opening") {
    return <li className="activity-card activity-card--legacy" key={item.id}>
      <header>
        <div className="activity-card__wine">
          <strong>{t("activity.openingTitle")}</strong>
          <span>{t("activity.openingNotPurchase")}</span>
        </div>
        <span className="activity-status activity-status--history">{t("activity.archivedBadge")}</span>
      </header>
      <p className="activity-card__movement">{t("activity.openingSummary", {
        bottles: formatLocalizedNumber(item.quantity, language),
        bottleWord: t(item.quantity === 1 ? "bottle" : "bottles"),
        wines: formatLocalizedNumber(item.wineCount, language),
        wineWord: t(item.wineCount === 1 ? "wine" : "wines"),
        positions: formatLocalizedNumber(item.entryCount, language),
        positionWord: t(item.entryCount === 1 ? "position" : "positions"),
      })}</p>
      <p className="activity-card__meta"><time dateTime={item.occurredAt}>
        {formatActivityDate(item.occurredAt, language)}
      </time> · {t("activity.openingContext")}</p>
    </li>
  }

  const meta = [
    item.vintage ?? "NV",
    item.color ? t(item.color.trim().toLowerCase()) : null,
    item.formatMl ? formatWineVolume(item.formatMl) : null,
  ].filter((value): value is string | number => value !== null).join(" · ")

  return <li className="activity-card activity-card--legacy" key={item.id}>
    <header>
      <div className="activity-card__wine">
        {item.catalogWineId ? <button className="wine-detail-link" type="button"
          onClick={() => onOpenWine(item.catalogWineId as string)}>{item.wineLabel}</button>
          : <strong>{item.wineLabel}</strong>}
        <span>{meta}</span>
      </div>
      <span className="activity-status activity-status--history">{t("activity.archivedBadge")}</span>
    </header>
    <p className="activity-card__movement"><strong>{t("activity.archivedDrink", {
      count: formatLocalizedNumber(item.quantity, language),
      bottles: t(item.quantity === 1 ? "bottle" : "bottles"),
    })}</strong>{item.sourceLocation ? ` ${t("activity.fromFormerLocation", { location: item.sourceLocation })}` : null}</p>
    <p className="activity-card__meta"><time dateTime={item.occurredAt}>
      {formatActivityDate(item.occurredAt, language)}
    </time> · {t("activity.archivedContext")}</p>
  </li>
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
  const {
    data: legacyRows,
    error: legacyError,
    isLoading: legacyIsLoading,
  } = useQuery<LegacyActivityRow>(LEGACY_ACTIVITY_QUERY, [householdId])

  const [search, setSearch] = useState("")
  const [view, setView] = useState<"movements" | "sync" | "statistics" | "drinking">(() => {
    const tab = new URLSearchParams(window.location.search).get("tab")
    if (tab === "drinking") return "drinking"
    if (window.location.pathname === "/statistics" || tab === "statistics") return "statistics"
    return "movements"
  })
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
  const legacyActivity = useMemo(
    () => buildLegacyActivity(legacyRows, householdId),
    [legacyRows, householdId],
  )
  const visibleActivity = useMemo(
    () =>
      filterInventoryActivity(activity, {
        operationType,
        search,
        status: view === "movements" ? "ACCEPTED" : status,
      }),
    [activity, operationType, search, status, view],
  )
  const visibleLegacy = useMemo(
    () => view === "movements"
      ? filterLegacyActivity(legacyActivity, { operationType, search, status: "ALL" })
      : [],
    [legacyActivity, operationType, search, view],
  )
  const timeline = useMemo(() => [
    ...visibleActivity.map((item) => ({ kind: "modern" as const, key: `operation:${item.id}`, occurredAt: item.created_at_client, item })),
    ...visibleLegacy.map((item) => ({ kind: "legacy" as const, key: item.id, occurredAt: item.occurredAt, item })),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.key.localeCompare(b.key)),
  [visibleActivity, visibleLegacy])
  const totalTimelineEntries = view === "movements"
    ? summary.acceptedCount + legacyActivity.length
    : activity.length
  const isTimelineLoading = isLoading || (view === "movements" && legacyIsLoading)
  const hasFilters =
    search.trim().length > 0 ||
    operationType !== "ALL" ||
    (view === "sync" && status !== "ALL")

  function selectView(nextView: "movements" | "sync" | "statistics" | "drinking") {
    setView(nextView)
    setSearch("")
    setOperationType("ALL")
    const url = new URL(window.location.href)
    if (nextView === "statistics" || nextView === "drinking") url.searchParams.set("tab", nextView)
    else url.searchParams.delete("tab")
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
  }

  return (
    <main>
      <div className="activity-heading">
        <div>
          <h1>{t("Activity")}</h1>
          <p>{t(view === "movements" ? "activity.timelineIntro" : view === "sync" ? "activity.syncIntro"
            : view === "drinking" ? "drinking.intro" : "statistics.intro")}</p>
        </div>
      </div>

      <nav aria-label={t("activity.sections")} className="activity-mode-switch">
        <button aria-pressed={view === "movements"} onClick={() => selectView("movements")} type="button">
          {t("activity.movementsTab")}
        </button>
        <button aria-pressed={view === "sync"} onClick={() => selectView("sync")} type="button">
          {t("activity.syncTab")}
          {summary.pendingCount > 0 ? <span className="activity-mode-switch__count">{formatLocalizedNumber(summary.pendingCount, language)}</span> : null}
        </button>
        <button aria-pressed={view === "statistics"} onClick={() => selectView("statistics")} type="button">
          {t("nav.statistics")}
        </button>
        <button aria-pressed={view === "drinking"} onClick={() => selectView("drinking")} type="button">
          {t("drinking.title")}
        </button>
      </nav>

      {view === "statistics" ? <StatisticsView householdId={householdId} onOpenWine={onOpenWine} />
        : view === "drinking" ? <DrinkingWindowDashboard householdId={householdId} isOnline={isOnline} onOpenWine={onOpenWine} /> : <>
      {view === "sync" ? <InventoryQueueReview householdId={householdId} userId={userId} isOnline={isOnline} /> : null}

      {error ? (
        <Notice role="alert" tone="error">{t("Unable to load activity:")}{String(error)}
        </Notice>
      ) : null}
      {view === "movements" && legacyError ? <Notice role="alert" tone="error">{t("activity.historyLoadError")}{String(legacyError)}</Notice> : null}

      {view === "sync" ? <section
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
      </section> : null}

      {view === "sync" && summary.pendingCount > 0 ? (
        <Notice role="status" tone="warning">
          <strong>
            {formatLocalizedNumber(summary.pendingCount, language)}{t(" ")}{t("local")}{t(" ")}{summary.pendingCount === 1 ? "change is" : "changes are"}{t("waiting for server confirmation")}</strong>
          <p>{t("These are not yet confirmed stock changes. Temporary connection failures retry automatically. If an upload is blocked by access or registration changes, review this browser’s queue above.")}</p>
        </Notice>
      ) : null}

      {view === "sync" && summary.rejectedCount > 0 ? (
        <Notice role="status" tone="error">
          <strong>
            {formatLocalizedNumber(summary.rejectedCount, language)} {summary.rejectedCount === 1 ? "change was" : "changes were"}{t("rejected")}</strong>
          <p>{t("These are historical rejections, not changes still waiting to upload. They did not change stock. Review the explanation and current stock before making a separate new request.")}</p>
          <button type="button" onClick={() => { setView("sync"); setStatus("REJECTED"); setOperationType("ALL"); setSearch("") }}>{t("Show rejected changes")}</button>
        </Notice>
      ) : null}

      {view === "movements" && legacyActivity.length > 0 ? (
        <p className="activity-import-explainer">{t("activity.importExplainer")}</p>
      ) : null}

      <section
        aria-labelledby="activity-filters-heading"
        className={`activity-filters${view === "movements" ? " activity-filters--movements" : ""}`}
      >
        <h2 id="activity-filters-heading">{t("activity.filterTitle")}</h2>

        <label>{t("Search")}<input
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t(view === "movements" ? "activity.movementSearch" : "Wine, cellar, location, device, error…")}
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

        {view === "sync" ? <label>{t("activity.sourceFilter")}<select
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
        </label> : null}

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

      <p aria-live="polite" className="activity-results-summary">{t(view === "movements" ? "activity.movementsSummary" : "activity.syncSummary", {
        shown: formatLocalizedNumber(timeline.length, language),
        total: formatLocalizedNumber(totalTimelineEntries, language),
      })}</p>

      {isTimelineLoading ? (
        <Notice role="status">{t("Loading activity…")}</Notice>
      ) : null}

      {!isTimelineLoading && totalTimelineEntries === 0 ? (
        <p>{t(view === "movements" ? "activity.noMovements" : "No inventory activity found.")}</p>
      ) : null}

      {!isTimelineLoading && totalTimelineEntries > 0 && timeline.length === 0 ? (
        <p>{t("No activity matches the current filters.")}</p>
      ) : null}

      <ol className="activity-list">
        {timeline.map((entry) => {
          if (entry.kind === "legacy") {
            return <ArchivedActivityCard item={entry.item} key={entry.key} language={language}
              onOpenWine={onOpenWine} t={t} />
          }
          const item = entry.item
          return <li className="activity-card" key={entry.key}>
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

              {view === "sync" ? <span
                className={`activity-status activity-status--${item.statusTone}`}
              >
                {t(item.statusLabel)}
              </span> : null}
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
        })}
      </ol>
      </>}
    </main>
  )
}
