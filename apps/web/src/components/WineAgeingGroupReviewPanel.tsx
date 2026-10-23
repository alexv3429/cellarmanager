import { useEffect, useState } from "react"

import {
  getHouseholdAgeingGroupReview,
  manageHouseholdAgeingGroupChoice,
  type AgeingGroupScope,
  type HouseholdAgeingGroupReview,
} from "../data/householdAgeingGroups"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  isOnline: boolean
  onChanged: () => void
  revision: number
  wineId: string
}

const scopes: AgeingGroupScope[] = ["producer_appellation", "producer_region", "appellation", "region"]

function scopeLabel(scope: AgeingGroupScope): string {
  switch (scope) {
    case "producer_appellation": return "Producer and appellation"
    case "producer_region": return "Producer and region"
    case "appellation": return "Appellation"
    case "region": return "Region"
  }
}

function groupValue(groupId: string | null, hasChoice: boolean): string {
  return hasChoice ? groupId ?? "unclassified" : "reviewed"
}

export function WineAgeingGroupReviewPanel({ isOnline, onChanged, revision, wineId }: Props) {
  const { t } = useLanguage()
  const [review, setReview] = useState<HouseholdAgeingGroupReview | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isOnline) return
    let active = true
    setLoading(true)
    void getHouseholdAgeingGroupReview(wineId)
      .then((next) => { if (active) setReview(next) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isOnline, revision, wineId])

  async function save(versionId: string, scope: AgeingGroupScope, value: string, revision: string | null) {
    if (!review?.sourceFingerprint || savingKey) return
    const key = `${versionId}:${scope}`
    const action = value === "reviewed" ? "clear" : value === "unclassified" ? "unclassified" : "select"
    setSavingKey(key)
    setError(null)
    setMessage(null)
    try {
      await manageHouseholdAgeingGroupChoice(
        wineId, versionId, scope, action,
        action === "select" ? value : null,
        review.sourceFingerprint, revision,
      )
      const next = await getHouseholdAgeingGroupReview(wineId)
      setReview(next)
      setValues({})
      setMessage(t("Your ageing-group choice was saved only for this wine in your cellar."))
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSavingKey(null)
    }
  }

  if (!isOnline || (!loading && !error && (!review || review.versions.length === 0))) return null

  return <details className="wine-ageing-review">
    <summary>{t("Review this wine’s ageing group")}</summary>
    <p>{t("A group choice applies only to this wine and reference version. It never changes shared membership for other cellars.")}</p>
    {loading ? <p>{t("Loading ageing groups…")}</p> : null}
    {error ? <Notice role="alert" tone="error">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {review?.contextStatus !== "ready" && review ? <Notice tone="warning">
      {t("Confirm this wine’s shared identity, region, colour and vintage before choosing a group.")}
    </Notice> : null}
    {review?.contextStatus === "ready" ? review.versions.map((version) =>
      <section key={version.versionId}>
        <h3>{t("Reference version")} {version.versionNumber} · {t(version.versionStatus === "draft" ? "Draft" : "Published")}</h3>
        {version.versionStatus === "draft" ? <p>{t("This is a draft. Your choice does not enable shared dates.")}</p>
          : <p>{t("If shared dates are enabled for your cellar, saving may change this wine’s suggestion.")}</p>}
        {scopes.map((scope) => {
          const groups = version.groups.filter((group) => group.scope === scope)
          if (groups.length === 0) return null
          const choice = version.choices.find((item) => item.scope === scope)
          const savedValue = groupValue(choice?.groupId ?? null, Boolean(choice))
          const key = `${version.versionId}:${scope}`
          const value = values[key] ?? savedValue
          const selected = groups.find((group) => group.groupId === value)
          return <div className="wine-ageing-review__scope" key={key}>
            <label>{t(scopeLabel(scope))}
              <select value={value} disabled={Boolean(savingKey)}
                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}>
                <option value="reviewed">{t("Use reviewed shared membership")}</option>
                {groups.map((group) => <option value={group.groupId} key={group.groupId}>{group.groupKey}</option>)}
                <option value="unclassified">{t("No group at this scope")}</option>
              </select>
            </label>
            {selected ? <div>
              <p>{selected.definition}</p>
              <small>{t("Group dates if applicable")}: {selected.firstTrialYear} / {selected.bestStartYear}–{selected.bestEndYear}</small>
            </div> : value === "unclassified"
              ? <p>{t("Group-specific dates at this scope will not apply; a broader match or model may remain.")}</p>
              : <p>{t("Reviewed shared membership remains the default.")}</p>}
            <button type="button" disabled={value === savedValue || Boolean(savingKey)}
              onClick={() => void save(version.versionId, scope, value, choice?.choiceRevision ?? null)}>
              {savingKey === key ? t("Saving…") : t("Save my choice for this wine")}
            </button>
          </div>
        })}
      </section>) : null}
  </details>
}
