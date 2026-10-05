import { useQuery } from "@powersync/react"
import { useEffect, useMemo, useState } from "react"

import {
  buildDrinkingWindowDashboard,
  drinkingWindowGroupOrder,
  type DrinkingWindowGroup,
  type DrinkingWindowStockRow,
} from "../data/drinkingWindowDashboard"
import { getHouseholdMaturityOverview, type MaturityOverviewItem } from "../data/wineMaturity"
import { formatLocalizedNumber } from "../i18n/formatting"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

const STOCK_QUERY = `
  select wine.id, wine.household_id, wine.producer, wine.cuvee, wine.vintage,
    sum(holding.quantity) as quantity
  from wines wine
  join holdings holding on holding.wine_id = wine.id and holding.household_id = wine.household_id
  where wine.household_id = ? and wine.merged_into_wine_id is null and holding.quantity > 0
  group by wine.id, wine.household_id, wine.producer, wine.cuvee, wine.vintage
`

const groupLabelKeys: Record<DrinkingWindowGroup, string> = {
  soon: "drinking.soon",
  ready: "drinking.ready",
  assess: "drinking.assess",
  hold: "drinking.hold",
  unassessed: "drinking.unassessed",
}

interface DrinkingWindowDashboardProps {
  householdId: string
  isOnline: boolean
  onOpenWine: (wineId: string) => void
}

export function DrinkingWindowDashboard({ householdId, isOnline, onOpenWine }: DrinkingWindowDashboardProps) {
  const { language, t } = useLanguage()
  const { data: stockRows, error: stockError, isLoading: stockLoading } =
    useQuery<DrinkingWindowStockRow>(STOCK_QUERY, [householdId])
  const [overviewResult, setOverviewResult] = useState<{ householdId: string; items: MaturityOverviewItem[] } | null>(null)
  const [overviewErrorFor, setOverviewErrorFor] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<DrinkingWindowGroup>("soon")
  const [visibleCount, setVisibleCount] = useState(8)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    setOverviewResult(null)
    setOverviewErrorFor(null)
    if (!isOnline) return
    let cancelled = false
    void getHouseholdMaturityOverview(householdId)
      .then((items) => { if (!cancelled) setOverviewResult({ householdId, items }) })
      .catch(() => { if (!cancelled) setOverviewErrorFor(householdId) })
    return () => { cancelled = true }
  }, [householdId, isOnline, retry])

  const overview = overviewResult?.householdId === householdId ? overviewResult.items : null
  const overviewError = overviewErrorFor === householdId
  const dashboard = useMemo(
    () => buildDrinkingWindowDashboard(stockRows, overview ?? [], householdId),
    [stockRows, overview, householdId],
  )
  const number = (value: number) => formatLocalizedNumber(value, language)
  const wines = dashboard.groups[selectedGroup].wines
  const visibleWines = wines.slice(0, visibleCount)

  return <div className="drinking-dashboard">
    <header>
      <h2>{t("drinking.title")}</h2>
      <p>{t("drinking.help")}</p>
    </header>
    {!isOnline ? <Notice tone="info">{t("drinking.offline")}</Notice> : null}
    {stockError || overviewError ? <Notice role="alert" tone="error">{t("drinking.loadError")}</Notice> : null}
    {isOnline && overviewError ? <button onClick={() => setRetry((value) => value + 1)} type="button">
      {t("drinking.retry")}
    </button> : null}
    {isOnline && !stockError && !overviewError && (stockLoading || overview === null)
      ? <p role="status">{t("drinking.loading")}</p> : null}
    {isOnline && !stockLoading && !stockError && !overviewError && overview !== null ? <>
      {dashboard.totalBottles === 0 ? <p>{t("drinking.noStock")}</p> : <>
        <p>{t("drinking.currentStock", { count: number(dashboard.totalBottles) })}</p>
        <div aria-label={t("drinking.groups")} className="drinking-dashboard__groups" role="group">
          {drinkingWindowGroupOrder.map((group) => <button
            aria-pressed={selectedGroup === group}
            className={`drinking-dashboard__group drinking-dashboard__group--${group}`}
            key={group}
            onClick={() => { setSelectedGroup(group); setVisibleCount(8) }}
            type="button">
            <strong>{number(dashboard.groups[group].bottles)}</strong>
            <span>{t(groupLabelKeys[group])}</span>
          </button>)}
        </div>
        <section aria-labelledby="drinking-dashboard-results-title" className="drinking-dashboard__results">
          <h3 id="drinking-dashboard-results-title">{t(groupLabelKeys[selectedGroup])}</h3>
          {wines.length === 0 ? <p>{t("drinking.noWinesInGroup")}</p> : <>
            <ul className="drinking-dashboard__wine-list">
              {visibleWines.map(({ wine, guidance }) => {
                const relevantYear = selectedGroup === "hold" || selectedGroup === "assess"
                  ? guidance?.firstTrialYear : guidance?.drinkByYear
                const timing = relevantYear ? t(selectedGroup === "hold" || selectedGroup === "assess"
                  ? "drinking.firstTry" : "drinking.suggestedBy", { year: String(relevantYear) }) : null
                const source = guidance?.isOverride ? t("drinking.manual") : guidance?.isPersonalized
                  ? t("drinking.personal") : null
                return <li key={wine.id}>
                  <div>
                    <button className="wine-detail-link" onClick={() => onOpenWine(wine.id)} type="button">
                      {wine.producer} · {wine.cuvee}{wine.vintage === null ? "" : ` · ${wine.vintage}`}
                    </button>
                    <span>{t(wine.quantity === 1 ? "drinking.oneBottle" : "drinking.manyBottles",
                      { count: number(wine.quantity) })}</span>
                  </div>
                  {timing || source ? <small>{[timing, source].filter(Boolean).join(" · ")}</small> : null}
                </li>
              })}
            </ul>
            {wines.length > visibleCount ? <button onClick={() => setVisibleCount((count) => count + 20)} type="button">
              {t("drinking.showMore")}
            </button> : null}
            {visibleCount > 8 ? <button onClick={() => setVisibleCount(8)} type="button">
              {t("drinking.showFewer")}
            </button> : null}
          </>}
        </section>
      </>}
    </> : null}
  </div>
}
