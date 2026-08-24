import { type FormEvent, useEffect, useState } from "react"

import {
  LOCATION_STORAGE_PURPOSES,
  getLocationStoragePurposeLabel,
} from "../data/cellarSetupView"
import type { LocationStoragePurpose } from "../data/cellarSetup"
import {
  clearWineMaturityOverride,
  getWineMaturity,
  maturityAssessmentReasonMessage,
  reviewWineMaturity,
  setWineMaturityOverride,
  type MaturityVerdict,
  type WineMaturity,
} from "../data/wineMaturity"
import { Notice } from "./Notice"

interface WineMaturityPanelProps {
  isOnline: boolean
  wineId: string
}

function storagePurposeLabel(value: string): string {
  switch (value) {
    case "split-service-and-aging":
      return "Service + aging"
    case "service-priority":
      return "Service (priority)"
    case "aging":
    case "service":
    case "overflow":
    case "mixed":
      return getLocationStoragePurposeLabel(value)
    default:
      return value.replaceAll("-", " ")
  }
}

function feedbackLabel(verdict: MaturityVerdict): string {
  switch (verdict) {
    case "useful":
      return "Useful"
    case "questionable":
      return "Questionable"
    default:
      return "Wrong"
  }
}

function maturityLayerLabel(layer: string): string {
  switch (layer) {
    case "region":
      return "Regional baseline"
    case "appellation":
      return "Appellation"
    case "climat":
      return "Climat"
    case "vintage":
      return "Vintage"
    case "producer-era":
      return "Producer style"
    case "interaction":
      return "Producer × vintage"
    case "cuvee":
      return "Cuvée"
    case "release":
      return "Exact vintage"
    default:
      return layer.replaceAll("-", " ")
  }
}

function yearInput(form: HTMLFormElement, name: string): number {
  const value = Number(new FormData(form).get(name))

  if (!Number.isInteger(value) || value < 1800 || value > 2300) {
    throw new Error("Enter a valid year between 1800 and 2300")
  }

  return value
}

export function WineMaturityPanel({
  isOnline,
  wineId,
}: WineMaturityPanelProps) {
  const [result, setResult] = useState<WineMaturity | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setResult(null)
    setError(null)
    setMessage(null)

    if (!isOnline) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)

    void getWineMaturity(wineId)
      .then((nextResult) => {
        if (!cancelled) {
          setResult(nextResult)
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load maturity advice",
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
  }, [isOnline, wineId])

  async function saveFeedback(verdict: MaturityVerdict) {
    const projectionId = result?.projection?.id
    if (!projectionId || !isOnline) {
      return
    }

    setBusyAction(`feedback:${verdict}`)
    setError(null)
    setMessage(null)

    try {
      setResult(
        await reviewWineMaturity(projectionId, verdict, ""),
      )
      setMessage("Your review was saved for this model result.")
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save your review",
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function saveOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline) {
      return
    }

    const form = event.currentTarget
    const data = new FormData(form)
    const rawPurpose = String(data.get("storagePurpose") ?? "")
    const purpose = rawPurpose
      ? (rawPurpose as LocationStoragePurpose)
      : null

    setBusyAction("override")
    setError(null)
    setMessage(null)

    try {
      setResult(
        await setWineMaturityOverride(
          wineId,
          {
            bestEndYear: yearInput(form, "bestEndYear"),
            bestStartYear: yearInput(form, "bestStartYear"),
            drinkByYear: yearInput(form, "drinkByYear"),
            firstTrialYear: yearInput(form, "firstTrialYear"),
          },
          purpose,
          String(data.get("note") ?? ""),
        ),
      )
      setMessage("Your maturity window now takes priority over the model.")
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save the maturity window",
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function clearOverride() {
    if (!isOnline) {
      return
    }

    setBusyAction("clear-override")
    setError(null)
    setMessage(null)

    try {
      setResult(await clearWineMaturityOverride(wineId))
      setMessage("The model result is active again.")
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to clear the maturity window",
      )
    } finally {
      setBusyAction(null)
    }
  }

  const projection = result?.projection ?? null
  const model = projection?.maturity ?? null
  const override = result?.override ?? null
  const displayedYears = override ?? model

  return (
    <section
      aria-labelledby="wine-maturity-heading"
      className="wine-maturity"
    >
      <div className="wine-detail-section-heading">
        <div>
          <h2 id="wine-maturity-heading">When to drink</h2>
          <p>
            A conservative estimate from reviewed place and vintage profiles,
            kept separate from your own adjustments.
          </p>
        </div>
      </div>

      {!isOnline ? (
        <Notice tone="warning">
          Maturity advice requires a connection. Your wine and inventory remain
          available offline.
        </Notice>
      ) : null}

      {isLoading ? <Notice role="status">Loading maturity advice…</Notice> : null}

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

      {!isLoading && isOnline && result && projection === null ? (
        <Notice tone={result.demandStatus === "needs-review" ? "warning" : undefined}>
          {result.demandStatus === "needs-review"
            ? result.assessmentReason
              ? maturityAssessmentReasonMessage(result.assessmentReason)
              : "Not assessed: no reviewed profile safely matches this wine yet. No range has been guessed."
            : "Assessment is being prepared. Check again shortly."}
        </Notice>
      ) : null}

      {projection && model && displayedYears ? (
        <>
          <div className={`wine-maturity__summary wine-maturity__summary--${model.state}`}>
            <div>
              <span className="wine-maturity__badge">
                {override ? "Owner-adjusted" : model.stateLabel}
              </span>
              <h3>{override ? "Your maturity window" : model.headline}</h3>
              <p>{override?.note ?? model.message}</p>
            </div>
            <span className="wine-maturity__confidence">
              {override
                ? "Owner estimate"
                : `${model.confidenceLabel[0]?.toUpperCase()}${model.confidenceLabel.slice(1)} confidence`}
            </span>
          </div>

          <dl className="wine-maturity__window">
            <div>
              <dt>First assessment</dt>
              <dd>{displayedYears.firstTrialYear}</dd>
            </div>
            <div>
              <dt>Likely best period</dt>
              <dd>
                {displayedYears.bestStartYear}–{displayedYears.bestEndYear}
              </dd>
            </div>
            <div>
              <dt>Preferably drink by</dt>
              <dd>{displayedYears.drinkByYear}</dd>
            </div>
          </dl>

          {projection.storage ? (
            <div className="wine-maturity__storage">
              <div>
                <span>Suggested placement</span>
                <strong>
                  {override?.storagePurpose
                    ? getLocationStoragePurposeLabel(override.storagePurpose)
                    : storagePurposeLabel(projection.storage.purpose)}
                </strong>
              </div>
              <p>
                {override?.storagePurpose
                  ? "Your location preference overrides the model purpose."
                  : projection.storage.message}
              </p>
              {projection.storage.move.needed && !override?.storagePurpose ? (
                <span
                  className={`wine-maturity__move wine-maturity__move--${projection.storage.move.possible ? "possible" : "blocked"}`}
                >
                  {projection.storage.move.message}
                </span>
              ) : null}
            </div>
          ) : null}

          <details className="wine-maturity__explanation">
            <summary>Why this estimate?</summary>
            <p>
              Model specificity: {projection.specificity.replaceAll("-", " ")}.
              Calculated {new Date(projection.calculatedAt).toLocaleDateString()}.
            </p>
            {model.contributions.length > 0 ? (
              <ol className="wine-maturity__contributions">
                {model.contributions.map((contribution, index) => (
                  <li key={`${contribution.layer}:${contribution.label}:${index}`}>
                    <strong>
                      {maturityLayerLabel(contribution.layer)}: {contribution.label}
                    </strong>
                    <span>{contribution.rationale}</span>
                  </li>
                ))}
              </ol>
            ) : model.reasons.length > 0 ? (
              <ul>
                {model.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {model.warnings.length > 0 ? (
              <>
                <strong>Limits</strong>
                <ul>
                  {model.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </details>

          <div className="wine-maturity__feedback">
            <span>Is this model result credible?</span>
            <div>
              {(["useful", "questionable", "wrong"] as const).map(
                (verdict) => (
                  <button
                    aria-pressed={result?.feedback?.verdict === verdict}
                    disabled={!isOnline || busyAction !== null}
                    key={verdict}
                    onClick={() => void saveFeedback(verdict)}
                    type="button"
                  >
                    {busyAction === `feedback:${verdict}`
                      ? "Saving…"
                      : feedbackLabel(verdict)}
                  </button>
                ),
              )}
            </div>
          </div>

          <details className="wine-maturity__override">
            <summary>{override ? "Edit your window" : "Adjust this window"}</summary>
            <p>
              Your values take priority in the app; the original model and its
              evidence remain unchanged.
            </p>
            <form
              key={override?.updatedAt ?? projection.calculatedAt}
              onSubmit={(event) => void saveOverride(event)}
            >
              <label>
                First assessment
                <input
                  defaultValue={displayedYears.firstTrialYear}
                  min="1800"
                  name="firstTrialYear"
                  required
                  type="number"
                />
              </label>
              <label>
                Best from
                <input
                  defaultValue={displayedYears.bestStartYear}
                  min="1800"
                  name="bestStartYear"
                  required
                  type="number"
                />
              </label>
              <label>
                Best until
                <input
                  defaultValue={displayedYears.bestEndYear}
                  min="1800"
                  name="bestEndYear"
                  required
                  type="number"
                />
              </label>
              <label>
                Drink by
                <input
                  defaultValue={displayedYears.drinkByYear}
                  min="1800"
                  name="drinkByYear"
                  required
                  type="number"
                />
              </label>
              <label>
                Preferred storage (optional)
                <select
                  defaultValue={override?.storagePurpose ?? ""}
                  name="storagePurpose"
                >
                  <option value="">Use model suggestion</option>
                  {LOCATION_STORAGE_PURPOSES.map((purpose) => (
                    <option key={purpose.value} value={purpose.value}>
                      {purpose.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wine-maturity__override-note">
                Note (optional)
                <input
                  defaultValue={override?.note ?? ""}
                  name="note"
                  placeholder="For example: producer advice"
                />
              </label>
              <div>
                <button disabled={!isOnline || busyAction !== null} type="submit">
                  {busyAction === "override" ? "Saving…" : "Save my window"}
                </button>
                {override ? (
                  <button
                    disabled={!isOnline || busyAction !== null}
                    onClick={() => void clearOverride()}
                    type="button"
                  >
                    {busyAction === "clear-override"
                      ? "Clearing…"
                      : "Use model again"}
                  </button>
                ) : null}
              </div>
            </form>
          </details>
        </>
      ) : null}
    </section>
  )
}
