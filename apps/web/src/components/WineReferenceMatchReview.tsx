import { useEffect, useMemo, useState } from "react"

import type { WineCatalogEntry } from "../data/wineCatalog"
import {
  decideWineReferenceMatch,
  getWineReferenceBlockerLabel,
  getWineReferenceReview,
  type WineReferenceCandidate,
  type WineReferenceDecision,
  type WineReferenceReview,
} from "../data/wineReferenceMatching"
import { Notice } from "./Notice"

interface WineReferenceMatchReviewProps {
  isOnline: boolean
  wine: WineCatalogEntry
}

function comparableText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`
}

function candidateTitle(candidate: WineReferenceCandidate): string {
  return (
    candidate.details.displayName ??
    [
      candidate.details.producerName,
      candidate.details.wineName,
      candidate.details.site,
      candidate.details.parcel,
    ]
      .filter(Boolean)
      .join(" · ")
  )
}

function candidateMetadata(
  candidate: WineReferenceCandidate,
): string[] {
  return [
    candidate.details.region,
    candidate.details.subRegion,
    candidate.details.classification,
    candidate.details.colour,
  ].filter((value): value is string => Boolean(value))
}

export function WineReferenceMatchReview({
  isOnline,
  wine,
}: WineReferenceMatchReviewProps) {
  const [review, setReview] =
    useState<WineReferenceReview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [activeLwin7, setActiveLwin7] =
    useState<string | null>(null)
  const [rememberedCandidates, setRememberedCandidates] =
    useState<Set<string>>(() => new Set())
  const [showRejected, setShowRejected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const wineSourceKey = useMemo(
    () =>
      JSON.stringify([
        wine.id,
        wine.producer,
        wine.cuvee,
        wine.vintage,
        wine.color,
        wine.appellation,
        wine.area,
        wine.format_ml,
      ]),
    [wine],
  )

  useEffect(() => {
    setReview(null)
    setError(null)
    setMessage(null)
    setShowRejected(false)
    setRememberedCandidates(new Set())

    if (!isOnline) {
      return
    }

    let cancelled = false
    setIsLoading(true)

    void getWineReferenceReview(wine.id)
      .then((nextReview) => {
        if (!cancelled) {
          setReview(nextReview)
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load reference matches",
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
  }, [isOnline, wine.id, wineSourceKey])

  async function refreshReview() {
    if (!isOnline) {
      setError("Reconnect before searching the reference library.")
      return
    }

    setIsLoading(true)
    setError(null)
    setMessage(null)

    try {
      setReview(await getWineReferenceReview(wine.id, true))
      setMessage("Reference suggestions refreshed.")
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to refresh reference matches",
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function decide(
    candidate: WineReferenceCandidate,
    decision: WineReferenceDecision,
  ) {
    if (!isOnline) {
      setError("Reconnect before reviewing a reference match.")
      return
    }

    const rememberProducer =
      decision === "confirmed" &&
      rememberedCandidates.has(candidate.lwin7)

    setActiveLwin7(candidate.lwin7)
    setError(null)
    setMessage(null)

    try {
      const nextReview = await decideWineReferenceMatch(
        wine.id,
        candidate.lwin7,
        decision,
        rememberProducer,
      )

      setReview(nextReview)
      setMessage(
        decision === "confirmed"
          ? "Reference match confirmed. Your wine description was not changed."
          : "Suggestion rejected and remembered for this wine.",
      )
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save the reference decision",
      )
    } finally {
      setActiveLwin7(null)
    }
  }

  function toggleRemember(lwin7: string) {
    setRememberedCandidates((current) => {
      const next = new Set(current)

      if (next.has(lwin7)) {
        next.delete(lwin7)
      } else {
        next.add(lwin7)
      }

      return next
    })
  }

  function renderCandidate(
    candidate: WineReferenceCandidate,
    rejected: boolean,
  ) {
    const producerName = candidate.details.producerName
    const showRememberProducer =
      producerName !== null &&
      comparableText(producerName) !==
        comparableText(wine.producer)
    const isBusy = activeLwin7 !== null

    return (
      <article
        className={`wine-reference-candidate${rejected ? " wine-reference-candidate--rejected" : ""}`}
        key={candidate.lwin7}
      >
        <div className="wine-reference-candidate__heading">
          <div>
            <span
              className={`wine-reference-strength wine-reference-strength--${candidate.matchStrength}`}
            >
              {candidate.matchStrength === "strong"
                ? "Strong candidate"
                : "Possible candidate"}
            </span>
            <h4>{candidateTitle(candidate)}</h4>
          </div>
          <strong>{percentage(candidate.score)}</strong>
        </div>

        {candidateMetadata(candidate).length > 0 ? (
          <p className="wine-reference-candidate__metadata">
            {candidateMetadata(candidate).join(" · ")}
          </p>
        ) : null}

        <p className="wine-reference-candidate__evidence">
          Producer {percentage(candidate.evidence.producerScore)} · Wine name {percentage(candidate.evidence.productScore)}
          {candidate.evidence.producerPreferred
            ? " · Remembered producer"
            : ""}
        </p>

        {candidate.blockers.length > 0 ? (
          <ul className="wine-reference-candidate__blockers">
            {candidate.blockers.map((blocker) => (
              <li key={blocker}>
                {getWineReferenceBlockerLabel(blocker)}
              </li>
            ))}
          </ul>
        ) : null}

        <small>LWIN7 {candidate.lwin7}</small>

        {!rejected && showRememberProducer ? (
          <label className="wine-reference-candidate__remember">
            <input
              checked={rememberedCandidates.has(candidate.lwin7)}
              disabled={isBusy}
              onChange={() => toggleRemember(candidate.lwin7)}
              type="checkbox"
            />
            Remember that “{wine.producer}” means “{producerName}” for this household
          </label>
        ) : null}

        <div className="wine-reference-candidate__actions">
          <button
            disabled={isBusy || !isOnline}
            onClick={() => void decide(candidate, "confirmed")}
            type="button"
          >
            {activeLwin7 === candidate.lwin7
              ? "Saving…"
              : rejected
                ? "Confirm instead"
                : "Confirm match"}
          </button>

          {!rejected ? (
            <button
              disabled={isBusy || !isOnline}
              onClick={() => void decide(candidate, "rejected")}
              type="button"
            >
              Not this wine
            </button>
          ) : null}
        </div>
      </article>
    )
  }

  const matchedCandidate = review?.matchedReference?.lwin7
    ? [
        ...(review.candidates ?? []),
        ...(review.rejectedCandidates ?? []),
      ].find(
        (candidate) =>
          candidate.lwin7 === review.matchedReference?.lwin7,
      )
    : undefined

  return (
    <div className="wine-reference-review">
      <div className="wine-reference-review__heading">
        <div>
          <h3>Reference library match</h3>
          <p>
            Suggestions come from the attributed Liv-ex LWIN dictionary. Nothing is linked without your confirmation.
          </p>
        </div>

        <button
          disabled={!isOnline || isLoading || activeLwin7 !== null}
          onClick={() => void refreshReview()}
          type="button"
        >
          {isLoading ? "Searching…" : "Refresh suggestions"}
        </button>
      </div>

      {!isOnline ? (
        <Notice tone="warning">
          Reference matching requires a connection. Your wine and inventory remain available offline.
        </Notice>
      ) : null}

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

      {isLoading && review === null ? (
        <Notice role="status">Searching the reference library…</Notice>
      ) : null}

      {review?.status === "unavailable" ? (
        <Notice tone="warning">
          The LWIN reference snapshot has not been loaded on this server yet. Try again after the reference-data import.
        </Notice>
      ) : null}

      {review?.matchedReference ? (
        <div className="wine-reference-current">
          <div>
            <span>Confirmed reference</span>
            <strong>
              {review.matchedReference.producerName} · {review.matchedReference.productName}
            </strong>
            <small>
              {review.matchedReference.referenceType}
              {review.matchedReference.lwin7
                ? ` · LWIN7 ${review.matchedReference.lwin7}`
                : ""}
            </small>
          </div>

          {review.matchedReference.lwin7 && matchedCandidate ? (
            <button
              disabled={activeLwin7 !== null || !isOnline}
              onClick={() =>
                void decide(matchedCandidate, "rejected")
              }
              type="button"
            >
              Remove this match
            </button>
          ) : null}
        </div>
      ) : null}

      {review?.status === "unmatched" &&
      review.candidates.length === 0 ? (
        <Notice>
          No plausible LWIN candidate was found. The wine remains unchanged and can be reviewed again after a future reference refresh.
        </Notice>
      ) : null}

      {review?.status === "unmatched" &&
      review.candidates.length > 0 ? (
        <div className="wine-reference-candidates">
          {review.candidates.map((candidate) =>
            renderCandidate(candidate, false),
          )}
        </div>
      ) : null}

      {review && review.rejectedCandidates.length > 0 ? (
        <div className="wine-reference-rejected">
          <button
            aria-expanded={showRejected}
            onClick={() => setShowRejected((current) => !current)}
            type="button"
          >
            {showRejected ? "Hide" : "Review"} rejected suggestion{review.rejectedCandidates.length === 1 ? "" : "s"} ({review.rejectedCandidates.length})
          </button>

          {showRejected ? (
            <div className="wine-reference-candidates">
              {review.rejectedCandidates.map((candidate) =>
                renderCandidate(candidate, true),
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {review?.sourceUpdatedThrough ? (
        <small className="wine-reference-review__source">
          LWIN source updated through {review.sourceUpdatedThrough.slice(0, 10)} · Matching scores guide review; they are not factual confidence percentages.
        </small>
      ) : null}
    </div>
  )
}
