import { type FormEvent, useEffect, useState } from "react"

import {
  getWineFactSuggestions,
  parseWineFacts,
  prepareWineFacts,
  SWEETNESS_CATEGORIES,
  sweetnessLabel,
  updateWineFacts,
  type WineFactsSource,
  type WineFactSuggestions,
  type WineGrapeDraft,
} from "../data/wineFacts"
import { Notice } from "./Notice"

interface WineFactsPanelProps {
  isOnline: boolean
  wine: WineFactsSource & {
    id: string
    wine_reference_id?: string | null
  }
}

const EMPTY_GRAPE: WineGrapeDraft = {
  name: "",
  percentage: "",
}

function alcoholLabel(value: number): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}%`
}

export function WineFactsPanel({
  isOnline,
  wine,
}: WineFactsPanelProps) {
  const parsed = (() => {
    try {
      return { facts: parseWineFacts(wine), error: null }
    } catch (caughtError: unknown) {
      return {
        facts: null,
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to read wine facts",
      }
    }
  })()

  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [country, setCountry] = useState("")
  const [region, setRegion] = useState("")
  const [classification, setClassification] = useState("")
  const [vineyard, setVineyard] = useState("")
  const [grapes, setGrapes] = useState<WineGrapeDraft[]>([
    { ...EMPTY_GRAPE },
  ])
  const [sweetness, setSweetness] = useState("")
  const [alcoholPercent, setAlcoholPercent] = useState("")
  const [certifications, setCertifications] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [suggestions, setSuggestions] =
    useState<WineFactSuggestions | null>(null)
  const [suggestionError, setSuggestionError] =
    useState<string | null>(null)

  useEffect(() => {
    setIsEditing(false)
    setIsSaving(false)
    setError(null)
    setMessage(null)
  }, [wine.id])

  useEffect(() => {
    setSuggestions(null)
    setSuggestionError(null)

    if (!isOnline) {
      return
    }

    let cancelled = false

    void getWineFactSuggestions(wine.id)
      .then((nextSuggestions) => {
        if (!cancelled) {
          setSuggestions(nextSuggestions)
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setSuggestionError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load reference suggestions",
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOnline, wine.id, wine.wine_reference_id])

  function startEditing(fillMissingSuggestions = false) {
    if (!parsed.facts) {
      return
    }

    const suggested =
      fillMissingSuggestions && suggestions?.status === "available"
        ? suggestions.values
        : null

    setCountry(parsed.facts.country ?? suggested?.country ?? "")
    setRegion(parsed.facts.region ?? suggested?.region ?? "")
    setClassification(
      parsed.facts.classification ?? suggested?.classification ?? "",
    )
    setVineyard(parsed.facts.vineyard ?? suggested?.vineyard ?? "")
    setGrapes(
      parsed.facts.grapeComposition.length > 0
        ? parsed.facts.grapeComposition.map((grape) => ({
            name: grape.name,
            percentage:
              grape.percentage === null
                ? ""
                : String(grape.percentage),
          }))
        : suggested && suggested.grapeComposition.length > 0
          ? suggested.grapeComposition.map((grape) => ({
              name: grape.name,
              percentage:
                grape.percentage === null
                  ? ""
                  : String(grape.percentage),
            }))
        : [{ ...EMPTY_GRAPE }],
    )
    setSweetness(
      parsed.facts.sweetnessCategory ??
        suggested?.sweetnessCategory ??
        "",
    )
    setAlcoholPercent(
      parsed.facts.alcoholPercent === null
        ? suggested?.alcoholPercent === null ||
          suggested?.alcoholPercent === undefined
          ? ""
          : String(suggested.alcoholPercent)
        : String(parsed.facts.alcoholPercent),
    )
    setCertifications(parsed.facts.certifications.join(", "))
    setError(null)
    setMessage(null)
    setIsEditing(true)
  }

  function updateGrape(
    index: number,
    field: keyof WineGrapeDraft,
    value: string,
  ) {
    setGrapes((current) =>
      current.map((grape, grapeIndex) =>
        grapeIndex === index
          ? { ...grape, [field]: value }
          : grape,
      ),
    )
  }

  async function saveFacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!isOnline) {
      setError("Reconnect before editing wine facts.")
      return
    }

    setIsSaving(true)

    try {
      const nextFacts = prepareWineFacts({
        alcoholPercent,
        certifications,
        classification,
        country,
        grapeComposition: grapes,
        region,
        sweetnessCategory: sweetness,
        vineyard,
      })

      await updateWineFacts(wine.id, nextFacts)
      setIsEditing(false)
      setMessage("Wine facts saved. Waiting for synchronization.")
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save wine facts",
      )
    } finally {
      setIsSaving(false)
    }
  }

  const facts = parsed.facts
  const hasFacts =
    facts !== null &&
    (facts.country !== null ||
      facts.region !== null ||
      facts.classification !== null ||
      facts.vineyard !== null ||
      facts.grapeComposition.length > 0 ||
      facts.sweetnessCategory !== null ||
      facts.alcoholPercent !== null ||
      facts.certifications.length > 0)

  return (
    <section
      aria-labelledby="wine-facts-heading"
      className="wine-facts"
    >
      <div className="wine-detail-section-heading">
        <div>
          <h2 id="wine-facts-heading">Wine facts</h2>
          <p>
            Origin, composition, style, and label details for this
            catalog wine.
          </p>
        </div>

        {!isEditing ? (
          <button
            disabled={!isOnline || facts === null}
            onClick={() => startEditing(false)}
            title={
              isOnline ? undefined : "Reconnect before editing"
            }
            type="button"
          >
            Edit facts
          </button>
        ) : null}
      </div>

      {!isOnline ? (
        <Notice tone="warning">
          Wine facts remain visible offline. Reconnect before editing
          them.
        </Notice>
      ) : null}

      {parsed.error ? (
        <Notice role="alert" tone="error">
          {parsed.error}
        </Notice>
      ) : null}

      {message ? (
        <Notice role="status" tone="success">
          {message}
        </Notice>
      ) : null}

      {error ? (
        <Notice role="alert" tone="error">
          {error}
        </Notice>
      ) : null}

      {suggestionError ? (
        <Notice role="status" tone="warning">
          Reviewed reference suggestions are temporarily unavailable.
        </Notice>
      ) : null}

      {suggestions?.status === "available" && suggestions.values ? (
        <aside className="wine-facts__suggestions">
          <div>
            <strong>Reviewed fact suggestions</strong>
            <p>
              {[
                suggestions.values.country,
                suggestions.values.region,
                suggestions.values.subregion,
                suggestions.values.classification,
                suggestions.values.vineyard,
                suggestions.values.grapeComposition.length > 0
                  ? suggestions.values.grapeComposition
                      .map((grape) => grape.name)
                      .join(", ")
                  : null,
                suggestions.values.sweetnessCategory
                  ? sweetnessLabel(suggestions.values.sweetnessCategory)
                  : null,
                suggestions.values.alcoholPercent === null
                  ? null
                  : alcoholLabel(suggestions.values.alcoholPercent),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {suggestions.values.grapeNote ? (
              <small>{suggestions.values.grapeNote}</small>
            ) : null}
            <ul className="wine-facts__suggestion-sources">
              {suggestions.sources.map((source) => (
                <li key={`${source.kind}-${source.name}`}>
                  {source.url ? (
                    <a
                      href={source.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {source.name}
                    </a>
                  ) : (
                    source.name
                  )}
                  {source.identifierScheme && source.identifierValue
                    ? ` · ${source.identifierScheme} ${source.identifierValue}`
                    : ""}
                </li>
              ))}
            </ul>
            <small>
              Nothing is applied until you review and save it.
            </small>
          </div>

          {!isEditing ? (
            <button
              disabled={!isOnline}
              onClick={() => startEditing(true)}
              type="button"
            >
              Fill missing reviewed facts
            </button>
          ) : null}

          <small className="wine-facts__suggestions-scope">
            Suggestions combine reviewed references and published,
            attributable web research. Typical appellation grapes never
            claim an exact blend without bottle-level evidence.
          </small>
        </aside>
      ) : null}

      {isEditing ? (
        <form
          className="wine-facts__form"
          onSubmit={(event) => void saveFacts(event)}
        >
          <div className="wine-facts__origin-fields">
            <label>
              Country
              <input
                disabled={isSaving}
                onChange={(event) => setCountry(event.target.value)}
                placeholder="France"
                value={country}
              />
            </label>

            <label>
              Region
              <input
                disabled={isSaving}
                onChange={(event) => setRegion(event.target.value)}
                placeholder="Burgundy"
                value={region}
              />
            </label>

            <label>
              Classification
              <input
                disabled={isSaving}
                onChange={(event) =>
                  setClassification(event.target.value)
                }
                placeholder="Premier Cru, DOCG…"
                value={classification}
              />
            </label>

            <label>
              Vineyard / site
              <input
                disabled={isSaving}
                onChange={(event) => setVineyard(event.target.value)}
                placeholder="Climat, vineyard, parcel…"
                value={vineyard}
              />
            </label>
          </div>

          <fieldset className="wine-facts__grapes">
            <legend>Grape composition</legend>
            <p>
              Percentages are optional. A known partial composition may
              total less than 100%.
            </p>

            <div className="wine-facts__grape-list">
              {grapes.map((grape, index) => (
                <div
                  className="wine-facts__grape-row"
                  key={`${index}-${grapes.length}`}
                >
                  <label>
                    <span className="visually-hidden">
                      Grape {index + 1}
                    </span>
                    <input
                      disabled={isSaving}
                      onChange={(event) =>
                        updateGrape(index, "name", event.target.value)
                      }
                      placeholder="Grape variety"
                      value={grape.name}
                    />
                  </label>

                  <label className="wine-facts__percentage">
                    <span className="visually-hidden">
                      Grape {index + 1} percentage
                    </span>
                    <input
                      disabled={isSaving}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateGrape(
                          index,
                          "percentage",
                          event.target.value,
                        )
                      }
                      placeholder="% optional"
                      value={grape.percentage}
                    />
                  </label>

                  <button
                    aria-label={`Remove grape ${grape.name || index + 1}`}
                    disabled={isSaving}
                    onClick={() =>
                      setGrapes((current) => {
                        const next = current.filter(
                          (_, grapeIndex) => grapeIndex !== index,
                        )
                        return next.length > 0
                          ? next
                          : [{ ...EMPTY_GRAPE }]
                      })
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <button
              disabled={isSaving || grapes.length >= 20}
              onClick={() =>
                setGrapes((current) => [
                  ...current,
                  { ...EMPTY_GRAPE },
                ])
              }
              type="button"
            >
              Add grape
            </button>
          </fieldset>

          <div className="wine-facts__style-fields">
            <label>
              Sweetness
              <select
                disabled={isSaving}
                onChange={(event) => setSweetness(event.target.value)}
                value={sweetness}
              >
                <option value="">Not set</option>
                {SWEETNESS_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {sweetnessLabel(category)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Alcohol (% vol.)
              <input
                disabled={isSaving}
                inputMode="decimal"
                onChange={(event) =>
                  setAlcoholPercent(event.target.value)
                }
                placeholder="13.5"
                value={alcoholPercent}
              />
            </label>

            <label className="wine-facts__certifications-field">
              Certifications
              <textarea
                disabled={isSaving}
                onChange={(event) =>
                  setCertifications(event.target.value)
                }
                placeholder="Organic, Demeter, HVE…"
                rows={2}
                value={certifications}
              />
              <small>Separate labels with commas or new lines.</small>
            </label>
          </div>

          <Notice tone="info">
            These remain household-maintained facts. Reviewed enrichment
            can fill missing fields only after you choose and save them.
          </Notice>

          <div className="wine-facts__actions">
            <button disabled={!isOnline || isSaving} type="submit">
              {isSaving ? "Saving…" : "Save facts"}
            </button>
            <button
              disabled={isSaving}
              onClick={() => {
                setIsEditing(false)
                setError(null)
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : facts && hasFacts ? (
        <div className="wine-facts__content">
          <dl className="wine-facts__metadata">
            <div>
              <dt>Country</dt>
              <dd>{facts.country ?? "—"}</dd>
            </div>
            <div>
              <dt>Region</dt>
              <dd>{facts.region ?? "—"}</dd>
            </div>
            <div>
              <dt>Classification</dt>
              <dd>{facts.classification ?? "—"}</dd>
            </div>
            <div>
              <dt>Vineyard / site</dt>
              <dd>{facts.vineyard ?? "—"}</dd>
            </div>
            <div>
              <dt>Sweetness</dt>
              <dd>
                {facts.sweetnessCategory
                  ? sweetnessLabel(facts.sweetnessCategory)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Alcohol</dt>
              <dd>
                {facts.alcoholPercent === null
                  ? "—"
                  : alcoholLabel(facts.alcoholPercent)}
              </dd>
            </div>
          </dl>

          <div className="wine-facts__lists">
            <div>
              <h3>Grapes</h3>
              {facts.grapeComposition.length > 0 ? (
                <ul className="wine-facts__tags">
                  {facts.grapeComposition.map((grape) => (
                    <li key={grape.name.toLowerCase()}>
                      {grape.name}
                      {grape.percentage === null
                        ? ""
                        : ` · ${grape.percentage}%`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Not set</p>
              )}
            </div>

            <div>
              <h3>Certifications</h3>
              {facts.certifications.length > 0 ? (
                <ul className="wine-facts__tags">
                  {facts.certifications.map((certification) => (
                    <li key={certification.toLowerCase()}>
                      {certification}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Not set</p>
              )}
            </div>
          </div>
        </div>
      ) : facts ? (
        <div className="wine-facts__empty">
          <p>No additional facts recorded yet.</p>
          <small>
            Add only what you know; missing values stay unknown rather
            than being guessed.
          </small>
        </div>
      ) : null}
    </section>
  )
}
