import { useEffect, useState } from "react"

import { getEditorialContext, type EditorialContext } from "../data/drinkingWindowEditorialEstimate"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props { evidenceId: string }

export function EditorialContextNote({ evidenceId }: Props) {
  const { t } = useLanguage()
  const [context, setContext] = useState<EditorialContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void getEditorialContext(evidenceId).then((value) => {
      if (!cancelled) setContext(value)
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load assessment")
    })
    return () => { cancelled = true }
  }, [evidenceId])
  if (error) return <Notice role="alert" tone="warning">{error}</Notice>
  if (!context) return <p>{t("Loading editorial assessment…")}</p>
  return <div className="drinking-window-source-note">
    <p><strong>{t("CellarManager editorial group assessment, not a producer-published classification")}</strong></p>
    <p>{context.rationale}</p>
    <p>{t("External pages below provide context; they do not necessarily state this exact classification.")}</p>
    <ul>{context.supportingUrls.map((url) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>
  </div>
}
