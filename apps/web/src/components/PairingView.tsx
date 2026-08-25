import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react"

import { formatWineVolume } from "../data/wineCatalog"
import {
  PAIRING_ATTRIBUTE_KEYS,
  getPairingDishProfiles,
  getPairingSuggestions,
  reviewPairingSuggestion,
  setPairingPreference,
  type PairingAttributes,
  type PairingAttributeKey,
  type PairingDishProfile,
  type PairingResult,
  type PairingStyle,
  type PairingVerdict,
} from "../data/winePairing"
import { Notice } from "./Notice"

interface PairingViewProps {
  householdId: string
  isOnline: boolean
  onOpenWine: (wineId: string) => void
}

const COLOR_OPTIONS = [
  { label: "Red", value: "red" },
  { label: "White", value: "white" },
  { label: "Rosé", value: "rose" },
  { label: "Sparkling", value: "sparkling" },
  { label: "Sweet", value: "sweet" },
  { label: "Fortified", value: "fortified" },
] as const

const STYLE_OPTIONS: Array<{
  description: string
  label: string
  value: PairingStyle
}> = [
  {
    description: "Acidity and energy",
    label: "Fresh",
    value: "fresh",
  },
  {
    description: "Less body and alcohol",
    label: "Light",
    value: "light",
  },
  {
    description: "Body and concentration",
    label: "Rich",
    value: "rich",
  },
  {
    description: "Earthy and developed flavours",
    label: "Savoury",
    value: "savory",
  },
  {
    description: "Ready or priority bottles",
    label: "Mature",
    value: "mature",
  },
]

const DISH_GROUPS = [
  {
    label: "Vegetables and light dishes",
    keys: [
      "salad-vinaigrette",
      "vegetable-crudites",
      "grilled-vegetables",
    ],
  },
  {
    label: "Fish and seafood",
    keys: [
      "oysters-shellfish",
      "salmon-lemon",
      "seafood-risotto",
      "sushi-sashimi",
      "white-fish-butter",
    ],
  },
  {
    label: "Poultry and pork",
    keys: [
      "charcuterie",
      "chicken-cream",
      "duck-cherry",
      "roast-chicken-mushrooms",
      "roast-pork",
    ],
  },
  {
    label: "Meat and game",
    keys: [
      "beef-stew",
      "game-stew",
      "grilled-beef",
      "roast-lamb-herbs",
    ],
  },
  {
    label: "Pasta, rice, and pizza",
    keys: [
      "creamy-pasta",
      "mushroom-risotto",
      "pizza",
      "tomato-pasta",
    ],
  },
  {
    label: "Spiced dishes",
    keys: [
      "hot-chilli-curry",
      "mild-coconut-curry",
      "spicy-lamb-tagine",
    ],
  },
  {
    label: "Cheese",
    keys: ["aged-cheese", "blue-cheese", "soft-cheese"],
  },
  {
    label: "Dessert and fruit",
    keys: [
      "chocolate-dessert",
      "creme-brulee",
      "fresh-fruit",
      "fruit-tart",
    ],
  },
  {
    label: "Advanced",
    keys: ["custom-dish"],
  },
] as const

const ATTRIBUTE_LABELS: Record<
  PairingAttributeKey,
  { description: string; label: string }
> = {
  acidity: {
    description: "Vinegar, citrus, or tomato",
    label: "Acidity",
  },
  fat: {
    description: "Oil, butter, cream, or fatty meat",
    label: "Richness",
  },
  fish: {
    description: "Fish or seafood sensitivity to tannin",
    label: "Fish / seafood",
  },
  intensity: {
    description: "Overall flavour strength",
    label: "Intensity",
  },
  protein: {
    description: "Meat or other firm protein",
    label: "Protein",
  },
  salt: {
    description: "Salt, cured ingredients, or hard cheese",
    label: "Salt",
  },
  spice: {
    description: "Chilli heat, not aromatic spice alone",
    label: "Heat",
  },
  sweetness: {
    description: "The wine should not be drier than a sweet dish",
    label: "Sweetness",
  },
  umami: {
    description: "Mushrooms, tomato, aged cheese, or slow cooking",
    label: "Umami",
  },
}

function maturityLabel(value: string | null): string {
  switch (value) {
    case "hold":
      return "Hold"
    case "assess":
      return "Start assessing"
    case "ready":
      return "Likely ready"
    case "priority":
      return "Drink sooner"
    case "assess-now":
      return "Assess now"
    default:
      return "Readiness uncertain"
  }
}

function feedbackLabel(verdict: PairingVerdict): string {
  switch (verdict) {
    case "useful":
      return "Good suggestion"
    case "questionable":
      return "Not for me"
    case "wrong":
      return "Poor match"
  }
}

function initialDishState(dish: PairingDishProfile): {
  attributes: PairingAttributes
  colors: string[]
  style: PairingStyle | null
} {
  return {
    attributes: { ...dish.attributes },
    colors: [...(dish.preference?.preferredColors ?? [])],
    style: dish.preference?.preferredStyle ?? null,
  }
}

export function PairingView({
  householdId,
  isOnline,
  onOpenWine,
}: PairingViewProps) {
  const [dishes, setDishes] = useState<PairingDishProfile[]>([])
  const [selectedDishKey, setSelectedDishKey] = useState("")
  const [dishAttributes, setDishAttributes] =
    useState<PairingAttributes | null>(null)
  const [preferredColors, setPreferredColors] =
    useState<string[]>([])
  const [preferredStyle, setPreferredStyle] =
    useState<PairingStyle | null>(null)
  const [rememberPreference, setRememberPreference] =
    useState(false)
  const [result, setResult] = useState<PairingResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [busyFeedback, setBusyFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const selectedDish = useMemo(
    () => dishes.find((dish) => dish.key === selectedDishKey) ?? null,
    [dishes, selectedDishKey],
  )
  const groupedDishes = useMemo(() => {
    const byKey = new Map(dishes.map((dish) => [dish.key, dish]))
    const groupedKeys = new Set<string>(
      DISH_GROUPS.flatMap((group) => group.keys),
    )
    const groups = DISH_GROUPS.map((group) => ({
      dishes: group.keys
        .map((key) => byKey.get(key))
        .filter((dish): dish is PairingDishProfile => Boolean(dish)),
      label: group.label,
    })).filter((group) => group.dishes.length > 0)
    const otherDishes = dishes.filter(
      (dish) => !groupedKeys.has(dish.key),
    )
    const advancedGroup = groups.find(
      (group) => group.label === "Advanced",
    )
    const standardGroups = groups.filter(
      (group) => group.label !== "Advanced",
    )

    return [
      ...standardGroups,
      ...(otherDishes.length > 0
        ? [{ dishes: otherDishes, label: "Other" }]
        : []),
      ...(advancedGroup ? [advancedGroup] : []),
    ]
  }, [dishes])

  useEffect(() => {
    setDishes([])
    setSelectedDishKey("")
    setDishAttributes(null)
    setResult(null)
    setError(null)
    setMessage(null)

    if (!isOnline) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)

    void getPairingDishProfiles(householdId)
      .then((profiles) => {
        if (cancelled) {
          return
        }

        setDishes(profiles)
        const first = profiles[0]
        if (first) {
          const initial = initialDishState(first)
          setSelectedDishKey(first.key)
          setDishAttributes(initial.attributes)
          setPreferredColors(initial.colors)
          setPreferredStyle(initial.style)
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load pairing dishes",
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [householdId, isOnline])

  function chooseDish(dishKey: string) {
    const dish = dishes.find((item) => item.key === dishKey)
    if (!dish) {
      return
    }

    const initial = initialDishState(dish)
    setSelectedDishKey(dish.key)
    setDishAttributes(initial.attributes)
    setPreferredColors(initial.colors)
    setPreferredStyle(initial.style)
    setRememberPreference(false)
    setResult(null)
    setError(null)
    setMessage(null)
  }

  function changeAttribute(
    key: PairingAttributeKey,
    value: number,
  ) {
    setDishAttributes((current) =>
      current ? { ...current, [key]: value } : current,
    )
    setResult(null)
  }

  function toggleColor(color: string) {
    setPreferredColors((current) =>
      current.includes(color)
        ? current.filter((item) => item !== color)
        : [...current, color],
    )
    setResult(null)
  }

  async function findPairings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline || !selectedDish || !dishAttributes) {
      return
    }

    setIsSearching(true)
    setError(null)
    setMessage(null)

    try {
      if (rememberPreference) {
        await setPairingPreference(
          householdId,
          selectedDish.key,
          preferredColors,
          preferredStyle,
        )
        setDishes((current) =>
          current.map((dish) =>
            dish.key === selectedDish.key
              ? {
                  ...dish,
                  preference: {
                    preferredColors,
                    preferredStyle,
                    updatedAt: new Date().toISOString(),
                  },
                }
              : dish,
          ),
        )
        setMessage("Your color and style defaults were saved for this dish.")
      }

      setResult(
        await getPairingSuggestions(
          householdId,
          selectedDish.key,
          dishAttributes,
          preferredColors,
          preferredStyle,
        ),
      )
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to find pairing suggestions",
      )
    } finally {
      setIsSearching(false)
    }
  }

  async function forgetPreference() {
    if (!selectedDish || !isOnline) {
      return
    }

    setIsSearching(true)
    setError(null)
    setMessage(null)

    try {
      await setPairingPreference(
        householdId,
        selectedDish.key,
        [],
        null,
      )
      setDishes((current) =>
        current.map((dish) =>
          dish.key === selectedDish.key
            ? { ...dish, preference: null }
            : dish,
        ),
      )
      setPreferredColors([])
      setPreferredStyle(null)
      setRememberPreference(false)
      setResult(null)
      setMessage("Your saved defaults were removed.")
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to remove pairing preferences",
      )
    } finally {
      setIsSearching(false)
    }
  }

  async function saveFeedback(
    projectionId: string,
    verdict: PairingVerdict,
  ) {
    if (!isOnline) {
      return
    }

    setBusyFeedback(`${projectionId}:${verdict}`)
    setError(null)
    setMessage(null)

    try {
      await reviewPairingSuggestion(projectionId, verdict)
      setResult((current) =>
        current
          ? {
              ...current,
              suggestions: current.suggestions.map((suggestion) =>
                suggestion.projectionId === projectionId
                  ? { ...suggestion, feedbackVerdict: verdict }
                  : suggestion,
              ),
            }
          : current,
      )
      setMessage(
        "Your feedback was saved and will refine future results for this dish.",
      )
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save pairing feedback",
      )
    } finally {
      setBusyFeedback(null)
    }
  }

  return (
    <main className="pairing-view">
      <header className="view-heading">
        <div>
          <h1>Food pairing</h1>
          <p>
            Describe tonight&apos;s dish and rank only bottles currently in your
            cellar. The result is structural advice, not a guarantee.
          </p>
        </div>
      </header>

      {!isOnline ? (
        <Notice tone="warning">
          Pairing advice requires a connection. Inventory remains available
          offline.
        </Notice>
      ) : null}

      {isLoading ? (
        <Notice role="status">Loading reviewed dish profiles…</Notice>
      ) : null}

      {error ? (
        <Notice role="alert" tone="error">
          {error}
        </Notice>
      ) : null}

      {message ? (
        <Notice role="status" tone="success">
          {message}
        </Notice>
      ) : null}

      {!isLoading && isOnline && !error && dishes.length === 0 ? (
        <Notice tone="warning">
          Pairing knowledge is not active yet. Try again after the deployment
          finishes preparing it.
        </Notice>
      ) : null}

      {selectedDish && dishAttributes ? (
        <form
          className="pairing-builder"
          onSubmit={(event) => void findPairings(event)}
        >
          <div className="pairing-builder__main">
            <div className="pairing-builder__dish">
              <label>
                What are you serving?
                <select
                  onChange={(event) => chooseDish(event.target.value)}
                  value={selectedDishKey}
                >
                  {groupedDishes.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.dishes.map((dish) => (
                        <option key={dish.key} value={dish.key}>
                          {dish.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <p className="pairing-builder__description">
                {selectedDish.description}
              </p>
            </div>

            <fieldset className="pairing-builder__preferences">
              <legend>
                Wine preferences <span>(optional)</span>
              </legend>
              <p>
                Leave these open to consider every compatible bottle in your
                cellar.
              </p>
              <div className="pairing-builder__colors">
                <span>Wine colors</span>
                <div>
                  {COLOR_OPTIONS.map((option) => (
                    <label key={option.value}>
                      <input
                        checked={preferredColors.includes(option.value)}
                        onChange={() => toggleColor(option.value)}
                        type="checkbox"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
              <label className="pairing-builder__style">
                Preferred style
                <select
                  onChange={(event) => {
                    setPreferredStyle(
                      (event.target.value || null) as PairingStyle | null,
                    )
                    setResult(null)
                  }}
                  value={preferredStyle ?? ""}
                >
                  <option value="">No style preference</option>
                  {STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} — {option.description}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          </div>

          <details
            className="pairing-builder__details"
            key={selectedDish.key}
            open={selectedDish.key === "custom-dish" ? true : undefined}
          >
            <summary>Adjust ingredients and preparation</summary>
            <p>
              The selected dish is only a starting point. Change what matters
              for your actual recipe.
            </p>
            <div className="pairing-builder__sliders">
              {PAIRING_ATTRIBUTE_KEYS.map((key) => (
                <label key={key}>
                  <span>
                    <strong>{ATTRIBUTE_LABELS[key].label}</strong>
                    <small>{ATTRIBUTE_LABELS[key].description}</small>
                  </span>
                  <input
                    aria-label={ATTRIBUTE_LABELS[key].label}
                    max="5"
                    min="0"
                    onChange={(event) =>
                      changeAttribute(key, Number(event.target.value))
                    }
                    step="1"
                    type="range"
                    value={dishAttributes[key]}
                  />
                  <output>{dishAttributes[key]} / 5</output>
                </label>
              ))}
            </div>
          </details>

          <div className="pairing-builder__actions">
            <label>
              <input
                checked={rememberPreference}
                onChange={(event) =>
                  setRememberPreference(event.target.checked)
                }
                type="checkbox"
              />
              Remember color and style for this dish
            </label>
            <div>
              <button
                disabled={!isOnline || isSearching}
                type="submit"
              >
                {isSearching ? "Comparing bottles…" : "Find bottles"}
              </button>
              {selectedDish.preference ? (
                <button
                  disabled={!isOnline || isSearching}
                  onClick={() => void forgetPreference()}
                  type="button"
                >
                  Forget saved defaults
                </button>
              ) : null}
            </div>
          </div>
        </form>
      ) : null}

      {result ? (
        <section
          aria-labelledby="pairing-results-heading"
          className="pairing-results"
        >
          <div className="wine-detail-section-heading">
            <div>
              <h2 id="pairing-results-heading">
                Bottles for {result.dish.name}
              </h2>
              <p>
                {result.assessedCandidates} of {result.stockWines} in-stock
                wines had a compatible reviewed structure
                {result.unavailableProfiles > 0
                  ? `; ${result.unavailableProfiles} could not yet be assessed`
                  : ""}
                .
              </p>
            </div>
          </div>

          {result.status === "preparing" ? (
            <Notice role="status">
              Wine profiles are still being prepared. Try again shortly.
            </Notice>
          ) : null}

          {result.status === "not-assessed" ? (
            <Notice tone="warning">
              No in-stock wine has a reviewed pairing profile yet. Nothing was
              guessed from color alone.
            </Notice>
          ) : null}

          {result.status === "no-suitable-wine" ? (
            <Notice tone="warning">
              No assessed bottle clears the safety threshold for this dish and
              your current preferences.
            </Notice>
          ) : null}

          {result.bestRejected && result.suggestions.length === 0 ? (
            <details className="pairing-results__rejected">
              <summary>Why the closest bottle was rejected</summary>
              <strong>
                {result.bestRejected.producer} — {result.bestRejected.cuvee}{" "}
                {result.bestRejected.vintage ?? "NV"}
              </strong>
              <p>{result.bestRejected.scoreLabel}</p>
              <ul>
                {result.bestRejected.cautions.map((caution) => (
                  <li key={caution}>{caution}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {result.suggestions.length > 0 ? (
            <ol className="pairing-results__list">
              {result.suggestions.map((suggestion) => (
                <li
                  className="pairing-result-card"
                  key={suggestion.projectionId}
                >
                  <header>
                    <div>
                      <span className="pairing-result-card__rank">
                        {suggestion.scoreLabel}
                      </span>
                      <h3>
                        <button
                          onClick={() => onOpenWine(suggestion.wineId)}
                          type="button"
                        >
                          {suggestion.producer} — {suggestion.cuvee}
                        </button>
                      </h3>
                      <p>
                        {suggestion.vintage ?? "NV"} · {suggestion.color}
                        {suggestion.appellation
                          ? ` · ${suggestion.appellation}`
                          : ""}
                        {` · ${formatWineVolume(suggestion.formatMl)}`}
                      </p>
                    </div>
                    <div className="pairing-result-card__status">
                      <strong>{maturityLabel(suggestion.maturityState)}</strong>
                      <span>{suggestion.confidenceLabel} confidence</span>
                    </div>
                  </header>

                  <div className="pairing-result-card__body">
                    <div>
                      <h4>Why it works</h4>
                      <ul>
                        {suggestion.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                    {suggestion.cautions.length > 0 ? (
                      <div>
                        <h4>Keep in mind</h4>
                        <ul>
                          {suggestion.cautions.map((caution) => (
                            <li key={caution}>{caution}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  <div className="pairing-result-card__locations">
                    <strong>{suggestion.quantity} bottle(s) in stock</strong>
                    <ul>
                      {suggestion.locations.map((location) => (
                        <li
                          key={`${location.cellar}:${location.location}`}
                        >
                          {location.cellar} / {location.location} ·{" "}
                          {location.quantity}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pairing-result-card__feedback">
                    <span>Would this work for you?</span>
                    <div>
                      {(
                        ["useful", "questionable", "wrong"] as const
                      ).map((verdict) => (
                        <button
                          aria-pressed={
                            suggestion.feedbackVerdict === verdict
                          }
                          disabled={
                            !isOnline || busyFeedback !== null
                          }
                          key={verdict}
                          onClick={() =>
                            void saveFeedback(
                              suggestion.projectionId,
                              verdict,
                            )
                          }
                          type="button"
                        >
                          {busyFeedback ===
                          `${suggestion.projectionId}:${verdict}`
                            ? "Saving…"
                            : feedbackLabel(verdict)}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
