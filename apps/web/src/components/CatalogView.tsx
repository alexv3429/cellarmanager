import { useQuery } from "@powersync/react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { matchesSearch } from "../data/searchFilters"
import {
  buildCatalogCurationQueue,
  getCatalogFactCoverage,
  getCatalogProfileCoverage,
  profileCoverageLabel,
  type CatalogCurationItem,
  type CoreFactCoverage,
  type ProfileCoverage,
} from "../data/catalogCoverage"
import {
  formatWineVolume,
} from "../data/wineCatalog"
import {
  parseWineFacts,
  type SweetnessCategory,
  type WineFacts,
} from "../data/wineFacts"
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
import {
  enrichmentResearchCurationAction,
  findEnrichmentResearchForCurationItem,
  getEnrichmentResearchInbox,
  markEnrichmentResearchSeen,
  requestEnrichmentResearch,
  type EnrichmentResearchInbox as ResearchInbox,
} from "../data/enrichmentResearch"
import { EnrichmentResearchInbox } from "./EnrichmentResearchInbox"
import { Notice } from "./Notice"
import { WineDuplicateReview } from "./WineDuplicateReview"

interface CatalogWineRow {
  id: string
  household_id: string
  producer: string
  cuvee: string
  vintage: number | null
  color: string
  appellation: string | null
  area: string | null
  country: string | null
  classification: string | null
  vineyard: string | null
  grape_composition: unknown
  sweetness_category: SweetnessCategory | null
  alcohol_percent: number | string | null
  certifications: unknown
  wine_reference_id: string | null
  wine_reference_type: string | null
  merged_into_wine_id: string | null
  format_ml: number
  quantity: number
  position_count: number
}

interface CatalogWine extends CatalogWineRow {
  facts: WineFacts
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

type ProfileFilter = "ALL" | ProfileCoverage
type FactFilter = "ALL" | CoreFactCoverage

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

function curationCategoryLabel(item: CatalogCurationItem): string {
  switch (item.category) {
    case "shared-profile":
      return "Shared library"
    case "household-fact":
      return "Fact suggestion"
    case "wine-data":
      return "Your cellar data"
  }
}

const CATALOG_QUERY = `
  select
    w.id,
    w.household_id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color,
    w.appellation,
    w.area,
    w.country,
    w.classification,
    w.vineyard,
    w.grape_composition,
    w.sweetness_category,
    w.alcohol_percent,
    w.certifications,
    w.wine_reference_id,
    w.wine_reference_type,
    w.merged_into_wine_id,
    w.format_ml,
    coalesce(sum(h.quantity), 0) as quantity,
    coalesce(sum(case when h.quantity > 0 then 1 else 0 end), 0)
      as position_count
  from wines w
  left join holdings h
    on h.wine_id = w.id
  where w.household_id = ?
    and w.merged_into_wine_id is null
  group by
    w.id,
    w.household_id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color,
    w.appellation,
    w.area,
    w.country,
    w.classification,
    w.vineyard,
    w.grape_composition,
    w.sweetness_category,
    w.alcohol_percent,
    w.certifications,
    w.wine_reference_id,
    w.wine_reference_type,
    w.merged_into_wine_id,
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
  const [colorFilter, setColorFilter] = useState("ALL")
  const [areaFilter, setAreaFilter] = useState("ALL")
  const [countryFilter, setCountryFilter] = useState("ALL")
  const [sweetnessFilter, setSweetnessFilter] = useState("ALL")
  const [factFilter, setFactFilter] = useState<FactFilter>("ALL")
  const [profileFilter, setProfileFilter] =
    useState<ProfileFilter>("ALL")
  const [curationItemId, setCurationItemId] =
    useState<string | null>(null)
  const [maturityOverview, setMaturityOverview] =
    useState<MaturityOverviewItem[]>([])
  const [maturityLoading, setMaturityLoading] = useState(false)
  const [maturityError, setMaturityError] =
    useState<string | null>(null)
  const [researchInbox, setResearchInbox] =
    useState<ResearchInbox | null>(null)
  const [researchLoading, setResearchLoading] = useState(false)
  const [researchError, setResearchError] =
    useState<string | null>(null)
  const [researchMessage, setResearchMessage] =
    useState<string | null>(null)
  const [requestingCurationItemId, setRequestingCurationItemId] =
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
  const catalogResultsRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    setEditingWineId(null)
    setSavingWineId(null)
    setMutationMessage(null)
    setMutationError(null)
  }, [householdId])

  const catalogWines = useMemo<CatalogWine[]>(
    () =>
      wines.map((wine) => ({
        ...wine,
        facts: parseWineFacts(wine),
      })),
    [wines],
  )

  useEffect(() => {
    setMaturityOverview([])
    setMaturityError(null)

    if (!isOnline) {
      setMaturityFilter("ALL")
      setProfileFilter("ALL")
      setCurationItemId(null)
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

  useEffect(() => {
    setResearchInbox(null)
    setResearchError(null)
    setResearchMessage(null)
    setRequestingCurationItemId(null)

    if (!isOnline) {
      setResearchLoading(false)
      return
    }

    let cancelled = false
    setResearchLoading(true)

    void getEnrichmentResearchInbox(householdId)
      .then((inbox) => {
        if (!cancelled) setResearchInbox(inbox)
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setResearchError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load enrichment research",
          )
        }
      })
      .finally(() => {
        if (!cancelled) setResearchLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [householdId, isOnline])

  useEffect(() => {
    if (curationItemId !== null) {
      catalogResultsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    }
  }, [curationItemId])

  const maturityByWineId = useMemo(
    () =>
      new Map(
        maturityOverview.map((item) => [item.wineId, item]),
      ),
    [maturityOverview],
  )

  const curationQueue = useMemo(
    () =>
      buildCatalogCurationQueue(
        catalogWines.map((wine) => ({
          alcoholPercent: wine.facts.alcoholPercent,
          appellation: wine.appellation,
          area: wine.area,
          color: wine.color,
          cuvee: wine.cuvee,
          facts: wine.facts,
          id: wine.id,
          producer: wine.producer,
          quantity: wine.quantity,
          vintage: wine.vintage,
        })),
        maturityByWineId,
      ),
    [catalogWines, maturityByWineId],
  )

  const curationById = useMemo(
    () => new Map(curationQueue.map((item) => [item.id, item])),
    [curationQueue],
  )

  const vintageOptions = useMemo(() => {
    const vintages = [
      ...new Set(
        catalogWines
          .filter((wine) => wine.vintage !== null)
          .map((wine) => wine.vintage as number),
      ),
    ].sort((left, right) => right - left)

    return {
      vintages,
      hasNv: catalogWines.some((wine) => wine.vintage === null),
    }
  }, [catalogWines])

  const colorSuggestions = useMemo(
    () =>
      [...new Set(catalogWines.map((wine) => wine.color))]
        .sort((left, right) =>
          left.localeCompare(right),
        ),
    [catalogWines],
  )

  const appellationSuggestions = useMemo(
    () =>
      [
        ...new Set(
          catalogWines
            .map((wine) => wine.appellation)
            .filter(
              (value): value is string =>
                value !== null,
            ),
        ),
      ].sort((left, right) =>
        left.localeCompare(right),
      ),
    [catalogWines],
  )

  const areaSuggestions = useMemo(
    () =>
      [
        ...new Set(
          catalogWines
            .map((wine) => wine.area)
            .filter(
              (value): value is string =>
                value !== null,
            ),
        ),
      ].sort((left, right) =>
        left.localeCompare(right),
      ),
    [catalogWines],
  )

  const countrySuggestions = useMemo(
    () =>
      [
        ...new Set(
          catalogWines
            .map((wine) => wine.facts.country)
            .filter((value): value is string => value !== null),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [catalogWines],
  )

  const activeCurationItem = curationItemId
    ? curationById.get(curationItemId) ?? null
    : null

  const coverageSummary = useMemo(() => {
    let completeFacts = 0
    let fullProfiles = 0
    let profilesToRefine = 0
    let unavailableProfiles = 0

    for (const wine of catalogWines) {
      if (getCatalogFactCoverage(wine.facts).status === "complete") {
        completeFacts += 1
      }

      const profile = getCatalogProfileCoverage(
        maturityByWineId.get(wine.id),
      )
      if (profile.status === "full") {
        fullProfiles += 1
      } else if (profile.status === "needs-refinement") {
        profilesToRefine += 1
      } else if (profile.status === "unavailable") {
        unavailableProfiles += 1
      }
    }

    return {
      completeFacts,
      fullProfiles,
      profilesToRefine,
      unavailableProfiles,
    }
  }, [catalogWines, maturityByWineId])

  const visibleWines = useMemo(
    () =>
      catalogWines.filter((wine) => {
        if (
          stockFilter === "IN_STOCK" &&
          wine.quantity <= 0
        ) {
          return false
        }

        if (colorFilter !== "ALL" && wine.color !== colorFilter) {
          return false
        }

        if (areaFilter !== "ALL" && wine.area !== areaFilter) {
          return false
        }

        if (
          countryFilter !== "ALL" &&
          wine.facts.country !== countryFilter
        ) {
          return false
        }

        if (
          sweetnessFilter !== "ALL" &&
          wine.facts.sweetnessCategory !== sweetnessFilter
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

        const factCoverage = getCatalogFactCoverage(wine.facts)
        if (factFilter !== "ALL" && factCoverage.status !== factFilter) {
          return false
        }

        const profileCoverage = getCatalogProfileCoverage(maturity)
        if (
          profileFilter !== "ALL" &&
          profileCoverage.status !== profileFilter
        ) {
          return false
        }

        if (
          activeCurationItem &&
          !activeCurationItem.wineIds.includes(wine.id)
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
            wine.facts.country,
            wine.facts.classification,
            wine.facts.vineyard,
            ...wine.facts.grapeComposition.flatMap((grape) => [
              grape.name,
              grape.percentage,
            ]),
            wine.facts.sweetnessCategory,
            wine.facts.alcoholPercent,
            ...wine.facts.certifications,
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
      activeCurationItem,
      areaFilter,
      catalogWines,
      colorFilter,
      countryFilter,
      factFilter,
      maturityByWineId,
      maturityFilter,
      profileFilter,
      search,
      stockFilter,
      sweetnessFilter,
      vintageFilter,
    ],
  )

  const totalBottles = catalogWines.reduce(
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
    maturityFilter !== "ALL" ||
    colorFilter !== "ALL" ||
    areaFilter !== "ALL" ||
    countryFilter !== "ALL" ||
    sweetnessFilter !== "ALL" ||
    factFilter !== "ALL" ||
    profileFilter !== "ALL" ||
    activeCurationItem !== null

  function clearFilters() {
    setSearch("")
    setStockFilter("ALL")
    setVintageFilter("ALL")
    setMaturityFilter("ALL")
    setColorFilter("ALL")
    setAreaFilter("ALL")
    setCountryFilter("ALL")
    setSweetnessFilter("ALL")
    setFactFilter("ALL")
    setProfileFilter("ALL")
    setCurationItemId(null)
  }

  function showCurationWines(itemId: string) {
    setSearch("")
    setStockFilter("ALL")
    setVintageFilter("ALL")
    setMaturityFilter("ALL")
    setColorFilter("ALL")
    setAreaFilter("ALL")
    setCountryFilter("ALL")
    setSweetnessFilter("ALL")
    setFactFilter("ALL")
    setProfileFilter("ALL")
    setCurationItemId(itemId)
  }

  async function refreshResearchInbox() {
    if (!isOnline) return
    setResearchLoading(true)
    setResearchError(null)
    try {
      setResearchInbox(await getEnrichmentResearchInbox(householdId))
    } catch (caughtError: unknown) {
      setResearchError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to refresh enrichment research",
      )
    } finally {
      setResearchLoading(false)
    }
  }

  async function requestResearch(item: CatalogCurationItem) {
    const wineId = item.wineIds[0]
    if (!isOnline || !wineId || item.category === "wine-data") return

    setRequestingCurationItemId(item.id)
    setResearchError(null)
    setResearchMessage(null)
    try {
      setResearchInbox(
        await requestEnrichmentResearch(
          householdId,
          wineId,
          item.gap,
          item.priority,
        ),
      )
      setResearchMessage(
        "Research requested. It will use only approved sources and will return as an inactive draft for review.",
      )
    } catch (caughtError: unknown) {
      setResearchError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to request enrichment research",
      )
    } finally {
      setRequestingCurationItemId(null)
    }
  }

  function openResearchCase(caseId: string) {
    const card = document.getElementById(`research-case-${caseId}`)
    if (!card) return

    const inbox = card.closest("details")
    if (inbox instanceof HTMLDetailsElement) inbox.open = true
    window.requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  async function markResearchSeen() {
    if (!isOnline || (researchInbox?.unreadCount ?? 0) === 0) return
    try {
      setResearchInbox(
        await markEnrichmentResearchSeen(householdId, null),
      )
    } catch (caughtError: unknown) {
      setResearchError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to mark research as seen",
      )
    }
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

        <details className="catalog-advanced-filters">
          <summary>
            <span>
              <strong className="catalog-advanced-filters__closed-label">
                Show advanced filters
              </strong>
              <strong className="catalog-advanced-filters__open-label">
                Hide advanced filters
              </strong>
              <small>
                Color, area, country, sweetness, facts, and profile depth
                {colorFilter !== "ALL" ||
                areaFilter !== "ALL" ||
                countryFilter !== "ALL" ||
                sweetnessFilter !== "ALL" ||
                factFilter !== "ALL" ||
                profileFilter !== "ALL"
                  ? " · filters active"
                  : ""}
              </small>
            </span>
            <span
              aria-hidden="true"
              className="catalog-advanced-filters__chevron"
            >
              ▾
            </span>
          </summary>

          <div className="catalog-advanced-filters__grid">
            <label>
              Color
              <select
                onChange={(event) => setColorFilter(event.target.value)}
                value={colorFilter}
              >
                <option value="ALL">All colors</option>
                {colorSuggestions.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Area
              <select
                onChange={(event) => setAreaFilter(event.target.value)}
                value={areaFilter}
              >
                <option value="ALL">All areas</option>
                {areaSuggestions.map((area) => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Country
              <select
                onChange={(event) => setCountryFilter(event.target.value)}
                value={countryFilter}
              >
                <option value="ALL">All countries</option>
                {countrySuggestions.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Sweetness
              <select
                onChange={(event) => setSweetnessFilter(event.target.value)}
                value={sweetnessFilter}
              >
                <option value="ALL">All sweetness levels</option>
                <option value="bone-dry">Bone-dry</option>
                <option value="dry">Dry</option>
                <option value="off-dry">Off-dry</option>
                <option value="medium-sweet">Medium-sweet</option>
                <option value="sweet">Sweet</option>
              </select>
            </label>

            <label>
              Core facts
              <select
                onChange={(event) =>
                  setFactFilter(event.target.value as FactFilter)
                }
                value={factFilter}
              >
                <option value="ALL">All fact coverage</option>
                <option value="complete">Country, grapes, sweetness set</option>
                <option value="partial">Some core facts set</option>
                <option value="missing">No core facts set</option>
              </select>
            </label>

            <label>
              Profile depth
              <select
                disabled={!isOnline || maturityLoading}
                onChange={(event) =>
                  setProfileFilter(event.target.value as ProfileFilter)
                }
                value={profileFilter}
              >
                <option value="ALL">All profile coverage</option>
                <option value="full">Vintage + producer + cuvée</option>
                <option value="needs-refinement">Needs library refinement</option>
                <option value="unavailable">Cannot assess yet</option>
                <option value="pending">Assessment pending</option>
              </select>
            </label>
          </div>
        </details>

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

      <section
        aria-labelledby="catalog-coverage-heading"
        className="catalog-coverage"
      >
        <div className="catalog-coverage__heading">
          <div>
            <h2 id="catalog-coverage-heading">Knowledge coverage</h2>
            <p>
              Separate household facts, cellar-data issues, and missing shared
              profiles. Low confidence alone does not create a curation task.
            </p>
          </div>
        </div>

        <div className="catalog-coverage__summary">
          <div>
            <strong>{coverageSummary.completeFacts}</strong>
            <span>of {catalogWines.length} with core facts</span>
            <small>Country, grapes, and sweetness</small>
          </div>
          <div>
            <strong>{coverageSummary.fullProfiles}</strong>
            <span>full-depth profiles</span>
            <small>Vintage, producer, and cuvée layers</small>
          </div>
          <div>
            <strong>{coverageSummary.profilesToRefine}</strong>
            <span>assessed but refinable</span>
            <small>Broader safe guidance remains active</small>
          </div>
          <div>
            <strong>{coverageSummary.unavailableProfiles}</strong>
            <span>cannot be assessed yet</span>
            <small>Identity, date, or place profile needed</small>
          </div>
        </div>

        {!isOnline ? (
          <p className="catalog-coverage__offline">
            Core fact coverage remains available offline. Reconnect to refresh
            profile coverage and the curation queue.
          </p>
        ) : maturityLoading ? (
          <p className="catalog-coverage__offline">
            Checking the reviewed profile layers…
          </p>
        ) : (
          <details className="catalog-curation-queue">
            <summary>
              <span>
                <strong className="catalog-curation-queue__closed-label">
                  Show prioritized curation queue · {curationQueue.length} items
                </strong>
                <strong className="catalog-curation-queue__open-label">
                  Hide prioritized curation queue · {curationQueue.length} items
                </strong>
                <small>
                  Missing facts, shared profiles, and cellar-data issues ranked
                  by impact
                </small>
              </span>
              <span
                aria-hidden="true"
                className="catalog-curation-queue__chevron"
              >
                ▾
              </span>
            </summary>
            <p>
              Ranked by bottles and wines affected. Research uses approved
              sources and remains an inactive, attributable draft until review.
            </p>

            {curationQueue.length === 0 ? (
              <p>No fact, profile, or cellar-data gaps were detected.</p>
            ) : (
              <ol>
                {curationQueue.slice(0, 12).map((item) => {
                  const research = findEnrichmentResearchForCurationItem(
                    researchInbox,
                    item.gap,
                    item.wineIds,
                  )
                  const researchAction =
                    enrichmentResearchCurationAction(research)

                  return (
                    <li key={item.id}>
                    <div>
                      <span className="catalog-curation-queue__category">
                        {curationCategoryLabel(item)}
                      </span>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                      <small>
                        {item.wineCount} {item.wineCount === 1 ? "wine" : "wines"}
                        {" · "}
                        {item.bottleCount} {item.bottleCount === 1 ? "bottle" : "bottles"}
                      </small>
                    </div>
                    <div className="catalog-curation-queue__actions">
                      <button
                        aria-pressed={activeCurationItem?.id === item.id}
                        disabled={activeCurationItem?.id === item.id}
                        onClick={() => showCurationWines(item.id)}
                        type="button"
                      >
                        {activeCurationItem?.id === item.id
                          ? "Shown below"
                          : "Show wines"}
                      </button>
                      {item.category !== "wine-data" ? (
                        <button
                          disabled={
                            researchAction.kind === "waiting" ||
                            (researchAction.kind === "request" &&
                              (!isOnline || requestingCurationItemId !== null))
                          }
                          onClick={() => {
                            if (researchAction.kind === "open" && research) {
                              openResearchCase(research.caseId)
                            } else if (researchAction.kind === "request") {
                              void requestResearch(item)
                            }
                          }}
                          type="button"
                        >
                          {requestingCurationItemId === item.id
                            ? "Requesting…"
                            : researchAction.label}
                        </button>
                      ) : null}
                    </div>
                    </li>
                  )
                })}
              </ol>
            )}

            {curationQueue.length > 12 ? (
              <p>
                Showing the 12 highest-impact items of {curationQueue.length}.
              </p>
            ) : null}
          </details>
        )}

        {researchMessage ? (
          <Notice role="status" tone="success">
            {researchMessage}
          </Notice>
        ) : null}

        <EnrichmentResearchInbox
          error={researchError}
          householdId={householdId}
          inbox={researchInbox}
          isLoading={researchLoading}
          isOnline={isOnline}
          onInboxChange={setResearchInbox}
          onMarkSeen={() => void markResearchSeen()}
          onOpenWine={onOpenWine}
          onRefresh={() => void refreshResearchInbox()}
        />
      </section>

      <WineDuplicateReview
        householdId={householdId}
        isOnline={isOnline}
        wines={catalogWines}
      />

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

      <p className="catalog-results-summary" ref={catalogResultsRef}>
        {activeCurationItem ? (
          <strong>Queue filter: {activeCurationItem.title} · </strong>
        ) : null}
        Showing {visibleWines.length} of {catalogWines.length} wines
        {" · "}
        {visibleBottles} of {totalBottles} bottles
        {isOnline && !maturityLoading && !maturityError
          ? ` · ${maturityOverview.filter((item) => item.state !== null).length} assessed · ${maturityOverview.filter((item) => item.demandStatus === "needs-review").length} need input or review`
          : ""}
      </p>

      {!isLoading && catalogWines.length === 0 ? (
        <p>No synchronized wines found.</p>
      ) : null}

      {!isLoading &&
      catalogWines.length > 0 &&
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
            const factCoverage = getCatalogFactCoverage(wine.facts)

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
                      <span className="catalog-wine-coverage">
                        Core facts {factCoverage.presentCoreFactCount}/3
                        {isOnline && !maturityLoading
                          ? ` · ${profileCoverageLabel(maturity)}`
                          : ""}
                      </span>
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
