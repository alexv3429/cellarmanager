import { useQuery } from "@powersync/react"
import { useMemo, useState } from "react"

import {
  buildInventoryInsights,
  type InsightsLegacyRow,
  type InsightsOperationRow,
  type InsightsPeriod,
} from "../data/inventoryInsights"
import { formatLocalizedNumber } from "../i18n/formatting"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface StockRow { total: number }

const STOCK_QUERY = `
  select coalesce(sum(quantity), 0) as total
  from holdings
  where household_id = ?
`
const OPERATIONS_QUERY = `
  select household_id, operation_type, quantity, remove_reason, status,
    created_at_client, received_at_server
  from inventory_operations
  where household_id = ? and status = 'ACCEPTED'
`
const LEGACY_QUERY = `
  select household_id, archive_source_sha256, event_type, quantity,
    remove_reason, occurred_at
  from legacy_inventory_events
  where household_id = ?
`

export function StatisticsView({ householdId }: { householdId: string }) {
  const { language, t } = useLanguage()
  const [period, setPeriod] = useState<InsightsPeriod>("12m")
  const { data: stockRows, error: stockError, isLoading: stockLoading } =
    useQuery<StockRow>(STOCK_QUERY, [householdId])
  const { data: operations, error: operationError, isLoading: operationsLoading } =
    useQuery<InsightsOperationRow>(OPERATIONS_QUERY, [householdId])
  const { data: legacy, error: legacyError, isLoading: legacyLoading } =
    useQuery<InsightsLegacyRow>(LEGACY_QUERY, [householdId])
  const loading = stockLoading || operationsLoading || legacyLoading
  const error = stockError || operationError || legacyError
  const insights = useMemo(
    () => buildInventoryInsights(
      operations, legacy, householdId, Number(stockRows[0]?.total ?? 0), period, new Date(),
    ),
    [operations, legacy, householdId, stockRows, period],
  )
  const number = (value: number) => formatLocalizedNumber(value, language)
  const formatPeriod = (iso: string) => new Intl.DateTimeFormat(language === "fr" ? "fr-FR" : "en-GB", {
    day: period === "30d" ? "numeric" : undefined,
    month: "short",
    year: period === "12m" ? "2-digit" : undefined,
    timeZone: "UTC",
  }).format(new Date(iso))
  const maxFlow = Math.max(1, ...insights.buckets.map((bucket) => Math.max(bucket.added, bucket.removed)))
  const stockValues = insights.buckets.map((bucket) => bucket.closingStock ?? 0)
  const minStock = Math.min(...stockValues)
  const maxStock = Math.max(...stockValues)
  const stockSpan = Math.max(1, maxStock - minStock)
  const stockPoints = stockValues.map((value, index) =>
    `${24 + index * 552 / Math.max(1, stockValues.length - 1)},${155 - (value - minStock) * 120 / stockSpan}`,
  ).join(" ")

  return <main className="statistics-view">
    <header className="statistics-heading">
      <h1>{t("nav.statistics")}</h1>
      <p>{t("statistics.intro")}</p>
    </header>
    <div className="statistics-period" role="group" aria-label={t("statistics.period")}>
      <button aria-pressed={period === "30d"} onClick={() => setPeriod("30d")} type="button">{t("statistics.last30")}</button>
      <button aria-pressed={period === "12m"} onClick={() => setPeriod("12m")} type="button">{t("statistics.last12")}</button>
    </div>
    {error ? <Notice role="alert" tone="error">{t("statistics.loadError")}</Notice> : null}
    {loading ? <p role="status">{t("statistics.loading")}</p> : null}
    {!loading && !error ? <>
      <section aria-label={t("statistics.summary")} className="statistics-kpis">
        <div><span>{t("statistics.current")}</span><strong>{number(insights.currentStock)}</strong><small>{t("statistics.currentHelp")}</small></div>
        <div><span>{t("statistics.added")}</span><strong>{number(insights.added)}</strong></div>
        <div><span>{t("statistics.removed")}</span><strong>{number(insights.removed)}</strong></div>
        <div><span>{t("statistics.net")}</span><strong>{insights.net > 0 ? "+" : ""}{number(insights.net)}</strong></div>
      </section>
      <p className="statistics-consumed">{t("statistics.consumed", { count: number(insights.consumed) })}</p>
      <section className="statistics-chart" aria-labelledby="statistics-flow-title">
        <h2 id="statistics-flow-title">{t("statistics.flowTitle")}</h2>
        <p>{t("statistics.flowHelp")}</p>
        <p>{t(period === "30d" ? "statistics.grouping30" : "statistics.grouping12")}</p>
        <div className="statistics-legend"><span className="statistics-legend__add" />{t("statistics.added")}<span className="statistics-legend__remove" />{t("statistics.removed")}</div>
        {insights.added === 0 && insights.removed === 0
          ? <p>{t("statistics.noMovements")}</p>
          : <div className="statistics-flow-list">
              {insights.buckets.map((bucket) => <div className="statistics-flow-row" key={bucket.start}>
                <time dateTime={bucket.start}>{formatPeriod(bucket.start)}</time>
                <div className="statistics-flow-bars">
                  <span aria-label={t("statistics.addedCount", { count: number(bucket.added) })}
                    className="statistics-flow-bar statistics-flow-bar--add" style={{ width: `${bucket.added / maxFlow * 100}%` }} />
                  <span aria-label={t("statistics.removedCount", { count: number(bucket.removed) })}
                    className="statistics-flow-bar statistics-flow-bar--remove" style={{ width: `${bucket.removed / maxFlow * 100}%` }} />
                </div>
                <span className="statistics-flow-values">+{number(bucket.added)} / −{number(bucket.removed)}</span>
              </div>)}
            </div>}
      </section>
      <section className="statistics-chart" aria-labelledby="statistics-stock-title">
        <h2 id="statistics-stock-title">{t("statistics.stockTitle")}</h2>
        {insights.stockHistoryAvailable ? <>
          <p>{t("statistics.stockHelp")}</p>
          <svg aria-label={t("statistics.stockTitle")} className="statistics-stock-plot" role="img" viewBox="0 0 600 180">
            <line x1="24" x2="576" y1="155" y2="155" />
            <polyline fill="none" points={stockPoints} />
            {stockValues.map((value, index) =>
              <circle cx={24 + index * 552 / Math.max(1, stockValues.length - 1)}
                cy={155 - (value - minStock) * 120 / stockSpan} key={insights.buckets[index].start} r="4">
                <title>{formatPeriod(insights.buckets[index].start)}: {number(value)}</title>
              </circle>)}
          </svg>
          <div className="statistics-stock-labels"><span>{formatPeriod(insights.buckets[0].start)} · {number(stockValues[0])}</span><span>{formatPeriod(insights.buckets.at(-1)?.start ?? "")} · {number(stockValues.at(-1) ?? 0)}</span></div>
          <details><summary>{t("statistics.tableTitle")}</summary>
            <table><thead><tr><th>{t("statistics.period")}</th><th>{t("statistics.closingStock")}</th></tr></thead>
              <tbody>{insights.buckets.map((bucket) => <tr key={bucket.start}><th>{formatPeriod(bucket.start)}</th><td>{number(bucket.closingStock ?? 0)}</td></tr>)}</tbody></table>
          </details>
        </> : <p>{t("statistics.stockUnavailable")}</p>}
      </section>
    </> : null}
  </main>
}
