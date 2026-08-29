import {
  type FormEvent,
  useEffect,
  useState,
} from "react"

import {
  confirmEnrichmentResearchProducerIdentity,
  type EnrichmentResearchDraft,
  type EnrichmentResearchInbox as ResearchInbox,
  type EnrichmentResearchItem,
  type EnrichmentResearchProducerCandidate,
  getEnrichmentResearchProducerCandidates,
  partitionEnrichmentResearchItems,
  reviewEnrichmentResearchDraft,
  suggestEnrichmentResearchSource,
} from "../data/enrichmentResearch"
import { Notice } from "./Notice"

interface EnrichmentResearchInboxProps {
  error: string | null
  householdId: string
  inbox: ResearchInbox | null
  isLoading: boolean
  isOnline: boolean
  onInboxChange: (inbox: ResearchInbox) => void
  onMarkSeen: () => void
  onOpenWine: (wineId: string) => void
  onRefresh: () => void
}

const AGE_LABELS: Record<string, string> = {
  first_trial: "First trial",
  best_start: "Best period starts",
  best_end: "Best period ends",
  outer_horizon: "Suggested drink-by",
}

const AGE_EDITOR_LABELS: Record<string, string> = {
  first_trial: "First tasting timing (years)",
  best_start: "Start of best period (years)",
  best_end: "End of best period (years)",
  outer_horizon: "Final drink-by estimate (years)",
}

const TRAIT_LABELS: Record<string, string> = {
  body: "Body",
  acidity: "Acidity",
  tannin: "Tannin",
  sweetness: "Sweetness",
  alcohol: "Alcohol",
  freshness: "Freshness",
  savory: "Savoury character",
  concentration: "Concentration",
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function copyProposal(
  proposal: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(proposal)) as Record<string, unknown>
}

function titleForProfileType(value: unknown): string {
  switch (value) {
    case "producer-era":
      return "Suggested producer profile"
    case "cuvee":
      return "Suggested cuvée profile"
    case "vintage":
      return "Suggested vintage profile"
    case "place-adjustment":
      return "Suggested local place profile"
    case "place":
      return "Suggested place baseline"
    default:
      return "Structured proposal"
  }
}

function statusContent(item: EnrichmentResearchItem): {
  description: string
  label: string
  tone: "neutral" | "warning" | "success"
} {
  switch (item.status) {
    case "queued":
      return {
        description: "Waiting for the next bounded research cycle.",
        label: "Queued",
        tone: "neutral",
      }
    case "researching":
      return {
        description: "Approved sources are being checked now.",
        label: "Researching",
        tone: "neutral",
      }
    case "draft-ready":
      return {
        description:
          item.subscriptionStatus === "rejected"
            ? "You rejected this revision. You can still review it again."
            : "Review the sources and values before submitting this draft.",
        label:
          item.subscriptionStatus === "rejected"
            ? "Rejected by you"
            : "Your review needed",
        tone: "warning",
      }
    case "owner-reviewed":
      return {
        description:
          "Your review is recorded. A trusted publication step must still validate and version it.",
        label: "Submitted for publication",
        tone: "success",
      }
    case "needs-identity-review":
      return {
        description:
          "Confirm a canonical producer or exact wine reference first. The request will then resume automatically.",
        label: "Identity needed",
        tone: "warning",
      }
    case "needs-source-review":
      return {
        description:
          item.lastErrorCode === "suggested-sources-unusable"
            ? "The proposed pages were unavailable or did not clearly match this producer. CellarManager will keep the request open for better evidence."
            : "CellarManager is looking for complementary attributed sources for this subject. It can combine official, institutional, technical, and editorial evidence.",
        label: "Source review pending",
        tone: "warning",
      }
    case "not-found":
      return {
        description:
          "The approved sources did not provide enough evidence. No profile was guessed.",
        label: "Not found",
        tone: "warning",
      }
    case "retrying":
      return {
        description: "A temporary source or network problem will be retried.",
        label: "Retry scheduled",
        tone: "neutral",
      }
    case "failed":
      return {
        description:
          "Research stopped after repeated failures. Existing cellar guidance is unaffected.",
        label: "Research failed",
        tone: "warning",
      }
    case "published":
      return {
        description:
          "This reviewed contribution is now part of a versioned shared-library release.",
        label: "Published",
        tone: "success",
      }
  }
}

function evidenceStrength(value: unknown): string {
  const confidence = Number(value)
  if (confidence >= 0.75) return "High"
  if (confidence >= 0.5) return "Medium"
  return "Low"
}

function yearCount(value: number): string {
  const years = Math.abs(value)
  return `${years} ${years === 1 ? "year" : "years"}`
}

function maturityAdjustmentSummary(
  ages: Record<string, unknown>,
): string[] {
  const firstTrial = Number(ages.first_trial)
  const bestStart = Number(ages.best_start)
  const bestEnd = Number(ages.best_end)
  const outerHorizon = Number(ages.outer_horizon)
  const summaries: string[] = []

  if (
    firstTrial !== 0 &&
    firstTrial === bestStart &&
    bestStart === bestEnd
  ) {
    summaries.push(
      firstTrial > 0
        ? `Delay the first tasting and recommended drinking period by about ${yearCount(firstTrial)}.`
        : `Bring the first tasting and recommended drinking period forward by about ${yearCount(firstTrial)}.`,
    )
  } else {
    if (firstTrial !== 0) {
      summaries.push(
        firstTrial > 0
          ? `Delay the first tasting by about ${yearCount(firstTrial)}.`
          : `Bring the first tasting forward by about ${yearCount(firstTrial)}.`,
      )
    }
    if (bestStart !== 0 || bestEnd !== 0) {
      if (bestStart === bestEnd) {
        summaries.push(
          bestStart > 0
            ? `Shift the recommended drinking period about ${yearCount(bestStart)} later.`
            : `Shift the recommended drinking period about ${yearCount(bestStart)} earlier.`,
        )
      } else {
        if (bestStart !== 0) {
          summaries.push(
            bestStart > 0
              ? `Start the recommended drinking period about ${yearCount(bestStart)} later.`
              : `Start the recommended drinking period about ${yearCount(bestStart)} earlier.`,
          )
        }
        if (bestEnd !== 0) {
          summaries.push(
            bestEnd > 0
              ? `End the recommended drinking period about ${yearCount(bestEnd)} later.`
              : `End the recommended drinking period about ${yearCount(bestEnd)} earlier.`,
          )
        }
      }
    }
  }

  if (outerHorizon !== 0) {
    summaries.push(
      outerHorizon > 0
        ? `Extend the final drink-by estimate by about ${yearCount(outerHorizon)}.`
        : `Bring the final drink-by estimate forward by about ${yearCount(outerHorizon)}.`,
    )
  }

  return summaries.length > 0
    ? summaries
    : ["Keep the current maturity timeline unchanged."]
}

function traitAdjustmentLabel(key: string, value: unknown): string | null {
  const adjustment = Number(value)
  if (!Number.isFinite(adjustment) || adjustment === 0) return null

  const direction: Record<string, [string, string]> = {
    body: ["fuller-bodied", "lighter-bodied"],
    acidity: ["higher in acidity", "softer in acidity"],
    tannin: ["more tannic", "less tannic"],
    sweetness: ["sweeter", "drier"],
    alcohol: ["higher in alcohol", "lower in alcohol"],
    freshness: ["fresher", "less fresh"],
    savory: ["more savoury", "less savoury"],
    concentration: ["more concentrated", "less concentrated"],
  }
  const wording = direction[key]
  if (!wording) return `${TRAIT_LABELS[key] ?? key}: adjusted`
  const intensity = Math.abs(adjustment) >= 1.5 ? "Much " : "Slightly "
  return `${intensity}${adjustment > 0 ? wording[0] : wording[1]}`
}

function absoluteTraitLabel(value: unknown): string {
  const level = Number(value)
  if (level <= 0.5) return "Very low"
  if (level <= 1.5) return "Low"
  if (level <= 2.5) return "Moderate"
  if (level <= 3.5) return "Medium-high"
  if (level <= 4.5) return "High"
  return "Very high"
}

function ProposalSummary({ draft }: { draft: EnrichmentResearchDraft }) {
  const proposal = draft.review?.proposal ?? draft.proposal
  const ages = asRecord(proposal.age_adjustments)
  const absoluteAges = asRecord(proposal.ages)
  const traits = asRecord(
    proposal.trait_adjustments ?? proposal.traits,
  )
  const factValue = proposal.value
  const maturitySummary = ages ? maturityAdjustmentSummary(ages) : []
  const traitSummary = traits
    ? Object.entries(traits)
        .map(([key, value]) => traitAdjustmentLabel(key, value))
        .filter((value): value is string => value !== null)
    : []

  return (
    <div className="research-proposal">
      <div className="research-proposal__heading">
        <div>
          <span>{titleForProfileType(proposal.profile_type)}</span>
          <strong>
            Evidence strength: {evidenceStrength(proposal.confidence ?? draft.confidence)}
          </strong>
        </div>
        {proposal.first_vintage_year !== undefined ? (
          <span>
            Applies to vintages {String(proposal.first_vintage_year)}–
            {Number(proposal.final_vintage_year) === 2200
              ? "present day"
              : String(proposal.final_vintage_year)}
          </span>
        ) : null}
      </div>

      {factValue !== undefined ? (
        <dl className="research-proposal__facts">
          <div>
            <dt>{String(proposal.field_name ?? "Suggested value")}</dt>
            <dd>
              {Array.isArray(factValue)
                ? factValue
                    .map((value) => {
                      const grape = asRecord(value)
                      return grape
                        ? `${String(grape.name)}${grape.percentage == null ? "" : ` ${String(grape.percentage)}%`}`
                        : String(value)
                    })
                    .join(", ")
                : String(factValue)}
            </dd>
          </div>
        </dl>
      ) : null}

      {ages || absoluteAges ? (
        ages ? (
          <section className="research-proposal__impact">
            <strong>Effect on maturity estimates</strong>
            <p>
              Each bottle already has guidance from its place and vintage. This
              producer profile would:
            </p>
            <ul>
              {maturitySummary.map((summary) => (
                <li key={summary}>{summary}</li>
              ))}
            </ul>
            <small>
              These are relative adjustments to each bottle’s estimate—not four
              separate recommendations or fixed drinking dates.
            </small>
          </section>
        ) : (
          <dl className="research-proposal__adjustments">
            {Object.keys(AGE_LABELS).map((key) => (
              <div key={key}>
                <dt>{AGE_LABELS[key]}</dt>
                <dd>{String(absoluteAges?.[key])} years after vintage</dd>
              </div>
            ))}
          </dl>
        )
      ) : null}

      {traits ? (
        <section className="research-proposal__impact">
          <strong>Expected wine style</strong>
          {proposal.trait_adjustments ? (
            traitSummary.length > 0 ? (
              <ul className="research-proposal__style-list">
                {traitSummary.map((summary) => (
                  <li key={summary}>{summary}</li>
                ))}
              </ul>
            ) : (
              <p>No producer-wide difference from the broader profile.</p>
            )
          ) : (
            <dl className="research-proposal__traits">
              {Object.entries(traits).map(([key, value]) => (
                <div key={key}>
                  <dt>{TRAIT_LABELS[key] ?? key}</dt>
                  <dd>{absoluteTraitLabel(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ) : null}

      <details className="research-proposal__reasoning">
        <summary>Why this profile was suggested</summary>
        <p>{String(proposal.rationale ?? draft.rationale)}</p>
      </details>
    </div>
  )
}

interface ProposalEditorProps {
  draft: EnrichmentResearchDraft
  disabled: boolean
  onCancel: () => void
  onSubmit: (proposal: Record<string, unknown>, note: string) => void
}

function ProposalEditor({
  draft,
  disabled,
  onCancel,
  onSubmit,
}: ProposalEditorProps) {
  const [proposal, setProposal] = useState(() =>
    copyProposal(draft.review?.proposal ?? draft.proposal),
  )
  const [note, setNote] = useState(draft.review?.note ?? "")

  useEffect(() => {
    setProposal(copyProposal(draft.review?.proposal ?? draft.proposal))
    setNote(draft.review?.note ?? "")
  }, [draft])

  function updateTop(key: string, value: unknown) {
    setProposal((current) => ({ ...current, [key]: value }))
  }

  function updateGroup(group: string, key: string, value: number) {
    setProposal((current) => ({
      ...current,
      [group]: {
        ...asRecord(current[group]),
        [key]: value,
      },
    }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit(proposal, note)
  }

  const ages = asRecord(proposal.age_adjustments)
  const absoluteAges = asRecord(proposal.ages)
  const traitGroup = proposal.trait_adjustments
    ? "trait_adjustments"
    : proposal.traits
      ? "traits"
      : null
  const traits = traitGroup ? asRecord(proposal[traitGroup]) : null
  const fieldName = proposal.field_name

  return (
    <form className="research-proposal-editor" onSubmit={submit}>
      <div className="research-proposal-editor__core">
        <label>
          Rationale
          <textarea
            disabled={disabled}
            onChange={(event) => updateTop("rationale", event.target.value)}
            required
            rows={4}
            value={String(proposal.rationale ?? draft.rationale)}
          />
        </label>
        <label>
          Confidence
          <input
            disabled={disabled}
            max={proposal.profile_type === "producer-era" ? "0.7" : "0.85"}
            min="0"
            onChange={(event) => updateTop("confidence", Number(event.target.value))}
            required
            step="0.01"
            type="number"
            value={String(proposal.confidence ?? draft.confidence)}
          />
          <small>
            0 = uncertain · {proposal.profile_type === "producer-era" ? "0.7" : "0.85"} =
            strongest allowed evidence for this profile
          </small>
        </label>
      </div>

      {proposal.profile_type === "producer-era" ? (
        <fieldset>
          <legend>Producer era</legend>
          <label>
            First vintage
            <input
              disabled={disabled}
              max="2200"
              min="1800"
              onChange={(event) => updateTop("first_vintage_year", Number(event.target.value))}
              required
              type="number"
              value={String(proposal.first_vintage_year ?? "")}
            />
          </label>
          <label>
            Final vintage
            <input
              disabled={disabled}
              max="2200"
              min="1800"
              onChange={(event) => updateTop("final_vintage_year", Number(event.target.value))}
              required
              type="number"
              value={String(proposal.final_vintage_year ?? "")}
            />
            <small>Use 2200 for the current ongoing era.</small>
          </label>
        </fieldset>
      ) : null}

      {fieldName === "country" ? (
        <label>
          Suggested country
          <input
            disabled={disabled}
            onChange={(event) => updateTop("value", event.target.value)}
            required
            value={String(proposal.value ?? "")}
          />
        </label>
      ) : fieldName === "sweetness" ? (
        <label>
          Suggested sweetness
          <select
            disabled={disabled}
            onChange={(event) => updateTop("value", event.target.value)}
            required
            value={String(proposal.value ?? "")}
          >
            <option value="bone-dry">Bone dry</option>
            <option value="dry">Dry</option>
            <option value="off-dry">Off-dry</option>
            <option value="medium-sweet">Medium-sweet</option>
            <option value="sweet">Sweet</option>
          </select>
        </label>
      ) : fieldName === "alcohol" ? (
        <label>
          Suggested alcohol (%)
          <input
            disabled={disabled}
            max="30"
            min="0"
            onChange={(event) => updateTop("value", Number(event.target.value))}
            required
            step="0.1"
            type="number"
            value={String(proposal.value ?? "")}
          />
        </label>
      ) : fieldName === "grapes" ? (
        <label>
          Suggested grapes
          <textarea
            disabled={disabled}
            onChange={(event) =>
              updateTop(
                "value",
                event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => {
                    const [name, percentage] = line.split("|").map((part) => part.trim())
                    return {
                      name,
                      percentage:
                        percentage && Number.isFinite(Number(percentage))
                          ? Number(percentage)
                          : null,
                    }
                  }),
              )
            }
            required
            rows={4}
            value={Array.isArray(proposal.value)
              ? proposal.value
                  .map((value) => {
                    const grape = asRecord(value)
                    return grape
                      ? `${String(grape.name ?? "")}${grape.percentage == null ? "" : ` | ${String(grape.percentage)}`}`
                      : ""
                  })
                  .join("\n")
              : ""}
          />
          <small>One grape per line; add an optional percentage after “|”.</small>
        </label>
      ) : null}

      {ages || absoluteAges ? (
        <fieldset>
          <legend>{ages ? "Drinking-window adjustments" : "Drinking ages"}</legend>
          <p>
            {ages
              ? "These advanced values adjust the estimate inherited from the wine’s place and vintage. Use 0 for no change, a positive number to move later, or a negative number to move earlier."
              : "Ages are counted from the vintage year."}
          </p>
          <div className="research-proposal-editor__number-grid">
            {Object.entries(ages ?? absoluteAges ?? {}).map(([key, value]) => (
              <label key={key}>
                {AGE_EDITOR_LABELS[key] ?? key}
                <input
                  disabled={disabled}
                  max={ages ? "10" : "100"}
                  min={ages ? "-5" : "0"}
                  onChange={(event) =>
                    updateGroup(
                      ages ? "age_adjustments" : "ages",
                      key,
                      Number(event.target.value),
                    )
                  }
                  required
                  step="1"
                  type="number"
                  value={String(value)}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {traits && traitGroup ? (
        <fieldset>
          <legend>Structural profile</legend>
          <p>
            {traitGroup === "trait_adjustments"
              ? "Small adjustments to the broader wine profile."
              : "Absolute structure from 0 (low) to 5 (high)."}
          </p>
          <div className="research-proposal-editor__number-grid">
            {Object.entries(traits).map(([key, value]) => (
              <label key={key}>
                {TRAIT_LABELS[key] ?? key}
                <input
                  disabled={disabled}
                  max={traitGroup === "trait_adjustments" ? "2" : "5"}
                  min={traitGroup === "trait_adjustments" ? "-2" : "0"}
                  onChange={(event) =>
                    updateGroup(traitGroup, key, Number(event.target.value))
                  }
                  required
                  step="0.1"
                  type="number"
                  value={String(value)}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <label>
        Note for the trusted curator (optional)
        <textarea
          disabled={disabled}
          onChange={(event) => setNote(event.target.value)}
          placeholder="For example: confirmed during my visit to the producer."
          rows={3}
          value={note}
        />
      </label>

      <div className="research-proposal-editor__actions">
        <button disabled={disabled} type="submit">
          Submit my edited proposal
        </button>
        <button disabled={disabled} onClick={onCancel} type="button">
          Cancel editing
        </button>
      </div>
    </form>
  )
}

function producerDisplayName(
  candidate: EnrichmentResearchProducerCandidate,
): string {
  const exampleProducer = candidate.examples[0]?.split(",", 1)[0]?.trim()
  return exampleProducer || candidate.canonicalName
}

function producerExampleLabel(
  example: string,
  displayName: string,
): string {
  const prefix = `${displayName},`
  const withoutProducer = example.startsWith(prefix)
    ? example.slice(prefix.length).trim()
    : example
  return withoutProducer.replaceAll(", ", " · ")
}

function ResearchItemCard({
  householdId,
  isOnline,
  item,
  onInboxChange,
  onOpenWine,
}: {
  householdId: string
  isOnline: boolean
  item: EnrichmentResearchItem
  onInboxChange: (inbox: ResearchInbox) => void
  onOpenWine: (wineId: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [identityCandidates, setIdentityCandidates] = useState<
    EnrichmentResearchProducerCandidate[]
  >([])
  const [identityLoading, setIdentityLoading] = useState(false)
  const [activeProducerKey, setActiveProducerKey] = useState<string | null>(null)
  const [sourceKind, setSourceKind] = useState<
    "official" | "institutional" | "technical" | "editorial" | "other"
  >("other")
  const [sourceUrl, setSourceUrl] = useState("")
  const [isSourceSaving, setIsSourceSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const status = statusContent(item)
  const recommendedCandidate = identityCandidates[0] ?? null
  const alternativeCandidates = identityCandidates
    .slice(1)
    .filter((candidate) => candidate.score >= 0.5)

  useEffect(() => {
    setIdentityCandidates([])
    if (
      !isOnline ||
      item.status !== "needs-identity-review" ||
      item.subjectType !== "producer-profile"
    ) {
      return
    }

    let cancelled = false
    setIdentityLoading(true)
    void getEnrichmentResearchProducerCandidates(householdId, item.caseId)
      .then((candidates) => {
        if (!cancelled) setIdentityCandidates(candidates)
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load producer identity suggestions",
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIdentityLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [householdId, isOnline, item.caseId, item.status, item.subjectType])

  async function confirmProducerIdentity(
    candidate: EnrichmentResearchProducerCandidate,
  ) {
    setActiveProducerKey(candidate.producerKey)
    setError(null)
    setMessage(null)
    try {
      onInboxChange(
        await confirmEnrichmentResearchProducerIdentity(
          householdId,
          item.caseId,
          candidate.producerKey,
        ),
      )
      setMessage("Producer identity confirmed. Research has resumed.")
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to confirm the producer identity",
      )
    } finally {
      setActiveProducerKey(null)
    }
  }

  async function review(
    verdict: "accepted" | "edited" | "rejected",
    proposal: Record<string, unknown> | null,
    note: string,
  ) {
    if (!item.draft) return
    setIsSaving(true)
    setError(null)
    setMessage(null)
    try {
      const nextInbox = await reviewEnrichmentResearchDraft(
        householdId,
        item.draft.id,
        verdict,
        proposal,
        note,
      )
      onInboxChange(nextInbox)
      setIsEditing(false)
      setMessage(null)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save your research review",
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function submitSource(event: FormEvent) {
    event.preventDefault()
    setIsSourceSaving(true)
    setError(null)
    setMessage(null)
    try {
      onInboxChange(
        await suggestEnrichmentResearchSource(
          householdId,
          item.caseId,
          sourceUrl,
          sourceKind,
        ),
      )
      setSourceUrl("")
      setMessage(
        "Source submitted. CellarManager will verify it and combine it with other usable evidence.",
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to submit this research source",
      )
    } finally {
      setIsSourceSaving(false)
    }
  }

  return (
    <article
      className={`research-inbox-card research-inbox-card--${status.tone}`}
      id={`research-case-${item.caseId}`}
    >
      <header>
        <div>
          <span className="research-inbox-card__status">{status.label}</span>
          <h3>{item.subject.title}</h3>
          <p>{status.description}</p>
        </div>
        <small>
          Requested {new Date(item.requestedAt).toLocaleDateString()}
        </small>
      </header>

      {item.status === "needs-identity-review" ? (
        <div className="research-inbox-card__identity-action">
          {item.subjectType === "producer-profile" ? (
            <>
              <div>
                <strong>Is this the same producer?</strong>
                <p>
                  The exact wine is absent from the reference catalogue, but
                  its producer can still be identified. Confirming it will not
                  rename or otherwise change the wine in your cellar.
                </p>
              </div>
              {identityLoading ? (
                <p>Looking for producer identities…</p>
              ) : recommendedCandidate ? (
                <div className="research-identity-candidates">
                  <article className="research-identity-recommendation">
                    <div>
                      <small className="research-identity-recommendation__label">
                        Recommended match
                      </small>
                      <strong>{producerDisplayName(recommendedCandidate)}</strong>
                      <small>
                        Reference catalogue name: {recommendedCandidate.canonicalName}
                      </small>
                      {recommendedCandidate.examples.length > 0 ? (
                        <div className="research-identity-recommendation__examples">
                          <span>Known reference wines</span>
                          <ul>
                            {recommendedCandidate.examples.map((example) => (
                              <li key={example}>
                                {producerExampleLabel(
                                  example,
                                  producerDisplayName(recommendedCandidate),
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    <button
                      disabled={activeProducerKey !== null || !isOnline}
                      onClick={() =>
                        void confirmProducerIdentity(recommendedCandidate)
                      }
                      type="button"
                    >
                      {activeProducerKey === recommendedCandidate.producerKey
                        ? "Confirming…"
                        : "Yes, this is the same producer"}
                    </button>
                  </article>

                  {alternativeCandidates.length > 0 ? (
                    <details className="research-identity-alternatives">
                      <summary>
                        Not the same producer? Review other possible matches
                      </summary>
                      <div>
                        {alternativeCandidates.map((candidate) => (
                          <article key={candidate.producerKey}>
                            <div>
                              <strong>{producerDisplayName(candidate)}</strong>
                              <small>
                                Reference catalogue name: {candidate.canonicalName}
                              </small>
                              {candidate.examples.length > 0 ? (
                                <p>
                                  {candidate.examples
                                    .map((example) =>
                                      producerExampleLabel(
                                        example,
                                        producerDisplayName(candidate),
                                      ),
                                    )
                                    .join(" · ")}
                                </p>
                              ) : null}
                            </div>
                            <button
                              disabled={activeProducerKey !== null || !isOnline}
                              onClick={() => void confirmProducerIdentity(candidate)}
                              type="button"
                            >
                              {activeProducerKey === candidate.producerKey
                                ? "Confirming…"
                                : "Use this producer instead"}
                            </button>
                          </article>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : (
                <Notice tone="warning">
                  No plausible producer-level LWIN identity was found.
                </Notice>
              )}
            </>
          ) : null}
          <div className="research-inbox-card__identity-footer">
            <p>
              If none of these producers is correct, inspect the representative
              wine or leave this request unchanged.
            </p>
            <button
              disabled={!isOnline}
              onClick={() => onOpenWine(item.exemplarWineId)}
              type="button"
            >
              Inspect the wine
            </button>
          </div>
        </div>
      ) : null}

      {item.status === "needs-source-review" ? (
        <section className="research-inbox-card__source-action">
          <div>
            <strong>CellarManager keeps looking</strong>
            <p>
              The normal path is automatic: several credible pages are checked,
              compared, and cited together when possible. No extracted profile
              becomes active before your review.
            </p>
          </div>
          <details>
            <summary>Add a source yourself (advanced)</summary>
            <form onSubmit={(event) => void submitSource(event)}>
              <p>
                Use this when you know a relevant page that discovery may miss,
                such as a producer page, an appellation body, a technical sheet,
                or a reputable wine guide.
              </p>
              <label>
                Source type
                <select
                  disabled={isSourceSaving || !isOnline}
                  onChange={(event) =>
                    setSourceKind(event.target.value as typeof sourceKind)
                  }
                  value={sourceKind}
                >
                  <option value="official">Producer or official site</option>
                  <option value="institutional">Institution or appellation body</option>
                  <option value="technical">Importer or technical sheet</option>
                  <option value="editorial">Reputable editorial guide</option>
                  <option value="other">Other reliable page</option>
                </select>
              </label>
              <label>
                Page URL
                <input
                  disabled={isSourceSaving || !isOnline}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://example.com/producer-profile"
                  required
                  type="url"
                  value={sourceUrl}
                />
              </label>
              <button disabled={isSourceSaving || !isOnline} type="submit">
                {isSourceSaving ? "Submitting…" : "Check and use this source"}
              </button>
              <small>
                CellarManager checks HTTPS safety, redirects, robots rules, and
                subject relevance. The page text is not stored.
              </small>
            </form>
          </details>
        </section>
      ) : null}

      {item.draft ? (
        <>
          <ProposalSummary draft={item.draft} />
          <div className="research-inbox-card__sources">
            <strong>Evidence checked</strong>
            <ul>
              {item.draft.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} rel="noreferrer" target="_blank">
                    {source.name}
                  </a>
                  <small>
                    Retrieved {new Date(source.retrievedAt).toLocaleDateString()}
                    {source.attribution ? ` · ${source.attribution}` : ""}
                  </small>
                </li>
              ))}
            </ul>
            <p>
              The pages are cited, not copied. This is a model proposal based on
              their structure claims, and it remains inactive until reviewed and
              published through a new immutable library version.
            </p>
          </div>

          {item.status === "draft-ready" && isEditing ? (
            <ProposalEditor
              disabled={isSaving || !isOnline}
              draft={item.draft}
              onCancel={() => setIsEditing(false)}
              onSubmit={(proposal, note) => void review("edited", proposal, note)}
            />
          ) : item.status === "draft-ready" ? (
            <div className="research-inbox-card__actions">
              <button
                disabled={isSaving || !isOnline}
                onClick={() => void review("accepted", null, "")}
                type="button"
              >
                Approve this profile
              </button>
              <button
                disabled={isSaving || !isOnline}
                onClick={() => setIsEditing(true)}
                type="button"
              >
                Adjust the profile
              </button>
              <button
                disabled={isSaving || !isOnline}
                onClick={() => void review("rejected", null, "")}
                type="button"
              >
                Reject this profile
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {message ? <Notice role="status">{message}</Notice> : null}
      {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    </article>
  )
}

export function EnrichmentResearchInbox({
  error,
  householdId,
  inbox,
  isLoading,
  isOnline,
  onInboxChange,
  onMarkSeen,
  onOpenWine,
  onRefresh,
}: EnrichmentResearchInboxProps) {
  const items = inbox?.items ?? []
  const { active: activeItems, published: publishedItems } =
    partitionEnrichmentResearchItems(items)
  const activeCount = activeItems.length
  const publishedCount = publishedItems.length
  const totalCount = items.length
  const unread = inbox?.unreadCount ?? 0

  return (
    <details
      className="research-inbox"
      onToggle={(event) => {
        if (event.currentTarget.open && unread > 0) onMarkSeen()
      }}
    >
      <summary>
        <span>
          <strong className="research-inbox__closed-label">
            Show research inbox · {activeCount} active
            {publishedCount > 0 ? ` · ${publishedCount} published` : ""}
            {unread > 0 ? ` · ${unread} new` : ""}
          </strong>
          <strong className="research-inbox__open-label">
            Hide research inbox · {activeCount} active
            {publishedCount > 0 ? ` · ${publishedCount} published` : ""}
          </strong>
          <small>Attributed drafts, your reviews, and publication status</small>
        </span>
        <span aria-hidden="true" className="research-inbox__chevron">▾</span>
      </summary>

      <div className="research-inbox__heading">
        <div>
          <h2>Research and review</h2>
          <p>
            Research can suggest shared knowledge, but it cannot silently change
            your cellar or publish itself.
          </p>
        </div>
        <button disabled={isLoading || !isOnline} onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      {!isOnline ? (
        <Notice tone="warning">Reconnect to request or review web research.</Notice>
      ) : isLoading && inbox === null ? (
        <p>Loading research requests…</p>
      ) : error ? (
        <Notice role="alert" tone="warning">{error}</Notice>
      ) : totalCount === 0 ? (
        <p>
          No research has been requested yet. Use “Request research” in the
          prioritized queue above.
        </p>
      ) : (
        <>
          {activeCount === 0 ? (
            <p>No active research requests. All requested profiles are published.</p>
          ) : (
            <div className="research-inbox__list">
              {activeItems.map((item) => (
                <ResearchItemCard
                  householdId={householdId}
                  isOnline={isOnline}
                  item={item}
                  key={item.caseId}
                  onInboxChange={onInboxChange}
                  onOpenWine={onOpenWine}
                />
              ))}
            </div>
          )}

          {publishedCount > 0 ? (
            <details className="research-inbox__history">
              <summary>
                Published history · {publishedCount} {publishedCount === 1 ? "profile" : "profiles"}
              </summary>
              <div className="research-inbox__list">
                {publishedItems.map((item) => (
                  <ResearchItemCard
                    householdId={householdId}
                    isOnline={isOnline}
                    item={item}
                    key={item.caseId}
                    onInboxChange={onInboxChange}
                    onOpenWine={onOpenWine}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </details>
  )
}
