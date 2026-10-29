import { type FormEvent, useState } from "react"

import { attestEditorialContext, attestEditorialEstimate } from "../data/drinkingWindowEditorialEstimate"
import type { ReferenceSubjectKind } from "../data/drinkingWindowReferenceDrafts"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface Props {
  versionId: string
  kind: ReferenceSubjectKind
  subjectId: string
  subjectHash: string
  isOnline: boolean
  onChanged: () => Promise<void>
}

export function EditorialAttestationForm({ versionId, kind, subjectId, subjectHash, isOnline, onChanged }: Props) {
  const { t } = useLanguage()
  const [rationale, setRationale] = useState("")
  const [urls, setUrls] = useState("")
  const [share, setShare] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage(null)
    try {
      const supportingUrls = urls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
      if (kind === "row") await attestEditorialEstimate({ versionId, rowId: subjectId,
        expectedHash: subjectHash, rationale, supportingUrls, adoptAndShare: share })
      else await attestEditorialContext({ versionId, subjectKind: kind,
        subjectId, expectedHash: subjectHash, rationale, supportingUrls, adoptAndShare: share })
      setShare(false)
      setMessage(t("Editorial assessment linked. Review this changed draft again; nothing has been published."))
      await onChanged()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to attest editorial assessment")
    } finally { setBusy(false) }
  }

  return <details>
    <summary>{t(kind === "row" ? "Record a reviewed editorial estimate" : "Record a reviewed editorial group assessment")}</summary>
    <p>{t(kind === "row"
      ? "Use this when external sources inform the dates but do not publish these exact three years. The reference will be labelled as an editorial estimate."
      : "Use this to explain why this exact group or member is appropriate. External pages are context, not a producer-published classification.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <form onSubmit={(event) => void save(event)}>
      <label>{t("Editorial reasoning")}
        <textarea required minLength={30} maxLength={2000} value={rationale} onChange={(event) => setRationale(event.target.value)} />
      </label>
      <label>{t("Context links (one HTTPS URL per line)")}
        <textarea required value={urls} onChange={(event) => setUrls(event.target.value)} />
      </label>
      <label><input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />
        {t("I have reviewed and adopt this assessment for the shared reference. I allow CellarManager to display and reuse it across households.")}
      </label>
      <button type="submit" disabled={!isOnline || busy || !share || rationale.trim().length < 30}>
        {busy ? t("Saving…") : t("Link editorial assessment")}
      </button>
    </form>
  </details>
}
