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
}

export function CatalogView({
  householdId,
  isOnline,
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

  const [editingWineId, setEditingWineId] =
    useState<string | null>(null)

  const [editProducer, setEditProducer] = useState("")
  const [editCuvee, setEditCuvee] = useState("")
  const [editVintage, setEditVintage] = useState("")
  const [editColor, setEditColor] = useState("")
  const [editAppellation, setEditAppellation] =
    useState("")
  const [editArea, setEditArea] = useState("")

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
        <p>Offline · catalog edits are disabled.</p>
      ) : null}

      {isLoading ? <p>Opening local catalog…</p> : null}
      {error ? <p role="alert">{String(error)}</p> : null}

      {mutationMessage ? (
        <p>{mutationMessage}</p>
      ) : null}

      {mutationError ? (
        <p role="alert">{mutationError}</p>
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

        <button
          disabled={!hasFilters}
          onClick={clearFilters}
          type="button"
        >
          Clear filters
        </button>
      </section>

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
            <th>Appellation</th>
            <th>Area</th>
            <th>Format</th>
            <th>Current bottles</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {visibleWines.map((wine) => {
            const isEditing =
              editingWineId === wine.id

            const isSaving =
              savingWineId === wine.id

            return (
              <tr key={wine.id}>
                <td>
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

                <td>
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
                    wine.cuvee
                  )}
                </td>

                <td>
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

                <td>
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

                <td>
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

                <td>
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

                <td>
                  {formatWineVolume(wine.format_ml)}
                </td>

                <td>{wine.quantity}</td>

                <td>
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
