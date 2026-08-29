import { useQuery } from "@powersync/react"
import { useMemo, useState } from "react"

import {
  cleanWineText,
  formatWineVolume,
  parseWineFormatMl,
  parseWineVintage,
} from "../data/wineCatalog"
import {
  findWineDuplicateGroups,
  getWineDuplicateDifferences,
  mergeWineDuplicates,
  type WineDuplicateCandidate,
  type WineDuplicateDifference,
  type WineDuplicateGroup,
  type WineMergeResolution,
  type WineMergeResolutionField,
  type WineMergeResolutionValue,
  type WineMergeResult,
} from "../data/wineDuplicates"
import { Notice } from "./Notice"

interface PendingOperationRow {
  wine_id: string
}

interface DuplicatePositionRow {
  wine_id: string
  location_id: string
  quantity: number
  location_code: string
  cellar_name: string
}

interface WineDuplicateReviewProps {
  householdId: string
  isOnline: boolean
  wines: WineDuplicateCandidate[]
}

const PENDING_OPERATIONS_QUERY = `
  select wine_id
  from inventory_operations
  where household_id = ?
    and status = 'PENDING'
`

const DUPLICATE_POSITIONS_QUERY = `
  select
    h.wine_id,
    h.location_id,
    h.quantity,
    l.code as location_code,
    c.name as cellar_name
  from holdings h
  join locations l on l.id = h.location_id
  join cellars c on c.id = l.cellar_id
  where h.household_id = ?
    and h.quantity > 0
  order by c.name, l.code
`

type ResolutionChoice = "target" | "source" | "custom"

function differenceValueLabel(
  difference: WineDuplicateDifference,
  value: WineMergeResolutionValue,
): string {
  if (value === null) return "Not set"
  if (difference.input === "format" && typeof value === "number") {
    return formatWineVolume(value)
  }
  if (difference.input === "vintage") return String(value ?? "NV")
  return String(value)
}

function customResolutionValue(
  difference: WineDuplicateDifference,
  rawValue: string,
): WineMergeResolutionValue {
  if (difference.input === "vintage") {
    return parseWineVintage(rawValue)
  }
  if (difference.input === "format") {
    return parseWineFormatMl(rawValue)
  }

  const cleaned = cleanWineText(rawValue)
  if (!difference.optional && cleaned.length === 0) {
    throw new Error(`${difference.label} cannot be blank`)
  }
  return cleaned.length === 0 ? null : cleaned
}

function mergeResolution(
  differences: WineDuplicateDifference[],
  choices: Partial<Record<WineMergeResolutionField, ResolutionChoice>>,
  customValues: Partial<Record<WineMergeResolutionField, string>>,
): WineMergeResolution {
  const resolution: WineMergeResolution = {}

  for (const difference of differences) {
    const choice = choices[difference.field] ?? "target"
    const value = choice === "source"
      ? difference.sourceValue
      : choice === "custom"
        ? customResolutionValue(
          difference,
          customValues[difference.field] ?? "",
        )
        : difference.targetValue
    resolution[difference.field] = value
  }

  return resolution
}

function wineOptionLabel(wine: WineDuplicateCandidate): string {
  return [
    wine.producer,
    wine.cuvee,
    wine.vintage ?? "NV",
    wine.appellation,
    `${wine.quantity} bottle${wine.quantity === 1 ? "" : "s"}`,
    wine.id.slice(0, 8),
  ]
    .filter((value) => value !== null)
    .join(" · ")
}

function basisLabel(group: WineDuplicateGroup): string {
  return group.basis === "confirmed-reference"
    ? "Same confirmed wine reference, vintage, color, and format"
    : "Same normalized producer, cuvée, vintage, color, and format"
}

function mergeResultMessage(result: WineMergeResult): string {
  const details = [
    `${result.bottlesTransferred} bottle${result.bottlesTransferred === 1 ? "" : "s"} consolidated`,
    `${result.positionsTransferred} position${result.positionsTransferred === 1 ? "" : "s"} transferred`,
    `${result.observationsTransferred} observation${result.observationsTransferred === 1 ? "" : "s"} transferred`,
  ]

  if (
    result.servingOverrideConflict ||
    result.maturityOverrideConflict
  ) {
    details.push(
      "the kept entry's personal override remains active where both entries had one",
    )
  }

  return `Merge completed: ${details.join(" · ")}. Waiting for synchronization.`
}

interface DuplicateGroupCardProps {
  group: WineDuplicateGroup
  isBusy: boolean
  isOnline: boolean
  pendingWineIds: Set<string>
  positionsByWineId: Map<string, DuplicatePositionRow[]>
  onMerge: (
    sourceWineId: string,
    targetWineId: string,
    resolution: WineMergeResolution,
  ) => Promise<void>
}

function DuplicateGroupCard({
  group,
  isBusy,
  isOnline,
  pendingWineIds,
  positionsByWineId,
  onMerge,
}: DuplicateGroupCardProps) {
  const [targetWineId, setTargetWineId] = useState("")
  const [sourceWineId, setSourceWineId] = useState("")
  const [resolutionChoices, setResolutionChoices] = useState<
    Partial<Record<WineMergeResolutionField, ResolutionChoice>>
  >({})
  const [customValues, setCustomValues] = useState<
    Partial<Record<WineMergeResolutionField, string>>
  >({})
  const [resolutionError, setResolutionError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const selectedHasPendingOperation =
    pendingWineIds.has(targetWineId) ||
    pendingWineIds.has(sourceWineId)
  const selectedTarget = group.wines.find(
    (wine) => wine.id === targetWineId,
  )
  const selectedSource = group.wines.find(
    (wine) => wine.id === sourceWineId,
  )
  const selectedDifferences = selectedSource && selectedTarget
    ? getWineDuplicateDifferences(selectedSource, selectedTarget)
    : []
  const previewSource = group.wines[0]
  const previewTarget = group.wines[1]
  const previewDifferences = previewSource && previewTarget
    ? getWineDuplicateDifferences(previewSource, previewTarget)
    : []
  const displayedDifferences = selectedSource && selectedTarget
    ? selectedDifferences
    : previewDifferences

  function resetResolution() {
    setResolutionChoices({})
    setCustomValues({})
    setResolutionError(null)
    setConfirmed(false)
  }

  function cardTone(wineId: string, index: number): string {
    if (wineId === sourceWineId) return "wine-duplicate-record--source"
    if (wineId === targetWineId) return "wine-duplicate-record--target"
    if (targetWineId || sourceWineId) return ""
    if (index === 0) return "wine-duplicate-record--source"
    if (index === 1) return "wine-duplicate-record--target"
    return ""
  }

  function recordLabel(wineId: string, index: number): string {
    if (wineId === sourceWineId) return "Entry to merge"
    if (wineId === targetWineId) return "Entry to keep"
    return `Catalog entry ${String.fromCharCode(65 + index)}`
  }

  function submitMerge() {
    try {
      setResolutionError(null)
      void onMerge(
        sourceWineId,
        targetWineId,
        mergeResolution(
          selectedDifferences,
          resolutionChoices,
          customValues,
        ),
      )
    } catch (caughtError: unknown) {
      setResolutionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Review the final catalog values",
      )
    }
  }

  const combinedPositions = new Map<string, DuplicatePositionRow>()
  for (const wineId of [sourceWineId, targetWineId]) {
    for (const position of positionsByWineId.get(wineId) ?? []) {
      const current = combinedPositions.get(position.location_id)
      combinedPositions.set(position.location_id, {
        ...position,
        quantity: (current?.quantity ?? 0) + position.quantity,
      })
    }
  }
  const totalSelectedBottles =
    (selectedSource?.quantity ?? 0) + (selectedTarget?.quantity ?? 0)

  return (
    <li className="wine-duplicate-card">
      <div className="wine-duplicate-card__heading">
        <div>
          <strong>{group.wines.length} possible duplicate entries</strong>
          <span>{basisLabel(group)}</span>
        </div>
        <span className="wine-duplicate-card__basis">
          {group.basis === "confirmed-reference"
            ? "Confirmed reference"
            : "Catalog identity"}
        </span>
      </div>

      <div className="wine-duplicate-card__entries">
        {group.wines.map((wine, index) => (
          <article className={cardTone(wine.id, index)} key={wine.id}>
            <span className="wine-duplicate-record__label">
              {recordLabel(wine.id, index)}
            </span>
            <strong>
              {wine.producer} — {wine.cuvee}
            </strong>
            <span>
              {wine.vintage ?? "NV"} · {wine.color} ·{" "}
              {formatWineVolume(wine.format_ml)}
            </span>
            <span>
              {wine.appellation ?? "No appellation"}
              {wine.area ? ` · ${wine.area}` : ""}
            </span>
            <small>
              {wine.quantity} bottle{wine.quantity === 1 ? "" : "s"} ·{" "}
              {wine.position_count} position
              {wine.position_count === 1 ? "" : "s"} · ID {wine.id.slice(0, 8)}
            </small>
            {(positionsByWineId.get(wine.id) ?? []).length > 0 ? (
              <ul className="wine-duplicate-record__positions">
                {(positionsByWineId.get(wine.id) ?? []).map((position) => (
                  <li key={position.location_id}>
                    {position.cellar_name} / {position.location_code} ·{" "}
                    {position.quantity} bottle
                    {position.quantity === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>

      {displayedDifferences.length > 0 ? (
        <section className="wine-duplicate-diff">
          <div className="wine-duplicate-diff__heading">
            <h4>
              {selectedSource && selectedTarget
                ? "Resolve the catalog differences"
                : "Why these are separate catalog entries"}
            </h4>
            <p>
              {selectedSource && selectedTarget
                ? "Red values leave the active catalog; green values remain by default. Choose another or enter a corrected value for each difference."
                : "Red compares entry A with entry B in green; the colors are not an accuracy recommendation. Choose the entry to keep below."}
            </p>
          </div>
          <div className="wine-duplicate-diff__rows">
            {displayedDifferences.map((difference) => {
              const choice = resolutionChoices[difference.field] ?? "target"
              return (
                <div className="wine-duplicate-diff__row" key={difference.field}>
                  <strong>{difference.label}</strong>
                  <del>
                    <small>{selectedSource ? "Removed entry" : "Entry A"}</small>
                    {differenceValueLabel(difference, difference.sourceValue)}
                  </del>
                  <ins>
                    <small>{selectedTarget ? "Kept entry" : "Entry B"}</small>
                    {differenceValueLabel(difference, difference.targetValue)}
                  </ins>
                  {selectedSource && selectedTarget ? (
                    <div className="wine-duplicate-diff__resolution">
                      <label>
                        Final value
                        <select
                          disabled={isBusy}
                          onChange={(event) => {
                            setResolutionChoices((current) => ({
                              ...current,
                              [difference.field]: event.target.value as ResolutionChoice,
                            }))
                            setResolutionError(null)
                            setConfirmed(false)
                          }}
                          value={choice}
                        >
                          <option value="target">
                            Keep {differenceValueLabel(difference, difference.targetValue)}
                          </option>
                          <option value="source">
                            Use {differenceValueLabel(difference, difference.sourceValue)}
                          </option>
                          <option value="custom">Enter another value…</option>
                        </select>
                      </label>
                      {choice === "custom" ? (
                        <label>
                          Corrected {difference.label.toLowerCase()}
                          <input
                            disabled={isBusy}
                            inputMode={difference.input === "text" ? "text" : "numeric"}
                            onChange={(event) => {
                              setCustomValues((current) => ({
                                ...current,
                                [difference.field]: event.target.value,
                              }))
                              setResolutionError(null)
                              setConfirmed(false)
                            }}
                            placeholder={difference.optional ? "Leave blank for not set" : undefined}
                            type={difference.input === "text" ? "text" : "number"}
                            value={customValues[difference.field] ?? ""}
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <p className="wine-duplicate-card__same-values">
          The visible catalog fields are identical. The separate IDs and stock
          positions are the only difference.
        </p>
      )}

      <div className="wine-duplicate-card__choices">
        <label>
          Keep this entry
          <select
            disabled={isBusy}
            onChange={(event) => {
              const nextTarget = event.target.value
              setTargetWineId(nextTarget)
              if (sourceWineId === nextTarget) setSourceWineId("")
              resetResolution()
            }}
            value={targetWineId}
          >
            <option value="">Choose the entry to keep</option>
            {group.wines.map((wine) => (
              <option key={wine.id} value={wine.id}>
                {wineOptionLabel(wine)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Merge this entry into it
          <select
            disabled={isBusy || targetWineId.length === 0}
            onChange={(event) => {
              setSourceWineId(event.target.value)
              resetResolution()
            }}
            value={sourceWineId}
          >
            <option value="">Choose one duplicate</option>
            {group.wines
              .filter((wine) => wine.id !== targetWineId)
              .map((wine) => (
                <option key={wine.id} value={wine.id}>
                  {wineOptionLabel(wine)}
                </option>
              ))}
          </select>
        </label>
      </div>

      {targetWineId && sourceWineId ? (
        <div className="wine-duplicate-card__confirmation">
          <p>
            <strong>{selectedTarget?.producer} — {selectedTarget?.cuvee}</strong>{" "}
            will remain as one catalog entry with {totalSelectedBottles} bottle
            {totalSelectedBottles === 1 ? "" : "s"} across{" "}
            {combinedPositions.size} position
            {combinedPositions.size === 1 ? "" : "s"}. Your final values above
            are recorded with the merge. Observations are consolidated, while
            past inventory activity keeps its original identity.
          </p>
          {combinedPositions.size > 0 ? (
            <ul>
              {[...combinedPositions.values()].map((position) => (
                <li key={position.location_id}>
                  {position.cellar_name} / {position.location_code} ·{" "}
                  {position.quantity} bottle
                  {position.quantity === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          ) : null}
          <label>
            <input
              checked={confirmed}
              disabled={isBusy}
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            I reviewed both entries and understand that this merge is recorded
            in the audit history.
          </label>
        </div>
      ) : null}

      {selectedHasPendingOperation ? (
        <Notice tone="warning">
          Wait for pending inventory operations on these entries to synchronize
          before merging.
        </Notice>
      ) : null}

      {resolutionError ? (
        <Notice role="alert" tone="error">{resolutionError}</Notice>
      ) : null}

      <button
        disabled={
          !isOnline ||
          isBusy ||
          !confirmed ||
          targetWineId.length === 0 ||
          sourceWineId.length === 0 ||
          selectedHasPendingOperation
        }
        onClick={submitMerge}
        type="button"
      >
        {isBusy ? "Merging…" : "Merge reviewed entries"}
      </button>
    </li>
  )
}

export function WineDuplicateReview({
  householdId,
  isOnline,
  wines,
}: WineDuplicateReviewProps) {
  const { data: pendingOperations } = useQuery<PendingOperationRow>(
    PENDING_OPERATIONS_QUERY,
    [householdId],
  )
  const { data: duplicatePositions } = useQuery<DuplicatePositionRow>(
    DUPLICATE_POSITIONS_QUERY,
    [householdId],
  )
  const [mergingSourceId, setMergingSourceId] = useState<string | null>(null)
  const [locallyMergedIds, setLocallyMergedIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const duplicateGroups = useMemo(
    () =>
      findWineDuplicateGroups(
        wines.filter((wine) => !locallyMergedIds.has(wine.id)),
      ),
    [locallyMergedIds, wines],
  )
  const pendingWineIds = useMemo(
    () => new Set(pendingOperations.map((row) => row.wine_id)),
    [pendingOperations],
  )
  const positionsByWineId = useMemo(() => {
    const positions = new Map<string, DuplicatePositionRow[]>()
    for (const position of duplicatePositions) {
      const winePositions = positions.get(position.wine_id) ?? []
      winePositions.push(position)
      positions.set(position.wine_id, winePositions)
    }
    return positions
  }, [duplicatePositions])

  async function merge(
    sourceWineId: string,
    targetWineId: string,
    resolution: WineMergeResolution,
  ) {
    setMergingSourceId(sourceWineId)
    setMessage(null)
    setError(null)
    try {
      const result = await mergeWineDuplicates(
        sourceWineId,
        targetWineId,
        resolution,
      )
      setLocallyMergedIds((current) => new Set(current).add(sourceWineId))
      setMessage(mergeResultMessage(result))
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to merge these catalog entries",
      )
    } finally {
      setMergingSourceId(null)
    }
  }

  return (
    <details className="wine-duplicate-review">
      <summary>
        <span>
          <strong>
            Review possible duplicates · {duplicateGroups.length} group
            {duplicateGroups.length === 1 ? "" : "s"}
          </strong>
          <small>
            Conservative suggestions only; every merge requires your explicit
            choice.
          </small>
        </span>
        <span aria-hidden="true" className="wine-duplicate-review__chevron">
          ▾
        </span>
      </summary>

      <p>
        CellarManager compares physical catalog identity and confirmed shared
        references. Different vintages, colors, or bottle formats are never
        suggested as duplicates.
      </p>

      {!isOnline ? (
        <Notice tone="warning">Reconnect to merge catalog entries.</Notice>
      ) : null}
      {message ? (
        <Notice role="status" tone="success">{message}</Notice>
      ) : null}
      {error ? (
        <Notice role="alert" tone="error">{error}</Notice>
      ) : null}

      {duplicateGroups.length === 0 ? (
        <p>No conservative duplicate candidates were detected.</p>
      ) : (
        <ol className="wine-duplicate-review__list">
          {duplicateGroups.map((group) => (
            <DuplicateGroupCard
              group={group}
              isBusy={mergingSourceId !== null}
              isOnline={isOnline}
              key={group.id}
              onMerge={merge}
              pendingWineIds={pendingWineIds}
              positionsByWineId={positionsByWineId}
            />
          ))}
        </ol>
      )}
    </details>
  )
}
