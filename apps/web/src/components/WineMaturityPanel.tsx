import { type FormEvent, useEffect, useState } from "react"

import {
  LOCATION_STORAGE_PURPOSES,
  getLocationStoragePurposeLabel,
} from "../data/cellarSetupView"
import type { LocationStoragePurpose } from "../data/cellarSetup"
import {
  clearMemberMaturityCalibration,
  clearHouseholdProducerWindowRule,
  clearWineMaturityOverride,
  getWineMaturity,
  maturityCalibrationLabel,
  maturityAssessmentReasonMessage,
  reviewWineMaturity,
  setMemberMaturityCalibration,
  setHouseholdProducerWindowRule,
  setWineMaturityOverride,
  type HouseholdProducerWindowScope,
  supportsThreeMilestoneManualOverrides,
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
import { formatLocalizedDate } from "../i18n/formatting"

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
    case "producer_appellation":
      return "Producer and appellation"
    case "producer_region":
      return "Producer and region"
    default:
      return layer.replaceAll("-", " ")
  }
}

function producerRuleScopeLabel(scope: HouseholdProducerWindowScope): string {
  switch (scope) {
    case "product": return "This producer’s cuvée in this appellation"
    case "producer_appellation": return "All this producer’s wines in this appellation"
    case "producer_region": return "All this producer’s wines in this region"
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

function optionalYearInput(form: HTMLFormElement, name: string): number | null {
  const raw = new FormData(form).get(name)
  return raw === null || String(raw).trim() === "" ? null : yearInput(form, name)
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
  const [threeMilestoneEditing, setThreeMilestoneEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [profileReviewInbox, setProfileReviewInbox] =
    useState<ReviewInbox | null>(null)
  const [profileReviewTargets, setProfileReviewTargets] = useState<
    ProfileReviewTarget[]
  >([])
  const [reviewTarget, setReviewTarget] = useState<IssueReviewTarget | null>(null)

  useEffect(() => {
    setThreeMilestoneEditing(false)
    if (!isOnline || !canManageCellar) return
    let active = true
    void supportsThreeMilestoneManualOverrides().then((supported) => {
      if (active) setThreeMilestoneEditing(supported)
    })
    return () => { active = false }
  }, [canManageCellar, isOnline])

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
            drinkByYear: threeMilestoneEditing
              ? optionalYearInput(form, "drinkByYear")
              : yearInput(form, "drinkByYear"),
            firstTrialYear: yearInput(form, "firstTrialYear"),
          },
          purpose,
          String(data.get("note") ?? ""),
        ),
      )
      setMessage(t("Your manual window now takes priority."))
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
      setMessage(t("Shared guidance is active again."))
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

  async function saveProducerRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline || !canManageCellar) return
    const form = event.currentTarget
    const data = new FormData(form)
    setBusyAction("producer-rule")
    setError(null)
    setMessage(null)
    try {
      await setHouseholdProducerWindowRule(
        wineId,
        String(data.get("scope")) as HouseholdProducerWindowScope,
        {
          firstTrialYear: yearInput(form, "firstTrialYear"),
          bestStartYear: yearInput(form, "bestStartYear"),
          bestEndYear: yearInput(form, "bestEndYear"),
        },
        String(data.get("note") ?? ""),
      )
      setResult(await getWineMaturity(wineId))
      setMessage(t("Your cellar producer rule was saved. It does not change the shared database."))
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save the producer rule")
    } finally {
      setBusyAction(null)
    }
  }

  async function clearProducerRule(ruleId: string) {
    if (!isOnline || !canManageCellar) return
    setBusyAction(`clear-producer-rule:${ruleId}`)
    setError(null)
    setMessage(null)
    try {
      await clearHouseholdProducerWindowRule(ruleId)
      setResult(await getWineMaturity(wineId))
      setMessage(t("The cellar producer rule was removed. The next applicable source is restored."))
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to remove the producer rule")
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
  const activeProducerRule = result?.effectiveSource === "cellar_producer"
    ? result.producerRules?.selected ?? null : null
  const activeReference =
    result?.effectiveSource === "reviewed_reference"
      ? result.reference ?? null
      : null
  const effectiveReference = activeReference ? {
    firstTrialYear: activeReference.effectiveFirstTrialYear ?? activeReference.firstTrialYear,
    bestStartYear: activeReference.effectiveBestStartYear ?? activeReference.bestStartYear,
    bestEndYear: activeReference.effectiveBestEndYear ?? activeReference.bestEndYear,
  } : null
  const referenceState = effectiveReference
    ? new Date().getFullYear() < effectiveReference.firstTrialYear
      ? "hold"
      : new Date().getFullYear() < effectiveReference.bestStartYear
        ? "assess"
        : new Date().getFullYear() <= effectiveReference.bestEndYear
          ? "ready"
          : "assess-now"
    : null
  const producerRuleState = activeProducerRule
    ? new Date().getFullYear() < activeProducerRule.firstTrialYear
      ? "hold"
      : new Date().getFullYear() < activeProducerRule.bestStartYear
        ? "assess"
        : new Date().getFullYear() <= activeProducerRule.bestEndYear
          ? "ready" : "assess-now"
    : null
  const displayedRecommendation = activePersonalizedModel ?? model
  const displayedYears = override ?? activeProducerRule ?? effectiveReference ?? displayedRecommendation
  // A cellar-wide rule must never silently inherit this member's personal shift.
  const producerRuleSuggestedYears = result?.producerRules?.selected ?? override ?? activeReference ?? model
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

      {!isLoading && isOnline && result && projection === null && !activeReference && !activeProducerRule && !override ? (
        <Notice tone={result.demandStatus === "needs-review" ? "warning" : undefined}>
          {result.demandStatus === "needs-review"
            ? result.assessmentReason
              ? t(maturityAssessmentReasonMessage(result.assessmentReason))
              : t("Not assessed: no reviewed profile safely matches this wine yet. No range has been guessed.")
            : t("Assessment is being prepared. Check again shortly.")}
        </Notice>
      ) : null}

      {result?.effectiveSource === "unavailable" && result.referenceStatus && !override ? (
        <Notice tone="warning">{t("The wine identity needs review before a drinking window can be suggested.")}</Notice>
      ) : null}

      {displayedYears && (override || activeProducerRule || activeReference || (projection && model)) && result?.effectiveSource !== "unavailable" ? (
        <>
          <div className={`wine-maturity__summary wine-maturity__summary--${producerRuleState ?? referenceState ?? displayedRecommendation?.state ?? model?.state ?? "assess"}`}>
            <div>
              <span className="wine-maturity__badge">
                {override
                  ? t("Manual window")
                  : activeProducerRule
                    ? t("Cellar producer rule")
                  : activeReference
                    ? activeReference.personalYearShift
                      ? t("Personal timing · reviewed reference")
                      : t("Reviewed reference")
                  : activePersonalizedModel
                    ? t("Personal timing")
                    : result?.effectiveSource === "model_estimate"
                      ? t("Model estimate")
                      : t(model?.stateLabel ?? "")}
              </span>
              <h3>
                {override
                  ? t("Your maturity window")
                  : activeProducerRule
                    ? t("Your cellar’s producer window")
                  : activeReference
                    ? t("Reviewed drinking window")
                    : t(displayedRecommendation?.headline ?? model?.headline ?? "")}
              </h3>
              <p>
                {override?.note ?? activeProducerRule?.note ?? (activeReference
                  ? activeReference.rationale
                  : t(displayedRecommendation?.message ?? model?.message ?? ""))}
              </p>
            </div>
            <span className="wine-maturity__confidence">
              {override
                ? t("Owner estimate")
                : activeProducerRule
                  ? t("Cellar-owner estimate")
                : activeReference
                  ? `${t("Reviewed reference")} · v${activeReference.versionNumber}`
                  : t(`${model?.confidenceLabel[0]?.toUpperCase()}${model?.confidenceLabel.slice(1)} canonical confidence`)}
            </span>
          </div>

          <dl className="wine-maturity__window">
            <div>
              <dt>{t("Start tasting")}</dt>
              <dd>{displayedYears.firstTrialYear}</dd>
            </div>
            <div>
              <dt>{t("Probable optimal period starts")}</dt>
              <dd>{displayedYears.bestStartYear}</dd>
            </div>
            <div>
              <dt>{t("Probable optimal period ends")}</dt>
              <dd>{displayedYears.bestEndYear}</dd>
            </div>
          </dl>

          {!override && !activeProducerRule && !activeReference && displayedRecommendation ? (
            <p className="wine-maturity__confidence">
              {t("Existing model drink-by estimate")}: {displayedRecommendation.drinkByYear}. {t("This is not an expiry date.")}
            </p>
          ) : null}

          {override?.drinkByYear !== null && override?.drinkByYear !== undefined ? (
            <p className="wine-maturity__confidence">
              {t("Previously recorded personal drink-by year")}: {override.drinkByYear}. {t("This older date is kept unless you clear it; it is not an expiry date.")}
            </p>
          ) : null}

          {activeReference ? <p className="wine-maturity__confidence">
            {t("Selected from reviewed shared references")}: {t(maturityLayerLabel(activeReference.matchedScope))}.
            {" "}{t("The end of the optimal period is not an expiry date.")}
          </p> : null}

          {activeReference && (activeReference.personalYearShift ?? 0) !== 0 ? (
            <p className="wine-maturity__confidence">
              {t("Shared dates")}: {activeReference.firstTrialYear} / {activeReference.bestStartYear}–{activeReference.bestEndYear}.
              {" "}{t("Your private timing shifts all three dates; the shared reference is unchanged.")}
            </p>
          ) : null}

          {activeProducerRule ? <p className="wine-maturity__confidence">
            {t(producerRuleScopeLabel(activeProducerRule.scope))} · {result?.producerRules?.context.vintageYear}.
            {" "}{t("These dates belong to this cellar; personal timing is not added again.")}
          </p> : null}

          <section
            aria-labelledby="maturity-calibration-heading"
            className="wine-maturity__calibration"
          >
            <header>
              <div>
                <h3 id="maturity-calibration-heading">{t("Your timing preference")}</h3>
                <p>{activeProducerRule
                  ? t("Your cellar’s explicit dates take priority; your personal timing is not applied a second time.")
                  : activeReference
                    ? t("Shift all three reviewed dates for your account only. The shared reference and other members remain unchanged.")
                  : t("Shift every canonical drinking window for your account only. Shared profiles and other members remain unchanged.")}</p>
              </div>
              <span className="wine-maturity__confidence">
                {t(maturityCalibrationLabel(calibration?.yearShift ?? 0))}
              </span>
            </header>

            {calibration && personalizedModel && model && !activeReference && !activeProducerRule && !override ? (
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

            {calibration && activeProducerRule && !override ? (
              <Notice tone="warning">{t("This preference still applies to other wines, but this cellar’s producer rule takes priority here.")}</Notice>
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

          {projection?.storage ? (
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

          {!activeReference && !activeProducerRule && projection && model ? <details className="wine-maturity__explanation">
            <summary>{t("Why this estimate?")}</summary>
            <p>{t("Model specificity:")}{t(projection.specificity.replaceAll("-", " "))}{t(". Calculated")}{formatLocalizedDate(projection.calculatedAt, language)}.
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
          </details> : null}

          {!activeReference && !activeProducerRule && projection ? <div className="wine-maturity__feedback">
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
          </div> : null}

          {canManageCellar ? <details className="wine-maturity__override">
            <summary>{override ? "Edit your window" : "Adjust this window"}</summary>
            <p>{activeReference
              ? t("Your values take priority; the reviewed reference remains unchanged.")
              : activeProducerRule
                ? t("Your wine-specific values take priority; the cellar producer rule remains unchanged.")
              : t("Your values take priority in the app; the original model and its evidence remain unchanged.")}</p>
            {!threeMilestoneEditing ? <p>{t("The three-date editor is not active in this cellar yet. You can keep using the current four-date form.")}</p> : null}
            <form
              key={override?.updatedAt ?? activeProducerRule?.updatedAt ?? projection?.calculatedAt ?? activeReference?.referenceRowId}
              onSubmit={(event) => void saveOverride(event)}
            >
              <label>{t("Start tasting")}<input
                  defaultValue={displayedYears.firstTrialYear}
                  min="1800"
                  name="firstTrialYear"
                  required
                  type="number"
                />
              </label>
              <label>{t("Probable optimal period starts")}<input
                  defaultValue={displayedYears.bestStartYear}
                  min="1800"
                  name="bestStartYear"
                  required
                  type="number"
                />
              </label>
              <label>{t("Probable optimal period ends")}<input
                  defaultValue={displayedYears.bestEndYear}
                  min="1800"
                  name="bestEndYear"
                  required
                  type="number"
                />
              </label>
              {threeMilestoneEditing && override?.drinkByYear !== null && override?.drinkByYear !== undefined ? <label>{t("Previously recorded personal drink-by year (optional)")}<input
                  defaultValue={override.drinkByYear}
                  min="1800"
                  name="drinkByYear"
                  type="number"
                />
              </label> : null}
              {!threeMilestoneEditing ? <label>{t("Drink by")}<input
                  defaultValue={override?.drinkByYear ?? displayedRecommendation?.drinkByYear ?? ""}
                  min="1800"
                  name="drinkByYear"
                  required
                  type="number"
                />
              </label> : null}
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
                      : result?.producerRules?.selected
                        ? t("Use the cellar producer rule again")
                      : result?.reference
                        ? t("Use shared guidance again")
                        : "Use model again"}
                  </button>
                ) : null}
              </div>
            </form>
          </details> : null}
        </>
      ) : null}

      {canManageCellar && result?.producerRules ? (
        <details className="wine-maturity__override wine-maturity__producer-rule">
          <summary>{t("Cellar-only producer dates")}</summary>
          {result.producerRules.status !== "ok" ? (
            <p>{t("Confirm this wine’s canonical producer, cuvée, vintage and place before setting a producer rule.")}</p>
          ) : (
            <>
              <p>{t("Choose exactly which wines this rule covers. It belongs only to this cellar and never changes shared profiles or another cellar.")}</p>
              <p>{result.producerRules.context.producerName} · {result.producerRules.context.vintageYear} · {result.producerRules.context.regionName}</p>
              {result.producerRules.applicable.length > 0 ? (
                <ul className="wine-maturity__producer-rule-list">
                  {result.producerRules.applicable.map((rule) => (
                    <li key={rule.id}>
                      <span>{t(producerRuleScopeLabel(rule.scope))}: {rule.firstTrialYear} / {rule.bestStartYear}–{rule.bestEndYear}</span>
                      <button disabled={!isOnline || busyAction !== null}
                        onClick={() => void clearProducerRule(rule.id)} type="button">
                        {busyAction === `clear-producer-rule:${rule.id}` ? t("Clearing…") : t("Remove this rule")}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <form key={result.producerRules.selected?.updatedAt ?? "new-rule"}
                onSubmit={(event) => void saveProducerRule(event)}>
                <label>{t("This rule applies to")}
                  <select defaultValue={result.producerRules.selected?.scope ??
                    (result.producerRules.context.appellationName ? "product" : "producer_region")} name="scope">
                    {result.producerRules.context.appellationName ? (
                      <>
                        <option value="product">{t(producerRuleScopeLabel("product"))}</option>
                        <option value="producer_appellation">{t(producerRuleScopeLabel("producer_appellation"))}</option>
                      </>
                    ) : null}
                    <option value="producer_region">{t(producerRuleScopeLabel("producer_region"))}</option>
                  </select>
                </label>
                <label>{t("Start tasting")}<input defaultValue={producerRuleSuggestedYears?.firstTrialYear ?? ""}
                  min={result.producerRules.context.vintageYear ?? 1800} name="firstTrialYear" required type="number" /></label>
                <label>{t("Probable optimal period starts")}<input defaultValue={producerRuleSuggestedYears?.bestStartYear ?? ""}
                  min={result.producerRules.context.vintageYear ?? 1800} name="bestStartYear" required type="number" /></label>
                <label>{t("Probable optimal period ends")}<input defaultValue={producerRuleSuggestedYears?.bestEndYear ?? ""}
                  min={result.producerRules.context.vintageYear ?? 1800} name="bestEndYear" required type="number" /></label>
                <label>{t("Why these dates?")}<input defaultValue={result.producerRules.selected?.note ?? ""}
                  maxLength={1000} name="note" required type="text" /></label>
                <div><button disabled={!isOnline || busyAction !== null} type="submit">
                  {busyAction === "producer-rule" ? t("Saving…") : t("Save cellar producer rule")}
                </button></div>
              </form>
            </>
          )}
        </details>
      ) : null}
    </section>
  )
}
