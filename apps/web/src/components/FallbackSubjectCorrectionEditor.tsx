import { type FormEvent, useEffect, useState } from "react"

import { type CurationTarget, type MemberKind } from "../data/drinkingWindowFallbackAuthoring"
import {
  correctFallbackSubject,
  getFallbackSubject,
  memberTargetId,
  type FallbackCorrectionKind,
  type FallbackSubject,
} from "../data/drinkingWindowFallbackCorrections"
import { useLanguage } from "../i18n/useLanguage"
import { CurationTargetPicker } from "./CurationTargetPicker"
import { Notice } from "./Notice"

interface Props {
  versionId: string
  kind: FallbackCorrectionKind
  subjectId: string
  isOnline: boolean
  onChanged: () => Promise<void>
}

function string(value: unknown) { return value == null ? "" : String(value) }
function year(value: string): number | null {
  if (!value.trim()) return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1800 || number > 2300) throw new Error("Enter a valid year")
  return number
}

export function FallbackSubjectCorrectionEditor({ versionId, kind, subjectId, isOnline, onChanged }: Props) {
  const { t } = useLanguage()
  const [subject, setSubject] = useState<FallbackSubject | null>(null)
  const [first, setFirst] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [rationale, setRationale] = useState("")
  const [groupKey, setGroupKey] = useState("")
  const [memberKind, setMemberKind] = useState<MemberKind>("product")
  const [target, setTarget] = useState<CurationTarget | null>(null)
  const [place, setPlace] = useState<CurationTarget | null>(null)
  const [firstVintage, setFirstVintage] = useState("")
  const [lastVintage, setLastVintage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function fill(current: FallbackSubject) {
    const data = current.data
    setSubject(current)
    setFirst(string(data.first_trial_year))
    setStart(string(data.best_start_year))
    setEnd(string(data.best_end_year))
    setRationale(string(kind === "group" ? data.definition : data.rationale))
    setGroupKey(string(data.group_key))
    if (kind === "membership") {
      const nextKind = data.member_kind as MemberKind
      setMemberKind(nextKind)
      setTarget({ id: memberTargetId(data, nextKind), label: string(data.target_label), detail: t("Current identity") })
      setPlace({ id: string(data.member_place_id), label: string(data.place_label), detail: t("Current place") })
      setFirstVintage(string(data.first_vintage_year))
      setLastVintage(string(data.last_vintage_year))
    }
  }

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    void getFallbackSubject(versionId, kind, subjectId).then((current) => {
      if (!cancelled) fill(current)
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load correction")
    })
    return () => { cancelled = true }
    // The subject is reloaded after a successful mutation below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, kind, subjectId, isOnline])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!subject || !isOnline) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const changes = kind === "row" ? {
        first_trial_year: year(first), best_start_year: year(start),
        best_end_year: year(end), rationale: rationale.trim(),
      } : kind === "group" ? { group_key: groupKey.trim(), definition: rationale.trim() }
        : {
          member_kind: memberKind, target_id: target?.id,
          place_id: memberKind === "place" ? target?.id : place?.id,
          first_vintage_year: year(firstVintage), last_vintage_year: year(lastVintage),
          rationale: rationale.trim(),
        }
      await correctFallbackSubject({ versionId, kind, subjectId,
        expectedHash: subject.hash, changes })
      fill(await getFallbackSubject(versionId, kind, subjectId))
      await onChanged()
      setMessage(t("Fallback corrected. Earlier approval and source support need fresh review; no cellar advice changed."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to correct fallback")
    } finally { setBusy(false) }
  }

  return <section className="drinking-window-draft-correction">
    <h5>{t("Correct this unpublished fallback")}</h5>
    <p>{t("Changing a fallback removes its old supporting link and invalidates its approval. Add reviewed evidence again before publication.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    {!subject ? <p>{t("Loading draft correction…")}</p> : <form onSubmit={(event) => void save(event)}>
      {kind === "row" ? <div className="drinking-window-review-years">
        <label>{t("Start tasting")}<input required type="number" value={first} onChange={(event) => setFirst(event.target.value)} /></label>
        <label>{t("Optimum starts")}<input required type="number" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>{t("Optimum ends")}<input required type="number" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      </div> : null}
      {kind === "group" ? <label>{t("Ageing category name")}
        <input required minLength={2} maxLength={80} value={groupKey} onChange={(event) => setGroupKey(event.target.value)} />
      </label> : null}
      {kind === "membership" ? <>
        <label>{t("Eligible identity")}
          <select value={memberKind} onChange={(event) => {
            setMemberKind(event.target.value as MemberKind); setTarget(null); setPlace(null)
          }}>
            <option value="product">{t("Cuvée (all selected vintages)")}</option>
            <option value="release">{t("Exact cuvée and vintage")}</option>
            <option value="place">{t("Exact place")}</option>
          </select>
        </label>
        <CurationTargetPicker key={memberKind} kind={memberKind} label={t("Eligible identity")}
          value={target} onChange={setTarget} isOnline={isOnline} />
        {memberKind !== "place" ? <CurationTargetPicker key="correct-place" kind="place"
          label={t("Place for this wine")} value={place} onChange={setPlace} isOnline={isOnline} /> : null}
        <div className="drinking-window-review-years">
          <label>{t("First eligible vintage (optional)")}<input type="number" value={firstVintage} onChange={(event) => setFirstVintage(event.target.value)} /></label>
          <label>{t("Last eligible vintage (optional)")}<input type="number" value={lastVintage} onChange={(event) => setLastVintage(event.target.value)} /></label>
        </div>
      </> : null}
      <label>{t(kind === "group" ? "Which wines belong in this category, and why?"
        : kind === "membership" ? "Why does this member belong in the group?" : "Why these dates?")}
        <textarea required minLength={20} maxLength={2000} value={rationale}
          onChange={(event) => setRationale(event.target.value)} />
      </label>
      <button type="submit" disabled={!isOnline || busy || kind === "membership" && !target}>
        {busy ? t("Saving…") : t("Save fallback correction")}
      </button>
    </form>}
  </section>
}
