import { useQuery } from "@powersync/react"
import { useMemo, useState } from "react"

import { matchesSearch } from "../data/searchFilters"

interface CatalogWineRow {
  id: string
  producer: string
  cuvee: string
  vintage: number | null
  color: string | null
  quantity: number
}

type StockFilter =
  | "ALL"
  | "IN_STOCK"
  | "ZERO_STOCK"

const CATALOG_QUERY = `
  select
    w.id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color,
    coalesce(sum(h.quantity), 0) as quantity
  from wines w
  left join holdings h
    on h.wine_id = w.id
  group by
    w.id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color
  order by
    w.producer,
    w.cuvee,
    w.vintage
`

export function CatalogView() {
  const {
    data: wines,
    error,
    isLoading,
  } = useQuery<CatalogWineRow>(CATALOG_QUERY)

  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] =
    useState<StockFilter>("ALL")
  const [vintageFilter, setVintageFilter] =
    useState("ALL")

  const vintageOptions = useMemo(() => {
    const vintages = [
      ...new Set(
        wines
          .filter((wine) => wine.vintage !== null)
          .map((wine) => wine.vintage as number),
      ),
    ].sort((left, right) => right - left)

    return {
      vintages,
      hasNv: wines.some((wine) => wine.vintage === null),
    }
  }, [wines])

  const visibleWines = useMemo(
    () =>
      wines.filter((wine) => {
        if (
          stockFilter === "IN_STOCK" &&
          wine.quantity <= 0
        ) {
          return false
        }

        if (
          stockFilter === "ZERO_STOCK" &&
          wine.quantity !== 0
        ) {
          return false
        }

        if (
          vintageFilter !== "ALL" &&
          (wine.vintage === null
            ? "NV"
            : String(wine.vintage)) !== vintageFilter
        ) {
          return false
        }

        return matchesSearch(
          [
            wine.producer,
            wine.cuvee,
            wine.vintage ?? "NV",
            wine.color,
          ],
          search,
        )
      }),
    [search, stockFilter, vintageFilter, wines],
  )

  const totalBottles = wines.reduce(
    (sum, wine) => sum + wine.quantity,
    0,
  )

  const visibleBottles = visibleWines.reduce(
    (sum, wine) => sum + wine.quantity,
    0,
  )

  const hasFilters =
    search.trim().length > 0 ||
    stockFilter !== "ALL" ||
    vintageFilter !== "ALL"

  function clearFilters() {
    setSearch("")
    setStockFilter("ALL")
    setVintageFilter("ALL")
  }

  return (
    <main>
      <h1>Wine catalog</h1>
      <p>
        All synchronized wines are shown here, including wines
        with no bottles currently in stock.
      </p>

      {isLoading ? <p>Opening local catalog…</p> : null}
      {error ? <p role="alert">{String(error)}</p> : null}

      <section aria-labelledby="catalog-filters-heading">
        <h2 id="catalog-filters-heading">Find wines</h2>

        <label>
          Search
          <input
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Producer, cuvée, vintage, color…"
            type="search"
            value={search}
          />
        </label>

        <label>
          Stock
          <select
            onChange={(event) =>
              setStockFilter(
                event.target.value as StockFilter,
              )
            }
            value={stockFilter}
          >
            <option value="ALL">All wines</option>
            <option value="IN_STOCK">In stock</option>
            <option value="ZERO_STOCK">Zero stock</option>
          </select>
        </label>

        <label>
          Vintage
          <select
            onChange={(event) =>
              setVintageFilter(event.target.value)
            }
            value={vintageFilter}
          >
            <option value="ALL">All vintages</option>
            {vintageOptions.hasNv ? (
              <option value="NV">NV</option>
            ) : null}
            {vintageOptions.vintages.map((vintage) => (
              <option
                key={vintage}
                value={String(vintage)}
              >
                {vintage}
              </option>
            ))}
          </select>
        </label>

        <button
          disabled={!hasFilters}
          onClick={clearFilters}
          type="button"
        >
          Clear filters
        </button>
      </section>

      <p>
        Showing {visibleWines.length} of {wines.length} wines
        {" · "}
        {visibleBottles} of {totalBottles} bottles
      </p>

      {!isLoading && wines.length === 0 ? (
        <p>No synchronized wines found.</p>
      ) : null}

      {!isLoading &&
      wines.length > 0 &&
      visibleWines.length === 0 ? (
        <p>No wines match the current filters.</p>
      ) : null}

      <table>
        <thead>
          <tr>
            <th>Producer</th>
            <th>Cuvée</th>
            <th>Vintage</th>
            <th>Color</th>
            <th>Current bottles</th>
          </tr>
        </thead>

        <tbody>
          {visibleWines.map((wine) => (
            <tr key={wine.id}>
              <td>{wine.producer}</td>
              <td>{wine.cuvee}</td>
              <td>{wine.vintage ?? "NV"}</td>
              <td>{wine.color ?? "—"}</td>
              <td>{wine.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
