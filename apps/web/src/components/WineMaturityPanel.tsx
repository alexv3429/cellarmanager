import { type FormEvent, useEffect, useState } from "react"

import {
  LOCATION_STORAGE_PURPOSES,
  getLocationStoragePurposeLabel,
} from "../data/cellarSetupView"
import type { LocationStoragePurpose } from "../data/cellarSetup"
import {
  clearMemberMaturityCalibration,
  clearWineMaturityOverride,
  getWineMaturity,
  maturityCalibrationLabel,
  maturityAssessmentReasonMessage,
  reviewWineMaturity,
  setMemberMaturityCalibration,
  setWineMaturityOverride,
  type MaturityRecommendation,
  type MaturityVerdict,
  type WineMaturity,
} from "../data/wineMaturity"
import {
  getProfileReviewInbox,
  getWineProfileReviewTargets,
  requestProfileReview,
  type ProfileReviewCategory,
  type ProfileReviewInbox as ReviewInbox,
  type ProfileReviewTarget,
} from "../data/profileReviews"
import { Notice } from "./Notice"
import { useLanguage } from "../i18n/useLanguage"

interface WineMaturityPanelProps {
  canManageCellar?: boolean
  householdId: string
  isOnline: boolean
  wineId: string
}

interface IssueReviewTarget {
  label: string
  profileId: string
}

const MATURITY_CALIBRATION_OPTIONS = [-3, -2, -1, 0, 1, 2, 3] as const

function MaturityComparisonColumn({
  label,
  recommendation,
}: {
  label: string
  recommendation: MaturityRecommendation
}) {
  const { t } = useLanguage()
  return (
    <section>
      <strong>{label}</strong>
      <dl>
        <div>
          <dt>{t("First assessment")}</dt>
          <dd>{recommendation.firstTrialYear}</dd>
        </div>
        <div>
          <dt>{t("Best period")}</dt>
          <dd>
            {recommendation.bestStartYear}–{recommendation.bestEndYear}
          </dd>
        </div>
        <div>
          <dt>{t("Drink by")}</dt>
          <dd>{recommendation.drinkByYear}</dd>
        </div>
      </dl>
    </section>
  )
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

function profileTypeLabel(profileType: string): string {
  switch (profileType) {
    case "place":
      return "Place baseline"
    case "place-adjustment":
      return "Place refinement"
    case "vintage":
      return "Vintage"
    case "producer-era":
      return "Producer style"
    case "producer-vintage-interaction":
      return "Producer × vintage"
    case "cuvee":
      return "Cuvée"
    case "release":
      return "Exact vintage"
    default:
      return profileType.replaceAll("-", " ")
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
  canManageCellar = false,
  householdId,
  isOnline,
  wineId,
}: WineMaturityPanelProps) {
  const { language, t } = useLanguage()
  const [result, setResult] = useState<WineMaturity | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [profileReviewInbox, setProfileReviewInbox] =
    useState<ReviewInbox | null>(null)
  const [profileReviewTargets, setProfileReviewTargets] = useState<
    ProfileReviewTarget[]
  >([])
  const [reviewTarget, setReviewTarget] = useState<IssueReviewTarget | null>(null)

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

  useEffect(() => {
    setProfileReviewInbox(null)
    setProfileReviewTargets([])
    setReviewTarget(null)
    if (!isOnline) return

    let cancelled = false
    void Promise.all([
      getProfileReviewInbox(householdId),
      getWineProfileReviewTargets(wineId),
    ])
      .then(([inbox, targets]) => {
        if (!cancelled) {
          setProfileReviewInbox(inbox)
          setProfileReviewTargets(targets)
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load profile review requests",
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [householdId, isOnline, wineId])

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
      setMessage(t("Your review was saved for this model result."))
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
    if (!canManageCellar) return
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
      setMessage(t("Your maturity window now takes priority over the model."))
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
    if (!canManageCellar) return
    if (!isOnline) {
      return
    }

    setBusyAction("clear-override")
    setError(null)
    setMessage(null)

    try {
      setResult(await clearWineMaturityOverride(wineId))
      setMessage(t("The model result is active again."))
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

  async function saveCalibration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline) {
      return
    }

    const yearShift = Number(
      new FormData(event.currentTarget).get("yearShift"),
    )
    setBusyAction("calibration")
    setError(null)
    setMessage(null)

    try {
      await setMemberMaturityCalibration(yearShift)
      setResult(await getWineMaturity(wineId))
      setMessage(t(
        yearShift === 0
          ? "Your recommendations now use canonical timing."
          : `Your private ${maturityCalibrationLabel(
              yearShift,
            ).toLowerCase()} preference now applies to every assessed wine.`,
      ))
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save your timing preference",
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function clearCalibration() {
    if (!isOnline) {
      return
    }

    setBusyAction("clear-calibration")
    setError(null)
    setMessage(null)

    try {
      await clearMemberMaturityCalibration()
      setResult(await getWineMaturity(wineId))
      setMessage(t("Your recommendations now use canonical timing."))
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to reset your timing preference",
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function submitProfileReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline || !reviewTarget?.profileId) return

    const data = new FormData(event.currentTarget)
    setBusyAction(`review:${reviewTarget.profileId}`)
    setError(null)
    setMessage(null)

    try {
      setProfileReviewInbox(
        await requestProfileReview(
          householdId,
          wineId,
          reviewTarget.profileId,
          String(data.get("category")) as ProfileReviewCategory,
          String(data.get("comment") ?? ""),
          String(data.get("evidenceUrl") ?? ""),
        ),
      )
      setReviewTarget(null)
      setMessage(
        t("Your report was submitted. The published guidance remains unchanged while it is reviewed."),
      )
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to submit this profile review",
      )
    } finally {
      setBusyAction(null)
    }
  }

  const projection = result?.projection ?? null
  const model = projection?.maturity ?? null
  const calibration = result?.calibration ?? null
  const personalizedModel = calibration?.maturity ?? null
  const activePersonalizedModel =
    calibration?.active && personalizedModel ? personalizedModel : null
  const override = result?.override ?? null
  const displayedRecommendation = activePersonalizedModel ?? model
  const displayedYears = override ?? displayedRecommendation
  const inlineProfileIds = new Set(
    model?.contributions.flatMap((contribution) =>
      contribution.profileId ? [contribution.profileId] : [],
    ) ?? [],
  )
  const supplementalReviewTargets = profileReviewTargets.filter(
    (target) => !inlineProfileIds.has(target.profileId),
  )

  function profileReviewAction(profileId: string, label: string) {
    const existingReview = profileReviewInbox?.items.find(
      (item) =>
        item.profileId === profileId &&
        item.wineId === wineId &&
        (item.status === "open" || item.status === "reviewing"),
    )

    return existingReview ? (
      <span className="wine-maturity__review-status">
        {existingReview.status === "reviewing"
          ? t("Review in progress")
          : t("Review submitted")}
      </span>
    ) : (
      <button
        disabled={!isOnline || busyAction !== null}
        onClick={() => setReviewTarget({ label, profileId })}
        type="button"
      >{t("Report an issue")}</button>
    )
  }

  return (
    <section
      aria-labelledby="wine-maturity-heading"
      className="wine-maturity"
    >
      <div className="wine-detail-section-heading">
        <div>
          <h2 id="wine-maturity-heading">{t("When to drink")}</h2>
          <p>{t("Canonical guidance from reviewed profiles, with private preferences and manual windows kept visibly separate.")}</p>
        </div>
      </div>

      {!isOnline ? (
        <Notice tone="warning">{t("Maturity advice requires a connection. Your wine and inventory remain available offline.")}</Notice>
      ) : null}

      {isLoading ? <Notice role="status">{t("Loading maturity advice…")}</Notice> : null}

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
              ? t(maturityAssessmentReasonMessage(result.assessmentReason))
              : t("Not assessed: no reviewed profile safely matches this wine yet. No range has been guessed.")
            : t("Assessment is being prepared. Check again shortly.")}
        </Notice>
      ) : null}

      {projection && model && displayedYears ? (
        <>
          <div className={`wine-maturity__summary wine-maturity__summary--${displayedRecommendation?.state ?? model.state}`}>
            <div>
              <span className="wine-maturity__badge">
                {override
                  ? t("Manual window")
                  : activePersonalizedModel
                    ? t("Personal timing")
                    : t(model.stateLabel)}
              </span>
              <h3>
                {override
                  ? t("Your maturity window")
                  : t(displayedRecommendation?.headline ?? model.headline)}
              </h3>
              <p>
                {override?.note ?? t(
                  displayedRecommendation?.message ?? model.message,
                )}
              </p>
            </div>
            <span className="wine-maturity__confidence">
              {override
                ? t("Owner estimate")
                : t(`${model.confidenceLabel[0]?.toUpperCase()}${model.confidenceLabel.slice(1)} canonical confidence`)}
            </span>
          </div>

          <dl className="wine-maturity__window">
            <div>
              <dt>{t("First assessment")}</dt>
              <dd>{displayedYears.firstTrialYear}</dd>
            </div>
            <div>
              <dt>{t("Likely best period")}</dt>
              <dd>
                {displayedYears.bestStartYear}–{displayedYears.bestEndYear}
              </dd>
            </div>
            <div>
              <dt>{t("Preferably drink by")}</dt>
              <dd>{displayedYears.drinkByYear}</dd>
            </div>
          </dl>

          <section
            aria-labelledby="maturity-calibration-heading"
            className="wine-maturity__calibration"
          >
            <header>
              <div>
                <h3 id="maturity-calibration-heading">{t("Your timing preference")}</h3>
                <p>{t("Shift every canonical drinking window for your account only. Shared profiles and other members remain unchanged.")}</p>
              </div>
              <span className="wine-maturity__confidence">
                {t(maturityCalibrationLabel(calibration?.yearShift ?? 0))}
              </span>
            </header>

            {calibration && personalizedModel ? (
              <div className="wine-maturity__calibration-comparison">
                <MaturityComparisonColumn
                  label={t("Canonical guidance")}
                  recommendation={model}
                />
                <MaturityComparisonColumn
                  label={`${t("Your private view")} · ${t(maturityCalibrationLabel(
                    calibration.yearShift,
                  ))}`}
                  recommendation={personalizedModel}
                />
              </div>
            ) : null}

            {calibration && override ? (
              <Notice tone="warning">{t("This preference still applies to your other wines, but this wine's manual window takes priority.")}</Notice>
            ) : null}

            <form
              key={calibration?.updatedAt ?? "canonical"}
              onSubmit={(event) => void saveCalibration(event)}
            >
              <label>{t("I generally prefer wines")}<select
                  defaultValue={calibration?.yearShift ?? 0}
                  disabled={!isOnline || busyAction !== null}
                  name="yearShift"
                >
                  {MATURITY_CALIBRATION_OPTIONS.map((yearShift) => (
                    <option key={yearShift} value={yearShift}>
                      {yearShift === 0
                        ? t("At canonical timing")
                        : t(maturityCalibrationLabel(yearShift))}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button
                  disabled={!isOnline || busyAction !== null}
                  type="submit"
                >
                  {busyAction === "calibration"
                    ? t("Saving…")
                    : t("Save preference")}
                </button>
                {calibration ? (
                  <button
                    disabled={!isOnline || busyAction !== null}
                    onClick={() => void clearCalibration()}
                    type="button"
                  >
                    {busyAction === "clear-calibration"
                      ? t("Resetting…")
                      : t("Reset to canonical")}
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          {projection.storage ? (
            <div className="wine-maturity__storage">
              <div>
                <span>{t("Suggested placement")}</span>
                <strong>
                  {override?.storagePurpose
                    ? t(getLocationStoragePurposeLabel(override.storagePurpose))
                    : t(storagePurposeLabel(projection.storage.purpose))}
                </strong>
              </div>
              <p>
                {override?.storagePurpose
                  ? t("Your location preference overrides the model purpose.")
                  : t(projection.storage.message)}
              </p>
              {activePersonalizedModel ? (
                <small>{t("Storage guidance remains canonical; your private timing preference changes drinking dates and catalog urgency only.")}</small>
              ) : null}
              {projection.storage.move.needed && !override?.storagePurpose ? (
                <span
                  className={`wine-maturity__move wine-maturity__move--${projection.storage.move.possible ? "possible" : "blocked"}`}
                >
                  {t(projection.storage.move.message)}
                </span>
              ) : null}
            </div>
          ) : null}

          <details className="wine-maturity__explanation">
            <summary>{t("Why this estimate?")}</summary>
            <p>{t("Model specificity:")}{t(projection.specificity.replaceAll("-", " "))}{t(". Calculated")}{new Date(projection.calculatedAt).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US")}.
            </p>
            {model.contributions.length > 0 ? (
              <ol className="wine-maturity__contributions">
                {model.contributions.map((contribution, index) => (
                  <li key={`${contribution.layer}:${contribution.label}:${index}`}>
                    <div>
                      <strong>
                        {t(maturityLayerLabel(contribution.layer))}: {contribution.label}
                      </strong>
                      <span>{t(contribution.rationale)}</span>
                    </div>
                    {contribution.profileId
                      ? profileReviewAction(
                          contribution.profileId,
                          contribution.label,
                        )
                      : null}
                  </li>
                ))}
              </ol>
            ) : model.reasons.length > 0 ? (
              <ul>
                {model.reasons.map((reason) => (
                  <li key={reason}>{t(reason)}</li>
                ))}
              </ul>
            ) : null}
            {supplementalReviewTargets.length > 0 ? (
              <div className="wine-maturity__linked-profiles">
                <strong>{t("Shared profiles used by this estimate")}</strong>
                <p>{t("These are the exact reviewed profiles recorded with this calculation, including older estimates whose explanation is shown as prose.")}</p>
                <ol className="wine-maturity__contributions">
                  {supplementalReviewTargets.map((target) => (
                    <li key={target.profileId}>
                      <div>
                        <strong>{target.subjectTitle}</strong>
                        <span>{t(profileTypeLabel(target.profileType))}</span>
                      </div>
                      {profileReviewAction(
                        target.profileId,
                        target.subjectTitle,
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {model.warnings.length > 0 ? (
              <>
                <strong>{t("Limits")}</strong>
                <ul>
                  {model.warnings.map((warning) => (
                    <li key={warning}>{t(warning)}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {reviewTarget?.profileId ? (
              <form
                className="wine-maturity__review-form"
                onSubmit={(event) => void submitProfileReview(event)}
              >
                <div>
                  <strong>{t("Report an issue with")}{t(" ")}{reviewTarget.label}</strong>
                  <p>{t("This opens or joins a review of this exact shared profile. It does not alter your wine or the published guidance.")}</p>
                </div>
                <label>{t("What needs review?")}<select defaultValue="drinking-window" name="category">
                    <option value="drinking-window">{t("Drinking window")}</option>
                    <option value="wine-style">{t("Wine style")}</option>
                    <option value="wrong-identity">{t("Wrong identity")}</option>
                    <option value="evidence-problem">{t("Evidence or source")}</option>
                    <option value="other">{t("Something else")}</option>
                  </select>
                </label>
                <label>{t("What seems wrong?")}<textarea
                    minLength={10}
                    name="comment"
                    placeholder={t("Describe what you observed and what should be checked.")}
                    required
                    rows={4}
                  />
                </label>
                <label>{t("Supporting HTTPS link (optional)")}<input
                    name="evidenceUrl"
                    pattern="https://.*"
                    placeholder={t("https://…")}
                    type="url"
                  />
                </label>
                <div>
                  <button disabled={!isOnline || busyAction !== null} type="submit">
                    {busyAction === `review:${reviewTarget.profileId}`
                      ? "Submitting…"
                      : "Submit for review"}
                  </button>
                  <button
                    disabled={busyAction !== null}
                    onClick={() => setReviewTarget(null)}
                    type="button"
                  >{t("Cancel")}</button>
                </div>
              </form>
            ) : null}
          </details>

          <div className="wine-maturity__feedback">
            <span>{t("Is this model result credible?")}</span>
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
                      ? t("Saving…")
                      : t(feedbackLabel(verdict))}
                  </button>
                ),
              )}
            </div>
          </div>

          {canManageCellar ? <details className="wine-maturity__override">
            <summary>{override ? "Edit your window" : "Adjust this window"}</summary>
            <p>{t("Your values take priority in the app; the original model and its evidence remain unchanged.")}</p>
            <form
              key={override?.updatedAt ?? projection.calculatedAt}
              onSubmit={(event) => void saveOverride(event)}
            >
              <label>{t("First assessment")}<input
                  defaultValue={displayedYears.firstTrialYear}
                  min="1800"
                  name="firstTrialYear"
                  required
                  type="number"
                />
              </label>
              <label>{t("Best from")}<input
                  defaultValue={displayedYears.bestStartYear}
                  min="1800"
                  name="bestStartYear"
                  required
                  type="number"
                />
              </label>
              <label>{t("Best until")}<input
                  defaultValue={displayedYears.bestEndYear}
                  min="1800"
                  name="bestEndYear"
                  required
                  type="number"
                />
              </label>
              <label>{t("Drink by")}<input
                  defaultValue={displayedYears.drinkByYear}
                  min="1800"
                  name="drinkByYear"
                  required
                  type="number"
                />
              </label>
              <label>{t("Preferred storage (optional)")}<select
                  defaultValue={override?.storagePurpose ?? ""}
                  name="storagePurpose"
                >
                  <option value="">{t("Use model suggestion")}</option>
                  {LOCATION_STORAGE_PURPOSES.map((purpose) => (
                    <option key={purpose.value} value={purpose.value}>
                      {t(purpose.label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wine-maturity__override-note">{t("Note (optional)")}<input
                  defaultValue={override?.note ?? ""}
                  name="note"
                  placeholder={t("For example: producer advice")}
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
          </details> : null}
        </>
      ) : null}
    </section>
  )
}
