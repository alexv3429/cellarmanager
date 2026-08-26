import { type FormEvent, useEffect, useState } from "react"

import {
  clearWineServingOverride,
  deleteWineObservation,
  getWinePersonalGuidance,
  saveWineObservation,
  saveWineServingOverride,
  type WineObservation,
  type WineObservationMaturity,
  type WineObservationPairingVerdict,
  type WineObservationType,
  type WineObservationVisibility,
  type WinePersonalGuidance,
  type WineServingMethod,
} from "../data/winePersonalGuidance"
import { Notice } from "./Notice"

interface WinePersonalGuidancePanelProps {
  isOnline: boolean
  wineId: string
}

const OBSERVATION_TYPES: Array<{
  label: string
  value: WineObservationType
}> = [
  { label: "Tasting note", value: "tasting" },
  { label: "Producer guidance", value: "producer-guidance" },
  { label: "Maturity observation", value: "maturity" },
  { label: "Food pairing", value: "pairing" },
  { label: "Storage note", value: "storage" },
  { label: "Other", value: "other" },
]

const MATURITY_OPTIONS: Array<{
  label: string
  value: WineObservationMaturity
}> = [
  { label: "Too young / closed", value: "too-young" },
  { label: "Youthful but approachable", value: "youthful" },
  { label: "Ready", value: "ready" },
  { label: "Declining", value: "declining" },
  { label: "Past its best", value: "past" },
]

const PAIRING_OPTIONS: Array<{
  label: string
  value: WineObservationPairingVerdict
}> = [
  { label: "Excellent", value: "excellent" },
  { label: "Good", value: "good" },
  { label: "Neutral", value: "neutral" },
  { label: "Poor", value: "poor" },
]

const SERVING_METHODS: Array<{
  label: string
  value: WineServingMethod
}> = [
  { label: "Serve directly", value: "none" },
  { label: "Open ahead", value: "open-ahead" },
  { label: "Decant", value: "decant" },
  { label: "Gentle decant for sediment", value: "gentle-decant" },
]

function localToday(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function observationTypeLabel(value: WineObservationType): string {
  return (
    OBSERVATION_TYPES.find((option) => option.value === value)?.label ?? value
  )
}

function maturityLabel(value: WineObservationMaturity): string {
  return MATURITY_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function pairingLabel(value: WineObservationPairingVerdict): string {
  return PAIRING_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function servingMethodLabel(value: WineServingMethod): string {
  return SERVING_METHODS.find((option) => option.value === value)?.label ?? value
}

function optionalRating(form: FormData, name: string): number | null {
  const raw = String(form.get(name) ?? "")
  if (raw.length === 0) {
    return null
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("Structure ratings must be between 1 and 5")
  }
  return value
}

function requiredNumber(form: FormData, name: string): number {
  const value = Number(form.get(name))
  if (!Number.isFinite(value)) {
    throw new Error("Enter valid serving values")
  }
  return value
}

function ratingSummary(observation: WineObservation): string[] {
  return [
    ["Body", observation.ratings.body],
    ["Acidity", observation.ratings.acidity],
    ["Tannin", observation.ratings.tannin],
    ["Freshness", observation.ratings.freshness],
  ]
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .map(([label, value]) => `${label} ${value}/5`)
}

export function WinePersonalGuidancePanel({
  isOnline,
  wineId,
}: WinePersonalGuidancePanelProps) {
  const [result, setResult] = useState<WinePersonalGuidance | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editingObservation, setEditingObservation] =
    useState<WineObservation | null>(null)
  const [isAddingObservation, setIsAddingObservation] = useState(false)
  const [observationType, setObservationType] =
    useState<WineObservationType>("tasting")

  useEffect(() => {
    setResult(null)
    setError(null)
    setMessage(null)
    setEditingObservation(null)
    setIsAddingObservation(false)

    if (!isOnline) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    void getWinePersonalGuidance(wineId)
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
              : "Unable to load notes and serving guidance",
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

  function beginObservation(observation: WineObservation | null) {
    setError(null)
    setMessage(null)
    setEditingObservation(observation)
    setObservationType(observation?.type ?? "tasting")
    setIsAddingObservation(observation === null)
  }

  function closeObservationForm() {
    setEditingObservation(null)
    setIsAddingObservation(false)
  }

  async function submitObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline) {
      return
    }

    const form = new FormData(event.currentTarget)
    const isPairing = observationType === "pairing"
    const maturityValue = String(form.get("maturityAssessment") ?? "")
    setBusyAction("observation")
    setError(null)
    setMessage(null)

    try {
      setResult(
        await saveWineObservation({
          maturityAssessment: maturityValue
            ? (maturityValue as WineObservationMaturity)
            : null,
          note: String(form.get("note") ?? ""),
          observationId: editingObservation?.id,
          observedOn: String(form.get("observedOn") ?? ""),
          pairingDish: isPairing
            ? String(form.get("pairingDish") ?? "")
            : null,
          pairingVerdict: isPairing
            ? (String(
                form.get("pairingVerdict") ?? "",
              ) as WineObservationPairingVerdict)
            : null,
          ratings: {
            acidity: optionalRating(form, "acidityRating"),
            body: optionalRating(form, "bodyRating"),
            freshness: optionalRating(form, "freshnessRating"),
            tannin: optionalRating(form, "tanninRating"),
          },
          type: observationType,
          visibility: String(
            form.get("visibility") ?? "household",
          ) as WineObservationVisibility,
          wineId,
        }),
      )
      closeObservationForm()
      setMessage(
        editingObservation
          ? "Observation updated."
          : "Observation added to this wine.",
      )
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save the observation",
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function removeObservation(observation: WineObservation) {
    if (
      !isOnline ||
      !window.confirm("Delete this observation? This cannot be undone.")
    ) {
      return
    }

    setBusyAction(`delete:${observation.id}`)
    setError(null)
    setMessage(null)
    try {
      setResult(await deleteWineObservation(observation.id))
      closeObservationForm()
      setMessage("Observation deleted.")
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to delete the observation",
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function submitServingOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline) {
      return
    }

    const form = new FormData(event.currentTarget)
    setBusyAction("serving")
    setError(null)
    setMessage(null)
    try {
      setResult(
        await saveWineServingOverride({
          aerationMaxMinutes: requiredNumber(form, "aerationMaxMinutes"),
          aerationMinMinutes: requiredNumber(form, "aerationMinMinutes"),
          method: String(form.get("method")) as WineServingMethod,
          note: String(form.get("note") ?? ""),
          temperatureMaxC: requiredNumber(form, "temperatureMaxC"),
          temperatureMinC: requiredNumber(form, "temperatureMinC"),
          wineId,
        }),
      )
      setMessage("Your serving guidance now takes priority over the estimate.")
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save serving guidance",
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function clearServingOverride() {
    if (!isOnline) {
      return
    }
    setBusyAction("clear-serving")
    setError(null)
    setMessage(null)
    try {
      setResult(await clearWineServingOverride(wineId))
      setMessage("The reviewed serving estimate is active again.")
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to clear serving guidance",
      )
    } finally {
      setBusyAction(null)
    }
  }

  const model = result?.serving.model ?? null
  const override = result?.serving.override ?? null
  const serving = override ?? model
  const observationFormOpen = isAddingObservation || editingObservation !== null

  return (
    <section
      aria-labelledby="wine-personal-guidance-heading"
      className="wine-personal-guidance"
    >
      <div className="wine-detail-section-heading">
        <div>
          <h2 id="wine-personal-guidance-heading">Notes and serving</h2>
          <p>
            Your observations stay in this household. They never silently
            change the reviewed shared profile.
          </p>
        </div>
      </div>

      {!isOnline ? (
        <Notice tone="warning">
          Notes and serving guidance require a connection. Wine and inventory
          remain available offline.
        </Notice>
      ) : null}
      {isLoading ? <Notice role="status">Loading your notes…</Notice> : null}
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

      {result ? (
        <>
          <div className="wine-serving">
            <div className="wine-serving__heading">
              <div>
                <span className="wine-personal-guidance__eyebrow">Serving</span>
                <h3>
                  {override ? "Your serving guidance" : "Serving estimate"}
                </h3>
              </div>
              {serving ? (
                <span className="wine-serving__source">
                  {override
                    ? "Owner-adjusted"
                    : `${model?.confidenceLabel ?? "Unknown"} confidence`}
                </span>
              ) : null}
            </div>

            {serving ? (
              <>
                <dl className="wine-serving__summary">
                  <div>
                    <dt>Temperature</dt>
                    <dd>
                      {serving.temperatureMinC}–{serving.temperatureMaxC} °C
                    </dd>
                  </div>
                  <div>
                    <dt>Aeration</dt>
                    <dd>
                      {serving.aerationMinMinutes === 0 &&
                      serving.aerationMaxMinutes === 0
                        ? "None"
                        : `${serving.aerationMinMinutes}–${serving.aerationMaxMinutes} min`}
                    </dd>
                  </div>
                  <div>
                    <dt>Handling</dt>
                    <dd>{servingMethodLabel(serving.method)}</dd>
                  </div>
                </dl>

                {override?.note ? <p>{override.note}</p> : null}
                {!override && model ? (
                  <details className="wine-serving__explanation">
                    <summary>Why this serving estimate?</summary>
                    <ul>
                      {model.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    {model.warnings.length > 0 ? (
                      <>
                        <strong>Keep in mind</strong>
                        <ul>
                          {model.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </details>
                ) : null}
              </>
            ) : (
              <Notice
                tone={
                  result.serving.demandStatus === "needs-review"
                    ? "warning"
                    : undefined
                }
              >
                {result.serving.demandStatus === "needs-review"
                  ? "No reviewed structural profile can support serving advice yet. You can still enter your own guidance."
                  : "Serving guidance is being prepared."}
              </Notice>
            )}

            <details className="wine-serving__override" key={override?.updatedAt ?? "model"}>
              <summary>
                {override ? "Edit your serving guidance" : "Adjust serving guidance"}
              </summary>
              <p>
                Your values take priority for this household; the reviewed
                estimate remains unchanged.
              </p>
              <form onSubmit={(event) => void submitServingOverride(event)}>
                <label>
                  Minimum temperature (°C)
                  <input
                    defaultValue={serving?.temperatureMinC ?? 12}
                    max="30"
                    min="0"
                    name="temperatureMinC"
                    required
                    step="0.5"
                    type="number"
                  />
                </label>
                <label>
                  Maximum temperature (°C)
                  <input
                    defaultValue={serving?.temperatureMaxC ?? 16}
                    max="30"
                    min="0"
                    name="temperatureMaxC"
                    required
                    step="0.5"
                    type="number"
                  />
                </label>
                <label>
                  Minimum aeration (minutes)
                  <input
                    defaultValue={serving?.aerationMinMinutes ?? 0}
                    max="360"
                    min="0"
                    name="aerationMinMinutes"
                    required
                    step="5"
                    type="number"
                  />
                </label>
                <label>
                  Maximum aeration (minutes)
                  <input
                    defaultValue={serving?.aerationMaxMinutes ?? 15}
                    max="360"
                    min="0"
                    name="aerationMaxMinutes"
                    required
                    step="5"
                    type="number"
                  />
                </label>
                <label>
                  Handling
                  <select defaultValue={serving?.method ?? "none"} name="method">
                    {SERVING_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wine-serving__override-note">
                  Note (optional)
                  <textarea
                    defaultValue={override?.note ?? ""}
                    maxLength={2000}
                    name="note"
                    placeholder="For example: producer recommended one hour in a carafe"
                    rows={3}
                  />
                </label>
                <div>
                  <button disabled={busyAction !== null} type="submit">
                    {busyAction === "serving" ? "Saving…" : "Save my guidance"}
                  </button>
                  {override ? (
                    <button
                      disabled={busyAction !== null}
                      onClick={() => void clearServingOverride()}
                      type="button"
                    >
                      {busyAction === "clear-serving"
                        ? "Clearing…"
                        : "Use estimate again"}
                    </button>
                  ) : null}
                </div>
              </form>
            </details>
          </div>

          <div className="wine-observations">
            <div className="wine-observations__heading">
              <div>
                <span className="wine-personal-guidance__eyebrow">
                  Experience
                </span>
                <h3>Your observations</h3>
              </div>
              {!observationFormOpen ? (
                <button onClick={() => beginObservation(null)} type="button">
                  Add observation
                </button>
              ) : null}
            </div>

            {observationFormOpen ? (
              <form
                className="wine-observation-form"
                key={editingObservation?.id ?? "new-observation"}
                onSubmit={(event) => void submitObservation(event)}
              >
                <div className="wine-observation-form__heading">
                  <strong>
                    {editingObservation ? "Edit observation" : "New observation"}
                  </strong>
                  <span>
                    Keep source facts and your own impression explicit.
                  </span>
                </div>
                <label>
                  Type
                  <select
                    name="observationType"
                    onChange={(event) =>
                      setObservationType(event.target.value as WineObservationType)
                    }
                    value={observationType}
                  >
                    {OBSERVATION_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date
                  <input
                    defaultValue={editingObservation?.observedOn ?? localToday()}
                    name="observedOn"
                    required
                    type="date"
                  />
                </label>
                <label>
                  Visibility
                  <select
                    defaultValue={editingObservation?.visibility ?? "household"}
                    name="visibility"
                  >
                    <option value="household">Shared with household</option>
                    <option value="personal">Only me</option>
                  </select>
                </label>

                {observationType === "tasting" ||
                observationType === "maturity" ||
                observationType === "producer-guidance" ? (
                  <label>
                    Maturity impression (optional)
                    <select
                      defaultValue={editingObservation?.maturityAssessment ?? ""}
                      name="maturityAssessment"
                    >
                      <option value="">Not assessed</option>
                      {MATURITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {observationType === "pairing" ? (
                  <>
                    <label>
                      Dish
                      <input
                        defaultValue={editingObservation?.pairingDish ?? ""}
                        maxLength={200}
                        name="pairingDish"
                        required
                      />
                    </label>
                    <label>
                      Result
                      <select
                        defaultValue={editingObservation?.pairingVerdict ?? "good"}
                        name="pairingVerdict"
                      >
                        {PAIRING_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}

                {observationType === "tasting" ? (
                  <fieldset className="wine-observation-form__ratings">
                    <legend>Structure ratings (optional)</legend>
                    {(
                      [
                        ["Body", "bodyRating", editingObservation?.ratings.body],
                        [
                          "Acidity",
                          "acidityRating",
                          editingObservation?.ratings.acidity,
                        ],
                        [
                          "Tannin",
                          "tanninRating",
                          editingObservation?.ratings.tannin,
                        ],
                        [
                          "Freshness",
                          "freshnessRating",
                          editingObservation?.ratings.freshness,
                        ],
                      ] as const
                    ).map(([label, name, value]) => (
                      <label key={name}>
                        {label}
                        <select defaultValue={value ?? ""} name={name}>
                          <option value="">Not rated</option>
                          {[1, 2, 3, 4, 5].map((rating) => (
                            <option key={rating} value={rating}>
                              {rating} / 5
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </fieldset>
                ) : null}

                <label className="wine-observation-form__note">
                  Note
                  <textarea
                    defaultValue={editingObservation?.note ?? ""}
                    maxLength={5000}
                    name="note"
                    placeholder={
                      observationType === "producer-guidance"
                        ? "What did the producer say, and for which vintage or period?"
                        : "What did you observe?"
                    }
                    required
                    rows={4}
                  />
                </label>

                <div className="wine-observation-form__actions">
                  <button disabled={busyAction !== null} type="submit">
                    {busyAction === "observation"
                      ? "Saving…"
                      : editingObservation
                        ? "Save changes"
                        : "Add observation"}
                  </button>
                  <button
                    disabled={busyAction !== null}
                    onClick={closeObservationForm}
                    type="button"
                  >
                    Cancel
                  </button>
                  {editingObservation ? (
                    <button
                      className="wine-observation-form__delete"
                      disabled={busyAction !== null}
                      onClick={() => void removeObservation(editingObservation)}
                      type="button"
                    >
                      {busyAction === `delete:${editingObservation.id}`
                        ? "Deleting…"
                        : "Delete observation"}
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}

            {result.observations.length > 0 ? (
              <ol className="wine-observations__list">
                {result.observations.map((observation) => {
                  const ratings = ratingSummary(observation)
                  return (
                    <li key={observation.id}>
                      <header>
                        <div>
                          <strong>{observationTypeLabel(observation.type)}</strong>
                          <span>
                            {new Date(`${observation.observedOn}T12:00:00`).toLocaleDateString()}
                            {` · ${
                              observation.visibility === "personal"
                                ? "Only me"
                                : "Household"
                            }`}
                          </span>
                        </div>
                        {observation.isAuthor && !observationFormOpen ? (
                          <button
                            onClick={() => beginObservation(observation)}
                            type="button"
                          >
                            Edit
                          </button>
                        ) : null}
                      </header>
                      {observation.note ? <p>{observation.note}</p> : null}
                      <div className="wine-observations__facts">
                        {observation.maturityAssessment ? (
                          <span>
                            Maturity: {maturityLabel(observation.maturityAssessment)}
                          </span>
                        ) : null}
                        {observation.pairingDish && observation.pairingVerdict ? (
                          <span>
                            Pairing: {observation.pairingDish} —{" "}
                            {pairingLabel(observation.pairingVerdict)}
                          </span>
                        ) : null}
                        {ratings.map((rating) => (
                          <span key={rating}>{rating}</span>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : !observationFormOpen ? (
              <p className="wine-observations__empty">
                No observations yet. Add a tasting note or record producer
                guidance when you learn something useful about this wine.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
