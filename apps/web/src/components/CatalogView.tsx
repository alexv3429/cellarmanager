import { useQuery } from "@powersync/react"
import {
  useEffect,
  useMemo,
  useState,
} from "react"

import { matchesSearch } from "../data/searchFilters"
import {
  formatWineVolume,
} from "../data/wineCatalog"
import {
  prepareWineCatalogEdit,
} from "../data/wineCatalogEdit"
import {
  updateWineCatalog,
} from "../data/wineCatalogMutations"
import {
  getHouseholdMaturityOverview,
  maturityAssessmentReasonLabel,
  type MaturityOverviewItem,
  type MaturityState,
} from "../data/wineMaturity"
import { Notice } from "./Notice"

interface CatalogWineRow {
  id: string
  producer: string
  cuvee: string
  vintage: number | null
  color: string
  appellation: string | null
  area: string | null
  format_ml: number
  quantity: number
}

type StockFilter =
  | "ALL"
  | "IN_STOCK"
  | "ZERO_STOCK"

type MaturityFilter =
  | "ALL"
  | "DRINK_SOON"
  | "READY"
  | "HOLD"
  | "UNASSESSED"

function matchesMaturityFilter(
  state: MaturityState | null,
  filter: MaturityFilter,
): boolean {
  switch (filter) {
    case "DRINK_SOON":
      return state === "priority" || state === "assess-now"
    case "READY":
      return state === "assess" || state === "ready"
    case "HOLD":
      return state === "hold"
    case "UNASSESSED":
      return state === null
    default:
      return true
  }
}

const CATALOG_QUERY = `
  select
    w.id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color,
    w.appellation,
    w.area,
    w.format_ml,
    coalesce(sum(h.quantity), 0) as quantity
  from wines w
  left join holdings h
    on h.wine_id = w.id
  where w.household_id = ?
  group by
    w.id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color,
    w.appellation,
    w.area,
    w.format_ml
  order by
    w.producer,
    w.cuvee,
    w.vintage,
    w.color,
    w.format_ml
`

interface CatalogViewProps {
  householdId: string
  isOnline: boolean
  onOpenWine: (wineId: string) => void
}

export function CatalogView({
  householdId,
  isOnline,
  onOpenWine,
}: CatalogViewProps) {
  const {
    data: wines,
    error,
    isLoading,
  } = useQuery<CatalogWineRow>(
    CATALOG_QUERY,
    [householdId],
  )

  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] =
    useState<StockFilter>("ALL")
  const [vintageFilter, setVintageFilter] =
    useState("ALL")
  const [maturityFilter, setMaturityFilter] =
    useState<MaturityFilter>("ALL")
  const [maturityOverview, setMaturityOverview] =
    useState<MaturityOverviewItem[]>([])
  const [maturityLoading, setMaturityLoading] = useState(false)
  const [maturityError, setMaturityError] =
    useState<string | null>(null)

  const [editingWineId, setEditingWineId] =
    useState<string | null>(null)

  const [editProducer, setEditProducer] = useState("")
  const [editCuvee, setEditCuvee] = useState("")
  const [editVintage, setEditVintage] = useState("")
  const [editColor, setEditColor] = useState("")
  const [editAppellation, setEditAppellation] =
    useState("")
  const [editArea, setEditArea] = useState("")
  const [editFormatMl, setEditFormatMl] = useState("")

  const [savingWineId, setSavingWineId] =
    useState<string | null>(null)

  const [mutationMessage, setMutationMessage] =
    useState<string | null>(null)

  const [mutationError, setMutationError] =
    useState<string | null>(null)

  useEffect(() => {
    setEditingWineId(null)
    setSavingWineId(null)
    setMutationMessage(null)
    setMutationError(null)
  }, [householdId])

  useEffect(() => {
    setMaturityOverview([])
    setMaturityError(null)

    if (!isOnline) {
      setMaturityFilter("ALL")
      setMaturityLoading(false)
      return
    }

    let cancelled = false
    setMaturityLoading(true)

    void getHouseholdMaturityOverview(householdId)
      .then((overview) => {
        if (!cancelled) {
          setMaturityOverview(overview)
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setMaturityError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load maturity guidance",
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMaturityLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [householdId, isOnline])

  const maturityByWineId = useMemo(
    () =>
      new Map(
        maturityOverview.map((item) => [item.wineId, item]),
      ),
    [maturityOverview],
  )

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

  const colorSuggestions = useMemo(
    () =>
      [...new Set(wines.map((wine) => wine.color))]
        .sort((left, right) =>
          left.localeCompare(right),
        ),
    [wines],
  )

  const appellationSuggestions = useMemo(
    () =>
      [
        ...new Set(
          wines
            .map((wine) => wine.appellation)
            .filter(
              (value): value is string =>
                value !== null,
            ),
        ),
      ].sort((left, right) =>
        left.localeCompare(right),
      ),
    [wines],
  )

  const areaSuggestions = useMemo(
    () =>
      [
        ...new Set(
          wines
            .map((wine) => wine.area)
            .filter(
              (value): value is string =>
                value !== null,
            ),
        ),
      ].sort((left, right) =>
        left.localeCompare(right),
      ),
    [wines],
  )

  const visibleWines = useMemo(
    () =>
      wines.filter((wine) => {
        if (
          stockFilter === "IN_STOCK" &&
          wine.quantity <= 0
        ) {
          return false
        }

        const maturity = maturityByWineId.get(wine.id)
        if (
          !matchesMaturityFilter(
            maturity?.state ?? null,
            maturityFilter,
          )
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
            wine.appellation,
            wine.area,
            formatWineVolume(wine.format_ml),
            wine.format_ml,
          ],
          search,
        )
      }).sort((left, right) => {
        if (maturityFilter === "ALL") {
          return 0
        }

        const leftMaturity = maturityByWineId.get(left.id)
        const rightMaturity = maturityByWineId.get(right.id)
        return (
          (rightMaturity?.urgencyScore ?? 0) -
            (leftMaturity?.urgencyScore ?? 0) ||
          (leftMaturity?.drinkByYear ?? Number.MAX_SAFE_INTEGER) -
            (rightMaturity?.drinkByYear ?? Number.MAX_SAFE_INTEGER)
        )
      }),
    [
      maturityByWineId,
      maturityFilter,
      search,
      stockFilter,
      vintageFilter,
      wines,
    ],
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
    vintageFilter !== "ALL" ||
    maturityFilter !== "ALL"

  function clearFilters() {
    setSearch("")
    setStockFilter("ALL")
    setVintageFilter("ALL")
    setMaturityFilter("ALL")
  }

  function startEditing(wine: CatalogWineRow) {
    setMutationMessage(null)
    setMutationError(null)

    setEditingWineId(wine.id)
    setEditProducer(wine.producer)
    setEditCuvee(wine.cuvee)
    setEditVintage(
      wine.vintage === null
        ? ""
        : String(wine.vintage),
    )
    setEditColor(wine.color)
    setEditAppellation(wine.appellation ?? "")
    setEditArea(wine.area ?? "")
    setEditFormatMl(String(wine.format_ml))
  }

  function cancelEditing() {
    setEditingWineId(null)
    setMutationError(null)
  }

  async function saveWine(wineId: string) {
    setMutationMessage(null)
    setMutationError(null)

    if (!isOnline) {
      setMutationError(
        "Reconnect before editing a catalog wine.",
      )
      return
    }

    setSavingWineId(wineId)

    try {
      const edit = prepareWineCatalogEdit(
        editProducer,
        editCuvee,
        editVintage,
        editColor,
        editAppellation,
        editArea,
        editFormatMl,
      )

      await updateWineCatalog(wineId, edit)

      setEditingWineId(null)
      setMutationMessage(
        "Wine saved. Waiting for synchronization.",
      )
    } catch (caughtError: unknown) {
      setMutationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save wine",
      )
    } finally {
      setSavingWineId(null)
    }
  }

  return (
    <main>
      <h1>Wine catalog</h1>
      <p>
        All synchronized wines are shown here, including wines
        with no bottles currently in stock.
      </p>

      {!isOnline ? (
        <Notice tone="warning">
          Offline · catalog edits are disabled.
        </Notice>
      ) : null}

      {isLoading ? (
        <Notice>Opening local catalog…</Notice>
      ) : null}

      {error ? (
        <Notice role="alert" tone="error">
          {String(error)}
        </Notice>
      ) : null}

      {mutationMessage ? (
        <Notice role="status" tone="success">
          {mutationMessage}
        </Notice>
      ) : null}

      {mutationError ? (
        <Notice role="alert" tone="error">
          {mutationError}
        </Notice>
      ) : null}

      <section aria-labelledby="catalog-filters-heading">
        <h2 id="catalog-filters-heading">Find wines</h2>

        <label>
          Search
          <input
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Producer, cuvée, appellation, area, vintage…"
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

        <label>
          When to drink
          <select
            disabled={!isOnline || maturityLoading}
            onChange={(event) =>
              setMaturityFilter(
                event.target.value as MaturityFilter,
              )
            }
            value={maturityFilter}
          >
            <option value="ALL">All maturity states</option>
            <option value="DRINK_SOON">Drink sooner</option>
            <option value="READY">Assess or ready</option>
            <option value="HOLD">Keep aging</option>
            <option value="UNASSESSED">Not assessed</option>
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

      {maturityError ? (
        <Notice role="alert" tone="warning">
          Maturity guidance is temporarily unavailable: {maturityError}
        </Notice>
      ) : null}

      <datalist id="catalog-color-suggestions">
        {colorSuggestions.map((color) => (
          <option key={color} value={color} />
        ))}
      </datalist>

      <datalist id="catalog-appellation-suggestions">
        {appellationSuggestions.map((appellation) => (
          <option
            key={appellation}
            value={appellation}
          />
        ))}
      </datalist>

      <datalist id="catalog-area-suggestions">
        {areaSuggestions.map((area) => (
          <option key={area} value={area} />
        ))}
      </datalist>

      <p>
        Showing {visibleWines.length} of {wines.length} wines
        {" · "}
        {visibleBottles} of {totalBottles} bottles
        {isOnline && !maturityLoading && !maturityError
          ? ` · ${maturityOverview.filter((item) => item.state !== null).length} assessed · ${maturityOverview.filter((item) => item.demandStatus === "needs-review").length} need input or review`
          : ""}
      </p>

      {!isLoading && wines.length === 0 ? (
        <p>No synchronized wines found.</p>
      ) : null}

      {!isLoading &&
      wines.length > 0 &&
      visibleWines.length === 0 ? (
        <p>No wines match the current filters.</p>
      ) : null}

      <table className="catalog-table">
        <caption className="visually-hidden">
          Filtered wine catalog
        </caption>
        <thead>
          <tr>
            <th scope="col">Producer</th>
            <th scope="col">Cuvée</th>
            <th scope="col">Vintage</th>
            <th scope="col">Color</th>
            <th scope="col">Appellation</th>
            <th scope="col">Area</th>
            <th scope="col">Format</th>
            <th scope="col">Current bottles</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>

        <tbody>
          {visibleWines.map((wine) => {
            const isEditing =
              editingWineId === wine.id

            const isSaving =
              savingWineId === wine.id
            const maturity = maturityByWineId.get(wine.id)

            return (
              <tr key={wine.id}>
                <td data-label="Producer">
                  {isEditing ? (
                    <input
                      aria-label={`Producer for ${wine.producer} ${wine.cuvee}`}
                      disabled={isSaving}
                      onChange={(event) =>
                        setEditProducer(
                          event.target.value,
                        )
                      }
                      required
                      value={editProducer}
                    />
                  ) : (
                    wine.producer
                  )}
                </td>

                <td data-label="Cuvée">
                  {isEditing ? (
                    <input
                      aria-label={`Cuvée for ${wine.producer} ${wine.cuvee}`}
                      disabled={isSaving}
                      onChange={(event) =>
                        setEditCuvee(
                          event.target.value,
                        )
                      }
                      required
                      value={editCuvee}
                    />
                  ) : (
                    <div className="catalog-wine-cuvee">
                      <span>{wine.cuvee}</span>
                      {maturity?.state ? (
                        <span
                          className={`maturity-badge maturity-badge--${maturity.state}`}
                        >
                          {maturity.stateLabel}
                          {maturity.drinkByYear
                            ? ` · by ${maturity.drinkByYear}`
                            : ""}
                          {maturity.moveNeeded
                            ? " · move suggested"
                            : ""}
                        </span>
                      ) : maturity?.assessmentReason ? (
                        <span className="maturity-badge maturity-badge--unassessed">
                          {maturityAssessmentReasonLabel(
                            maturity.assessmentReason,
                          )}
                        </span>
                      ) : null}
                    </div>
                  )}
                </td>

                <td data-label="Vintage">
                  {isEditing ? (
                    <input
                      aria-label={`Vintage for ${wine.producer} ${wine.cuvee}`}
                      disabled={isSaving}
                      inputMode="numeric"
                      onChange={(event) =>
                        setEditVintage(
                          event.target.value,
                        )
                      }
                      placeholder="NV"
                      value={editVintage}
                    />
                  ) : (
                    wine.vintage ?? "NV"
                  )}
                </td>

                <td data-label="Color">
                  {isEditing ? (
                    <input
                      aria-label={`Color for ${wine.producer} ${wine.cuvee}`}
                      disabled={isSaving}
                      list="catalog-color-suggestions"
                      onChange={(event) =>
                        setEditColor(
                          event.target.value,
                        )
                      }
                      required
                      value={editColor}
                    />
                  ) : (
                    wine.color
                  )}
                </td>

                <td data-label="Appellation">
                  {isEditing ? (
                    <input
                      aria-label={`Appellation for ${wine.producer} ${wine.cuvee}`}
                      disabled={isSaving}
                      list="catalog-appellation-suggestions"
                      onChange={(event) =>
                        setEditAppellation(
                          event.target.value,
                        )
                      }
                      placeholder="Optional"
                      value={editAppellation}
                    />
                  ) : (
                    wine.appellation ?? "—"
                  )}
                </td>

                <td data-label="Area">
                  {isEditing ? (
                    <input
                      aria-label={`Area for ${wine.producer} ${wine.cuvee}`}
                      disabled={isSaving}
                      list="catalog-area-suggestions"
                      onChange={(event) =>
                        setEditArea(
                          event.target.value,
                        )
                      }
                      placeholder="Optional"
                      value={editArea}
                    />
                  ) : (
                    wine.area ?? "—"
                  )}
                </td>

                <td data-label="Format">
                  {isEditing ? (
                    <input
                      aria-label={`Format in millilitres for ${wine.producer} ${wine.cuvee}`}
                      disabled={isSaving}
                      inputMode="numeric"
                      min="1"
                      onChange={(event) =>
                        setEditFormatMl(
                          event.target.value,
                        )
                      }
                      required
                      step="1"
                      type="number"
                      value={editFormatMl}
                    />
                  ) : (
                    formatWineVolume(wine.format_ml)
                  )}
                </td>

                <td data-label="Current bottles">{wine.quantity}</td>

                <td data-label="Actions">
                  {isEditing ? (
                    <>
                      <button
                        disabled={!isOnline || isSaving}
                        onClick={() =>
                          void saveWine(wine.id)
                        }
                        type="button"
                      >
                        {isSaving ? "Saving…" : "Save"}
                      </button>

                      <button
                        disabled={isSaving}
                        onClick={cancelEditing}
                        type="button"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() =>
                          onOpenWine(wine.id)
                        }
                        type="button"
                      >
                        View
                      </button>

                      <button
                        disabled={
                          !isOnline ||
                          savingWineId !== null
                        }
                        onClick={() =>
                          startEditing(wine)
                        }
                        title={
                          isOnline
                            ? undefined
                            : "Reconnect before editing"
                        }
                        type="button"
                      >
                        Edit
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}
