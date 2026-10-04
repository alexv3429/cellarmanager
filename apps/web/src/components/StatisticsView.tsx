import { useQuery } from "@powersync/react"
import { useMemo, useState } from "react"

import {
  buildInventoryInsights,
  type InsightsLegacyRow,
  type InsightsOperationRow,
  type InsightsPeriod,
  type InsightsBreakdownRow,
  type InsightsStockRow,
} from "../data/inventoryInsights"
import { formatLocalizedNumber } from "../i18n/formatting"
import { useLanguage } from "../i18n/useLanguage"
import { ConsumptionHistoryView } from "./ConsumptionHistoryView"
import { Notice } from "./Notice"

const STOCK_QUERY = `
  select holding.household_id, holding.quantity, wine.color, wine.area
  from holdings holding
  left join wines wine on wine.id = holding.wine_id and wine.household_id = holding.household_id
  where holding.household_id = ? and holding.quantity > 0
`
const OPERATIONS_QUERY = `
  select operation.household_id, operation.operation_type, operation.quantity,
    operation.remove_reason, operation.status, operation.created_at_client,
    operation.received_at_server,
    coalesce(nullif(trim(operation.wine_color), ''), wine.color) as color,
    coalesce(nullif(trim(operation.wine_area), ''), wine.area) as area
  from inventory_operations operation
  left join wines wine on wine.id = operation.wine_id and wine.household_id = operation.household_id
  where operation.household_id = ? and operation.status = 'ACCEPTED'
`
const LEGACY_QUERY = `
  select legacy.household_id, legacy.archive_source_sha256, legacy.event_type,
    legacy.quantity, legacy.remove_reason, legacy.occurred_at, wine.color, wine.area
  from legacy_inventory_events legacy
  left join wines wine on wine.id = legacy.wine_id and wine.household_id = legacy.household_id
  where legacy.household_id = ?
`

function BreakdownTable({ rows, title, dimension, unknown, translateLabels = false }: {
  rows: readonly InsightsBreakdownRow[]
  title: string
  dimension: string
  unknown: string
  translateLabels?: boolean
}) {
  const { language, t } = useLanguage()
  const number = (value: number) => formatLocalizedNumber(value, language)
  if (rows.length === 0) return <p>{t("statistics.noBreakdown")}</p>
  const label = (row: InsightsBreakdownRow) => row.label === null ? unknown : translateLabels ? t(row.label) : row.label
  return <>
    <div className="statistics-breakdown-scroll"><table aria-label={title} className="statistics-breakdown-table">
      <thead><tr><th scope="col">{dimension}</th><th scope="col">{t("statistics.current")}</th>
        <th scope="col">{t("statistics.added")}</th><th scope="col">{t("statistics.removed")}</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}>
        <th scope="row">{label(row)}</th>
        <td>{number(row.current)}</td><td className="statistics-breakdown-added">+{number(row.added)}</td>
        <td className="statistics-breakdown-removed">−{number(row.removed)}</td>
      </tr>)}</tbody>
    </table></div>
    <ul aria-label={title} className="statistics-breakdown-list">
      {rows.map((row) => <li key={row.key}>
        <strong>{label(row)}</strong>
        <dl>
          <div><dt>{t("statistics.inCellar")}</dt><dd>{number(row.current)}</dd></div>
          <div><dt>{t("statistics.added")}</dt><dd className="statistics-breakdown-added">+{number(row.added)}</dd></div>
          <div><dt>{t("statistics.removed")}</dt><dd className="statistics-breakdown-removed">−{number(row.removed)}</dd></div>
        </dl>
      </li>)}
    </ul>
  </>
}

export function StatisticsView({ householdId, onOpenWine }: { householdId: string; onOpenWine: (wineId: string) => void }) {
  const { language, t } = useLanguage()
  const [period, setPeriod] = useState<InsightsPeriod>("12m")
  const [showAllRegions, setShowAllRegions] = useState(false)
  const { data: stockRows, error: stockError, isLoading: stockLoading } =
    useQuery<InsightsStockRow>(STOCK_QUERY, [householdId])
  const { data: operations, error: operationError, isLoading: operationsLoading } =
    useQuery<InsightsOperationRow>(OPERATIONS_QUERY, [householdId])
  const { data: legacy, error: legacyError, isLoading: legacyLoading } =
    useQuery<InsightsLegacyRow>(LEGACY_QUERY, [householdId])
  const loading = stockLoading || operationsLoading || legacyLoading
  const error = stockError || operationError || legacyError
  const insights = useMemo(
    () => buildInventoryInsights(
      operations, legacy, householdId,
      stockRows.reduce((sum, row) => sum + Number(row.quantity), 0), period, new Date(), stockRows,
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
  const stockValues = insights.buckets.flatMap((bucket, index) =>
    bucket.closingStock === null ? [] : [{ index, value: bucket.closingStock, start: bucket.start }],
  )
  const minStock = Math.min(...stockValues.map((point) => point.value))
  const maxStock = Math.max(...stockValues.map((point) => point.value))
  const stockSpan = Math.max(1, maxStock - minStock)
  const stockPoints = stockValues.map(({ value, index }) =>
    `${24 + index * 552 / Math.max(1, insights.buckets.length - 1)},${155 - (value - minStock) * 120 / stockSpan}`,
  ).join(" ")

  return <div className="statistics-view">
    <header className="statistics-heading">
      <h2>{t("statistics.overview")}</h2>
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
                <span className="statistics-flow-values">
                  <span className="statistics-flow-values--add">+{number(bucket.added)}</span>
                  <span aria-hidden="true"> / </span>
                  <span className="statistics-flow-values--remove">−{number(bucket.removed)}</span>
                </span>
              </div>)}
            </div>}
      </section>
      <section className="statistics-chart" aria-labelledby="statistics-color-title">
        <h2 id="statistics-color-title">{t("statistics.byColor")}</h2>
        <p>{t("statistics.breakdownHelp")}</p>
        <BreakdownTable rows={insights.byColor} title={t("statistics.byColor")}
          dimension={t("statistics.color")} unknown={t("statistics.unknownColor")} translateLabels />
      </section>
      <section className="statistics-chart" aria-labelledby="statistics-region-title">
        <h2 id="statistics-region-title">{t("statistics.byRegion")}</h2>
        <p>{t("statistics.regionHelp")}</p>
        <BreakdownTable rows={showAllRegions ? insights.byRegion : insights.byRegion.slice(0, 8)}
          title={t("statistics.byRegion")} dimension={t("statistics.region")}
          unknown={t("statistics.unknownRegion")} />
        {insights.byRegion.length > 8 ? <button onClick={() => setShowAllRegions((current) => !current)} type="button">
          {t(showAllRegions ? "statistics.fewerRegions" : "statistics.allRegions")}
        </button> : null}
      </section>
      <section className="statistics-chart" aria-labelledby="statistics-stock-title">
        <h2 id="statistics-stock-title">{t("statistics.stockTitle")}</h2>
        {insights.stockHistoryAvailable ? <>
          <p>{t("statistics.stockHelp")}</p>
          <svg aria-label={t("statistics.stockTitle")} className="statistics-stock-plot" role="img" viewBox="0 0 600 180">
            <line x1="24" x2="576" y1="155" y2="155" />
            <polyline fill="none" points={stockPoints} />
            {stockValues.map(({ value, index, start }) =>
              <circle cx={24 + index * 552 / Math.max(1, insights.buckets.length - 1)}
                cy={155 - (value - minStock) * 120 / stockSpan} key={start} r="4">
                <title>{formatPeriod(start)}: {number(value)}</title>
              </circle>)}
          </svg>
          <div className="statistics-stock-labels"><span>{formatPeriod(stockValues[0].start)} · {number(stockValues[0].value)}</span><span>{formatPeriod(stockValues.at(-1)?.start ?? "")} · {number(stockValues.at(-1)?.value ?? 0)}</span></div>
          <details><summary>{t("statistics.tableTitle")}</summary>
            <table><thead><tr><th>{t("statistics.period")}</th><th>{t("statistics.closingStock")}</th></tr></thead>
              <tbody>{insights.buckets.map((bucket) => <tr key={bucket.start}><th>{formatPeriod(bucket.start)}</th><td>{bucket.closingStock === null ? "—" : number(bucket.closingStock)}</td></tr>)}</tbody></table>
          </details>
        </> : <p>{t("statistics.stockUnavailable")}</p>}
      </section>
    </> : null}
    <ConsumptionHistoryView householdId={householdId} onOpenWine={onOpenWine} period={period} />
  </div>
}
