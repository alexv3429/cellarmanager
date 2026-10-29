import { type FormEvent, useEffect, useState } from "react"

import {
  addGroupMembership,
  addGroupYear,
  createAgeingGroup,
  getAuthoringGroups,
  type AgeingGroup,
  type CurationTarget,
  type FallbackScope,
  type MemberKind,
} from "../data/drinkingWindowFallbackAuthoring"
import { useLanguage } from "../i18n/useLanguage"
import { CurationTargetPicker } from "./CurationTargetPicker"
import { CurationPlaceCreation } from "./CurationPlaceCreation"
import { Notice } from "./Notice"

interface Props { versionId: string; isOnline: boolean; onChanged: () => Promise<void> }

function numericYear(value: string, optional = false): number | null {
  if (!value.trim() && optional) return null
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1800 || result > 2300) throw new Error("Enter a valid year")
  return result
}

export function FallbackProfileEditor({ versionId, isOnline, onChanged }: Props) {
  const { t } = useLanguage()
  const [groups, setGroups] = useState<AgeingGroup[]>([])
  const [groupId, setGroupId] = useState("")
  const [scope, setScope] = useState<FallbackScope>("producer_appellation")
  const [region, setRegion] = useState<CurationTarget | null>(null)
  const [appellation, setAppellation] = useState<CurationTarget | null>(null)
  const [producer, setProducer] = useState<CurationTarget | null>(null)
  const [color, setColor] = useState("red")
  const [groupKey, setGroupKey] = useState("")
  const [definition, setDefinition] = useState("")
  const [memberKind, setMemberKind] = useState<MemberKind>("product")
  const [memberTarget, setMemberTarget] = useState<CurationTarget | null>(null)
  const [memberPlace, setMemberPlace] = useState<CurationTarget | null>(null)
  const [firstVintage, setFirstVintage] = useState("")
  const [lastVintage, setLastVintage] = useState("")
  const [memberRationale, setMemberRationale] = useState("")
  const [vintage, setVintage] = useState("")
  const [first, setFirst] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [windowRationale, setWindowRationale] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function refreshGroups(preferredId?: string) {
    const next = await getAuthoringGroups(versionId)
    setGroups(next)
    setGroupId((current) => preferredId ?? (next.some((group) => group.id === current) ? current : ""))
  }

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    setGroupId("")
    void getAuthoringGroups(versionId).then((next) => {
      if (!cancelled) setGroups(next)
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load ageing groups")
    })
    return () => { cancelled = true }
  }, [versionId, isOnline])

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!region || !isOnline) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const id = await createAgeingGroup({
        versionId, scope, regionId: region.id,
        appellationId: scope.endsWith("appellation") ? appellation?.id ?? null : null,
        producerId: scope.startsWith("producer") ? producer?.id ?? null : null,
        color, groupKey, definition,
      })
      await refreshGroups(id)
      await onChanged()
      setMessage(t("Ageing group added to this unpublished version. Add reviewed members and vintage dates next."))
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to create group") }
    finally { setBusy(false) }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!groupId || !memberTarget || !isOnline) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const from = numericYear(firstVintage, true)
      const to = numericYear(lastVintage, true)
      await addGroupMembership({
        groupId, memberKind, targetId: memberTarget.id,
        placeId: memberKind === "place" ? memberTarget.id : memberPlace?.id ?? "",
        firstVintage: from, lastVintage: to, rationale: memberRationale,
      })
      await refreshGroups()
      await onChanged()
      setMemberTarget(null)
      setMemberPlace(null)
      setMessage(t("Eligible wine added. It still needs evidence and a separate review."))
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to add member") }
    finally { setBusy(false) }
  }

  async function addYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!groupId || !isOnline) return
    setBusy(true); setError(null); setMessage(null)
    try {
      await addGroupYear({
        groupId, vintage: numericYear(vintage)!, firstTrial: numericYear(first)!,
        bestStart: numericYear(start)!, bestEnd: numericYear(end)!, rationale: windowRationale,
      })
      await onChanged()
      setVintage(""); setFirst(""); setStart(""); setEnd("")
      setMessage(t("Vintage window added to the unpublished group. Link editorial evidence and review it before publication."))
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to add group year") }
    finally { setBusy(false) }
  }

  return <details className="research-inbox drinking-window-fallback-editor">
    <summary><strong>{t("Add a producer, appellation or region fallback")}</strong></summary>
    <p>{t("A fallback never borrows another region’s dates. Define its own ageing group, the exact eligible wines or places, then each vintage’s three dates. Every part remains unpublished until separately reviewed.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}

    <h4>{t("1. Define an ageing group")}</h4>
    <form onSubmit={(event) => void createGroup(event)}>
      <label>{t("Reference level")}
        <select value={scope} onChange={(event) => { setScope(event.target.value as FallbackScope); setAppellation(null); setProducer(null) }}>
          <option value="producer_appellation">{t("Producer and appellation")}</option>
          <option value="producer_region">{t("Producer and region")}</option>
          <option value="appellation">{t("Appellation")}</option>
          <option value="region">{t("Region")}</option>
        </select>
      </label>
      <CurationTargetPicker key="group-region" kind="region" label={t("Region / sector")} value={region} onChange={setRegion} isOnline={isOnline} />
      {scope.endsWith("appellation") ? <CurationTargetPicker key="group-appellation" kind="appellation" label={t("Appellation")} value={appellation} onChange={setAppellation} isOnline={isOnline} /> : null}
      {scope.startsWith("producer") ? <CurationTargetPicker key="group-producer" kind="producer" label={t("Producer")} value={producer} onChange={setProducer} isOnline={isOnline} /> : null}
      <CurationPlaceCreation isOnline={isOnline} onCreated={(kind, target) => {
        if (kind === "region") { setRegion(target); setAppellation(null) }
        else setAppellation(target)
      }} />
      <label>{t("Color")}
        <select value={color} onChange={(event) => setColor(event.target.value)}>
          {["red", "white", "rose", "sparkling", "sweet", "fortified", "other"].map((value) =>
            <option key={value} value={value}>{t(value)}</option>)}
        </select>
      </label>
      <label>{t("Ageing category name")}<input required minLength={2} maxLength={80} value={groupKey} onChange={(event) => setGroupKey(event.target.value)} /></label>
      <label>{t("Which wines belong in this category, and why?")}
        <textarea required minLength={20} maxLength={2000} value={definition} onChange={(event) => setDefinition(event.target.value)} />
      </label>
      <button type="submit" disabled={!isOnline || busy || !region || scope.endsWith("appellation") && !appellation || scope.startsWith("producer") && !producer}>
        {t("Create unpublished ageing group")}
      </button>
    </form>

    <h4>{t("2. Choose a group to complete")}</h4>
    <label>{t("Ageing group")}
      <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
        <option value="">{t("Choose an ageing group")}</option>
        {groups.map((group) => <option key={group.id} value={group.id}>
          {group.producer ? `${group.producer} · ` : ""}{group.appellation ?? group.region} · {t(group.wineColor)} · {group.groupKey} · {group.memberCount} {t("members")}
        </option>)}
      </select>
    </label>
    {groupId ? <>
      <h4>{t("3. Add an eligible wine or place")}</h4>
      <form onSubmit={(event) => void addMember(event)}>
        <label>{t("Eligible identity")}
          <select value={memberKind} onChange={(event) => { setMemberKind(event.target.value as MemberKind); setMemberTarget(null); setMemberPlace(null) }}>
            <option value="product">{t("Cuvée (all selected vintages)")}</option>
            <option value="release">{t("Exact cuvée and vintage")}</option>
            <option value="place">{t("Exact place")}</option>
          </select>
        </label>
        <CurationTargetPicker key={memberKind} kind={memberKind} label={t("Eligible identity")}
          value={memberTarget} onChange={setMemberTarget} isOnline={isOnline} />
        {memberKind !== "place" ? <CurationTargetPicker key="member-place" kind="place" label={t("Place for this wine")}
          value={memberPlace} onChange={setMemberPlace} isOnline={isOnline} /> : null}
        <div className="drinking-window-review-years">
          <label>{t("First eligible vintage (optional)")}<input type="number" min="1800" max="2200" value={firstVintage} onChange={(event) => setFirstVintage(event.target.value)} /></label>
          <label>{t("Last eligible vintage (optional)")}<input type="number" min="1800" max="2200" value={lastVintage} onChange={(event) => setLastVintage(event.target.value)} /></label>
        </div>
        <label>{t("Why does this member belong in the group?")}
          <textarea required minLength={20} maxLength={1000} value={memberRationale} onChange={(event) => setMemberRationale(event.target.value)} />
        </label>
        <button type="submit" disabled={!isOnline || busy || !memberTarget || memberKind !== "place" && !memberPlace}>{t("Add eligible member")}</button>
      </form>

      <h4>{t("4. Add three dates for a vintage")}</h4>
      <form onSubmit={(event) => void addYear(event)}>
        <div className="drinking-window-review-years">
          <label>{t("Vintage")}<input required type="number" min="1800" max="2200" value={vintage} onChange={(event) => setVintage(event.target.value)} /></label>
          <label>{t("Start tasting")}<input required type="number" min="1800" max="2300" value={first} onChange={(event) => setFirst(event.target.value)} /></label>
          <label>{t("Optimum starts")}<input required type="number" min="1800" max="2300" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label>{t("Optimum ends")}<input required type="number" min="1800" max="2300" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        </div>
        <label>{t("Why these dates?")}
          <textarea required minLength={20} maxLength={2000} value={windowRationale} onChange={(event) => setWindowRationale(event.target.value)} />
        </label>
        <button type="submit" disabled={!isOnline || busy}>{t("Add unpublished vintage window")}</button>
      </form>
    </> : null}
  </details>
}
