import { type FormEvent, useState } from "react"

import { createExactDraftRow } from "../data/drinkingWindowReleaseWorkflow"
import { type CurationTarget } from "../data/drinkingWindowFallbackAuthoring"
import { useLanguage } from "../i18n/useLanguage"
import { CurationTargetPicker } from "./CurationTargetPicker"
import { Notice } from "./Notice"

interface Props { versionId: string; isOnline: boolean; onChanged: () => Promise<void> }

export function ExactReleaseDraftEditor({ versionId, isOnline, onChanged }: Props) {
  const { t } = useLanguage()
  const [release, setRelease] = useState<CurationTarget | null>(null)
  const [region, setRegion] = useState<CurationTarget | null>(null)
  const [appellation, setAppellation] = useState<CurationTarget | null>(null)
  const [color, setColor] = useState("red")
  const [format, setFormat] = useState("750")
  const [first, setFirst] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [rationale, setRationale] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!release || !region || !appellation || !isOnline) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const values = [format, first, start, end].map(Number)
      if (!values.every(Number.isInteger) || values[0] < 50 || values[0] > 30000
        || values[1] < 1800 || values[1] > values[2] || values[2] > values[3] || values[3] > 2300) {
        throw new Error(t("Enter a bottle size and three ordered years"))
      }
      await createExactDraftRow({
        versionId, releaseId: release.id, regionId: region.id,
        appellationId: appellation.id, color, formatMl: values[0],
        firstTrialYear: values[1], bestStartYear: values[2],
        bestEndYear: values[3], rationale,
      })
      await onChanged()
      setRelease(null)
      setFirst("")
      setStart("")
      setEnd("")
      setRationale("")
      setMessage(t("Exact wine added to the unpublished draft. Add evidence and review it below before publishing."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t("Unable to add this draft wine"))
    } finally {
      setBusy(false)
    }
  }

  return <details className="research-inbox">
    <summary><strong>{t("Add an exact wine and vintage directly")}</strong></summary>
    <p>{t("A curator can add a canonical release to this draft. Dates remain unpublished until sources, review and the final check are complete.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <form onSubmit={(event) => void submit(event)}>
      <CurationTargetPicker key={`${versionId}:release`} kind="release" label={t("Exact shared wine and vintage")}
        value={release} onChange={setRelease} isOnline={isOnline} />
      <CurationTargetPicker key={`${versionId}:region`} kind="region" label={t("Region / sector")}
        value={region} onChange={setRegion} isOnline={isOnline} />
      <CurationTargetPicker key={`${versionId}:appellation`} kind="appellation" label={t("Appellation")}
        value={appellation} onChange={setAppellation} isOnline={isOnline} />
      <label>{t("Color")}
        <select value={color} onChange={(event) => setColor(event.target.value)}>
          {["red", "white", "rose", "sparkling", "sweet", "fortified", "other"].map((value) =>
            <option key={value} value={value}>{t(value)}</option>)}
        </select>
      </label>
      <label>{t("Bottle format (ml)")}
        <input required type="number" min="50" max="30000" value={format}
          onChange={(event) => setFormat(event.target.value)} />
      </label>
      <div className="drinking-window-review-years">
        <label>{t("Start tasting")}<input required type="number" min="1800" max="2300" value={first}
          onChange={(event) => setFirst(event.target.value)} /></label>
        <label>{t("Optimum starts")}<input required type="number" min="1800" max="2300" value={start}
          onChange={(event) => setStart(event.target.value)} /></label>
        <label>{t("Optimum ends")}<input required type="number" min="1800" max="2300" value={end}
          onChange={(event) => setEnd(event.target.value)} /></label>
      </div>
      <label>{t("Why these exact dates?")}
        <textarea required minLength={20} maxLength={2000} value={rationale}
          onChange={(event) => setRationale(event.target.value)} />
      </label>
      <button type="submit" disabled={!isOnline || busy || !release || !region || !appellation}>
        {busy ? t("Saving…") : t("Add unpublished wine window")}
      </button>
    </form>
  </details>
}
