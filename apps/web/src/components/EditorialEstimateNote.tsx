import { useEffect, useState } from "react"

import { getEditorialEstimate, type EditorialEstimate } from "../data/drinkingWindowEditorialEstimate"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props { evidenceId: string }

export function EditorialEstimateNote({ evidenceId }: Props) {
  const { t } = useLanguage()
  const [estimate, setEstimate] = useState<EditorialEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getEditorialEstimate(evidenceId).then((result) => {
      if (!cancelled) setEstimate(result)
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load estimate")
    })
    return () => { cancelled = true }
  }, [evidenceId])

  if (error) return <Notice role="alert" tone="warning">{error}</Notice>
  if (!estimate) return <p>{t("Loading editorial estimate…")}</p>
  return <div className="drinking-window-source-note">
    <p><strong>{t("CellarManager editorial estimate, not a producer-published window")}</strong></p>
    <p>{t("Start tasting")}: {estimate.firstTrialYear} · {t("Optimum starts")}: {estimate.bestStartYear} · {t("Optimum ends")}: {estimate.bestEndYear}</p>
    <p>{estimate.rationale}</p>
    <p>{t("External pages below provide context; they do not necessarily state these exact dates.")}</p>
    <ul>{estimate.supportingUrls.map((url) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>
  </div>
}
