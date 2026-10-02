import { useQuery } from "@powersync/react"
import { useMemo, useState } from "react"

import {
  buildConsumptionHistory,
  type ConsumptionLegacyRow,
  type ConsumptionOperationRow,
} from "../data/consumptionHistory"
import type { InsightsPeriod } from "../data/inventoryInsights"
import { formatLocalizedDate, formatLocalizedNumber } from "../i18n/formatting"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

const CONSUMPTION_QUERY = `
  select operation.id, operation.household_id, operation.wine_id,
    coalesce(wine.merged_into_wine_id, wine.id) as catalog_wine_id,
    coalesce(wine.producer, operation.wine_producer) as producer,
    coalesce(wine.cuvee, operation.wine_cuvee) as cuvee,
    coalesce(wine.vintage, operation.wine_vintage) as vintage,
    operation.operation_type, operation.quantity, operation.remove_reason,
    operation.status, operation.created_at_client, operation.received_at_server,
    cellar.name as source_cellar_name, location.code as source_code
  from inventory_operations operation
  left join wines wine on wine.id = operation.wine_id
  left join locations location on location.id = operation.source_location_id
  left join cellars cellar on cellar.id = location.cellar_id
  where operation.household_id = ? and operation.operation_type = 'REMOVE'
    and operation.remove_reason = 'DRANK' and operation.status = 'ACCEPTED'
  order by operation.created_at_client desc
`

const LEGACY_CONSUMPTION_QUERY = `
  select legacy.source_record_id, legacy.household_id, legacy.archive_source_sha256,
    legacy.wine_id, coalesce(wine.merged_into_wine_id, wine.id) as catalog_wine_id,
    wine.producer, wine.cuvee, wine.vintage, legacy.event_type, legacy.quantity,
    legacy.remove_reason, legacy.occurred_at, legacy.source_from_location
  from legacy_inventory_events legacy
  left join wines wine on wine.id = legacy.wine_id
  where legacy.household_id = ?
`

interface ConsumptionHistoryViewProps {
  householdId: string
  period: InsightsPeriod
  onOpenWine: (wineId: string) => void
}

export function ConsumptionHistoryView({ householdId, period, onOpenWine }: ConsumptionHistoryViewProps) {
  const { language, t } = useLanguage()
  const [showAll, setShowAll] = useState(false)
  const [visibleCount, setVisibleCount] = useState(20)
  const { data: operations, error: operationsError, isLoading: operationsLoading } =
    useQuery<ConsumptionOperationRow>(CONSUMPTION_QUERY, [householdId])
  const { data: legacy, error: legacyError, isLoading: legacyLoading } =
    useQuery<ConsumptionLegacyRow>(LEGACY_CONSUMPTION_QUERY, [householdId])
  const history = useMemo(() => buildConsumptionHistory(
    operations, legacy, householdId, showAll ? "all" : period, new Date(),
  ), [operations, legacy, householdId, period, showAll])
  const entries = history.entries.slice(0, visibleCount)
  const number = (value: number) => formatLocalizedNumber(value, language)

  return <section aria-labelledby="consumption-history-title" className="statistics-chart consumption-history">
    <h2 id="consumption-history-title">{t("consumption.title")}</h2>
    <p>{t("consumption.intro")}</p>
    <div className="consumption-history__scope" role="group" aria-label={t("consumption.scopeLabel")}>
      <button aria-pressed={!showAll} onClick={() => { setShowAll(false); setVisibleCount(20) }} type="button">{t(period === "30d" ? "statistics.last30" : "statistics.last12")}</button>
      <button aria-pressed={showAll} onClick={() => { setShowAll(true); setVisibleCount(20) }} type="button">{t("consumption.allTime")}</button>
    </div>
    {operationsError || legacyError ? <Notice role="alert" tone="error">{t("consumption.loadError")}</Notice> : null}
    {operationsLoading || legacyLoading ? <p role="status">{t("consumption.loading")}</p> : null}
    {!operationsLoading && !legacyLoading && !operationsError && !legacyError ? <>
      {history.archiveAmbiguous ? <Notice tone="warning">{t("consumption.archiveAmbiguous")}</Notice> : null}
      <p className="consumption-history__summary">{t(history.bottles === 1 ? "consumption.summaryOne" : "consumption.summary", {
        bottles: number(history.bottles), wines: number(history.wines),
        wineWord: t(history.wines === 1 ? "consumption.oneWine" : "consumption.manyWines"),
      })}</p>
      {history.entries.length === 0 ? <p>{t("consumption.empty")}</p> : <>
        <ol className="consumption-history__list">
          {entries.map((entry) => <li className="consumption-history__entry" key={entry.id}>
            <div className="consumption-history__entry-heading">
              <time dateTime={entry.occurredAt}>{formatLocalizedDate(entry.occurredAt, language)}</time>
              <strong>{t(entry.quantity === 1 ? "consumption.oneBottle" : "consumption.manyBottles", {
                count: number(entry.quantity),
              })}</strong>
            </div>
            {entry.catalogWineId
              ? <button className="consumption-history__wine" onClick={() => onOpenWine(entry.catalogWineId as string)} type="button">
                  {[entry.producer, entry.cuvee, entry.vintage].filter((part) => part !== null && part !== "").join(" · ") || t("consumption.unknownWine")}
                </button>
              : <span className="consumption-history__wine-label">{[entry.producer, entry.cuvee, entry.vintage].filter((part) => part !== null && part !== "").join(" · ") || t("consumption.unknownWine")}</span>}
            {entry.location ? <small>{t("consumption.location", { location: entry.location })}</small> : null}
            {entry.source === "imported" ? <small>{t("consumption.imported")}</small> : null}
          </li>)}
        </ol>
        {history.entries.length > visibleCount ? <button className="consumption-history__more" onClick={() => setVisibleCount((count) => count + 20)} type="button">
          {t("consumption.showMore")}
        </button> : null}
      </>}
    </> : null}
  </section>
}
