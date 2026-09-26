import { useQuery } from "@powersync/react"
import { useEffect, useMemo, useState } from "react"

import { matchesSearch } from "../data/searchFilters"
import { formatWineVolume } from "../data/wineCatalog"
import { getHouseholdMaturityOverview, type MaturityOverviewItem } from "../data/wineMaturity"
import { Notice } from "./Notice"
import { useLanguage } from "../i18n/useLanguage"

export interface MemberCellarRow {
  id: string
  producer: string
  cuvee: string
  vintage: number | null
  color: string
  appellation: string | null
  area: string | null
  format_ml: number
  quantity: number
  cellar_id: string | null
  cellar_name: string | null
  location_code: string | null
}

// Authoritative synchronized stock only. A former Owner's pending writes do
// not become apparent stock in the Member's read-only view.
const CELLAR_QUERY = `
  select w.id, w.producer, w.cuvee, w.vintage, w.color,
    w.appellation, w.area, w.format_ml, coalesce(h.quantity, 0) as quantity,
    c.id as cellar_id, c.name as cellar_name, l.code as location_code
  from wines w
  left join holdings h on h.wine_id = w.id and h.quantity > 0
  left join locations l on l.id = h.location_id
  left join cellars c on c.id = l.cellar_id
  where w.household_id = ? and w.merged_into_wine_id is null
  order by w.producer, w.cuvee, w.vintage, c.name, l.code
`

export function MemberCellarView({ householdId, isOnline, onOpenWine }: {
  householdId: string
  isOnline: boolean
  onOpenWine: (wineId: string) => void
}) {
  const { t } = useLanguage()
  const { data: rows, isLoading, error } = useQuery<MemberCellarRow>(CELLAR_QUERY, [householdId])
  const [search, setSearch] = useState("")
  const [color, setColor] = useState("")
  const [cellar, setCellar] = useState("")
  const [includeEmpty, setIncludeEmpty] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(30)
  const [maturity, setMaturity] = useState<MaturityOverviewItem[]>([])
  const [adviceError, setAdviceError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setMaturity([])
    setAdviceError(false)
    if (isOnline) {
      void getHouseholdMaturityOverview(householdId).then((result) => {
        if (!cancelled) setMaturity(result)
      }).catch(() => { if (!cancelled) setAdviceError(true) })
    }
    return () => { cancelled = true }
  }, [householdId, isOnline])

  const wines = useMemo(() => {
    const grouped = new Map<string, { wine: MemberCellarRow; quantity: number; positions: MemberCellarRow[] }>()
    for (const row of rows) {
      const entry = grouped.get(row.id) ?? { wine: row, quantity: 0, positions: [] }
      entry.quantity += Number(row.quantity)
      if (row.quantity > 0) entry.positions.push(row)
      grouped.set(row.id, entry)
    }
    return [...grouped.values()]
  }, [rows])
  const cellars = [...new Map(rows.filter((row) => row.cellar_id).map((row) => [row.cellar_id!, row.cellar_name!])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1]))
  const maturityByWine = useMemo(() => new Map(maturity.map((item) => [item.wineId, item])), [maturity])
  const visible = wines.filter(({ wine, quantity, positions }) =>
    (includeEmpty || quantity > 0) && (!color || wine.color === color) &&
    (!cellar || positions.some((position) => position.cellar_id === cellar)) &&
    matchesSearch([wine.producer, wine.cuvee, wine.appellation, wine.area, wine.vintage, ...positions.map((position) => `${position.cellar_name} ${position.location_code}`)], search),
  )

  return (
    <main className="member-cellar">
      <header><h1>{t("Cellar")}</h1><p>{t("Browse the household’s wines, bottle quantities, and storage locations. Only an Owner can change the shared cellar.")}</p></header>
      <section aria-label={t("Filter cellar")} className="member-cellar__filters">
        <label>{t("Search wines")}<input type="search" value={search} placeholder={t("Producer, cuvée, appellation…")}
            onChange={(event) => { setSearch(event.target.value); setVisibleLimit(30) }} />
        </label>
        <label>{t("Wine color")}<select value={color} onChange={(event) => { setColor(event.target.value); setVisibleLimit(30) }}>
            <option value="">{t("All colors")}</option>
            {[...new Set(rows.map((row) => row.color))].sort().map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>{t("Storage cellar")}<select value={cellar} onChange={(event) => { setCellar(event.target.value); setVisibleLimit(30) }}>
            <option value="">{t("All cellars")}</option>
            {cellars.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="member-cellar__checkbox">
          <input type="checkbox" checked={includeEmpty}
            onChange={(event) => { setIncludeEmpty(event.target.checked); setVisibleLimit(30) }} />
          <span>{t("Include wines with no bottles")}</span>
        </label>
      </section>
      {error ? <Notice role="alert" tone="error">{t("Unable to load cellar data:")}{t(" ")}{String(error)}</Notice> : null}
      {!isOnline || adviceError ? <Notice tone="warning">{!isOnline ? "Offline: showing synchronized cellar data. Reconnect for drinking advice." : "Drinking advice is temporarily unavailable. Wine details and stock remain available."}</Notice> : null}
      <p role="status">{isLoading ? t("Loading cellar…") : t("{value1} wine{value2} · {value3} bottles", { value1: String(visible.length), value2: String(visible.length === 1 ? "" : "s"), value3: String(visible.reduce((total, item) => total + item.quantity, 0)) })}</p>
      {!isLoading && !visible.length ? <p>{t("No wines match these filters.")}</p> : null}
      <div className="member-cellar__wines">
        {visible.slice(0, visibleLimit).map(({ wine, quantity, positions }) => {
          const advice = maturityByWine.get(wine.id)
          return <article className="member-cellar__wine" key={wine.id}>
            <div><h2>{wine.producer} — {wine.cuvee}</h2><p>{wine.vintage ?? "NV"} · {wine.color} · {formatWineVolume(wine.format_ml)}</p><p>{[wine.appellation, wine.area].filter(Boolean).join(" · ")}</p></div>
            <strong>{quantity}{t(" ")}{t("bottle")}{quantity === 1 ? "" : "s"}</strong>
            {positions.length ? <ul aria-label={t("Bottle locations")}>{positions.map((position, index) => <li key={index}>{position.cellar_name} / {position.location_code} · {position.quantity}{t(" ")}{t("bottle")}{position.quantity === 1 ? "" : "s"}</li>)}</ul> : <p>{t("No bottles currently in stock.")}</p>}
            {advice?.stateLabel ? <p>{advice.stateLabel}{advice.drinkByYear ? ` · suggested drink-by ${advice.drinkByYear}` : ""}</p> : null}
            <button type="button" onClick={() => onOpenWine(wine.id)}>{t("View wine")}</button>
          </article>
        })}
      </div>
      {visible.length > visibleLimit ? (
        <button type="button" onClick={() => setVisibleLimit((limit) => limit + 30)}>{t("Show more wines (")}{visibleLimit}{t(" ")}{t("of")}{t(" ")}{visible.length}{t("shown)")}</button>
      ) : null}
    </main>
  )
}
