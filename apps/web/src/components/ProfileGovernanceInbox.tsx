import { type FormEvent, useEffect, useMemo, useState } from "react"

import {
  dismissProfileReviewCase,
  getProfileGovernanceInbox,
  proposeProfileRevision,
  reviewProfileRevision,
  type GovernedProfileSnapshot,
  type ProfileGovernanceInbox as GovernanceInbox,
  type ProfileGovernanceItem,
  type ProfileRevision,
  type ProfileRevisionProposal,
  type ProfileRevisionStatus,
} from "../data/profileGovernance"
import { Notice } from "./Notice"

interface ProfileGovernanceInboxProps {
  isOnline: boolean
}

const AGE_KEYS = [
  "first_trial_age",
  "best_start_age",
  "best_end_age",
  "outer_horizon_age",
]

const ADJUSTMENT_AGE_KEYS = [
  "first_trial_age_adjustment",
  "best_start_age_adjustment",
  "best_end_age_adjustment",
  "outer_horizon_age_adjustment",
]

const TRAIT_KEYS = [
  "body",
  "acidity",
  "tannin",
  "sweetness",
  "alcohol",
  "freshness",
  "savory",
  "concentration",
]

const ADJUSTMENT_TRAIT_KEYS = TRAIT_KEYS.map((key) => `${key}_adjustment`)

const FIELD_LABELS: Record<string, string> = {
  acidity: "Acidity",
  acidity_adjustment: "Acidity shift",
  alcohol: "Alcohol",
  alcohol_adjustment: "Alcohol shift",
  best_end_age: "Recommended period ends",
  best_end_age_adjustment: "Recommended period end shift",
  best_start_age: "Recommended period starts",
  best_start_age_adjustment: "Recommended period start shift",
  body: "Body",
  body_adjustment: "Body shift",
  concentration: "Concentration",
  concentration_adjustment: "Concentration shift",
  condition_tags: "Vintage conditions",
  confidence: "Evidence strength",
  first_trial_age: "First assessment",
  first_trial_age_adjustment: "First assessment shift",
  freshness: "Freshness",
  freshness_adjustment: "Freshness shift",
  outer_horizon_age: "Outer horizon",
  outer_horizon_age_adjustment: "Outer horizon shift",
  rationale: "Reasoning",
  savory: "Savory character",
  savory_adjustment: "Savory character shift",
  sweetness: "Sweetness",
  sweetness_adjustment: "Sweetness shift",
  tannin: "Tannin",
  tannin_adjustment: "Tannin shift",
}

function mutableKeys(profile: GovernedProfileSnapshot): string[] {
  const possible = profile.profileType === "place"
    ? [...AGE_KEYS, ...TRAIT_KEYS]
    : [
        ...ADJUSTMENT_AGE_KEYS,
        ...ADJUSTMENT_TRAIT_KEYS,
        ...(profile.profileType === "vintage" ? ["condition_tags"] : []),
      ]
  return possible.filter((key) => Object.hasOwn(profile.typed, key))
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replaceAll("_", " ")
}

function formatValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "None"
  if (typeof value === "number") {
    if (key === "confidence") return `${Math.round(value * 100)}%`
    if (key.endsWith("_adjustment")) return `${value > 0 ? "+" : ""}${value}`
    return String(value)
  }
  return String(value ?? "Not set")
}

function statusLabel(status: ProfileRevisionStatus): string {
  switch (status) {
    case "proposed":
      return "Decision needed"
    case "approved":
      return "Approved · awaiting publication"
    case "disputed":
      return "Disputed · replacement needed"
    case "superseded":
      return "Superseded"
    case "published":
      return "Published"
  }
}

function reportKindLabel(kind: string): string {
  return kind
    .replace("drinking-window", "Drinking window")
    .replace("wine-style", "Wine style")
    .replace("wrong-identity", "Wrong identity")
    .replace("evidence-problem", "Evidence problem")
    .replace("additional-information", "Additional information")
    .replace("other", "Other")
}

function profileValues(profile: GovernedProfileSnapshot) {
  return mutableKeys(profile).map((key) => ({ key, value: profile.typed[key] }))
}

function changedValues(revision: ProfileRevision) {
  const changes = [
    {
      key: "confidence",
      before: revision.predecessorProfile.confidence,
      after: revision.proposal.confidence,
    },
    {
      key: "rationale",
      before: revision.predecessorProfile.rationale,
      after: revision.proposal.rationale,
    },
    ...Object.keys(revision.proposal.typed).map((key) => ({
      key,
      before: revision.predecessorProfile.typed[key],
      after: revision.proposal.typed[key],
    })),
  ]
  return changes.filter(({ before, after }) =>
    JSON.stringify(before) !== JSON.stringify(after),
  )
}

function splitEvidenceUrls(value: string): string[] {
  return value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

interface ProfileRevisionEditorProps {
  caseId: string
  isOnline: boolean
  onSaved: () => Promise<void>
  profile: GovernedProfileSnapshot
  replacement?: boolean
}

function ProfileRevisionEditor({
  caseId,
  isOnline,
  onSaved,
  profile,
  replacement = false,
}: ProfileRevisionEditorProps) {
  const keys = useMemo(() => mutableKeys(profile), [profile])
  const [confidence, setConfidence] = useState(String(profile.confidence))
  const [rationale, setRationale] = useState(profile.rationale)
  const [sources, setSources] = useState("")
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(keys.map((key) => [
      key,
      Array.isArray(profile.typed[key])
        ? (profile.typed[key] as unknown[]).join(", ")
        : String(profile.typed[key]),
    ])),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline) return
    const typed = { ...profile.typed }
    for (const key of keys) {
      typed[key] = key === "condition_tags"
        ? values[key].split(",").map((value) => value.trim()).filter(Boolean)
        : Number(values[key])
    }

    const proposal: ProfileRevisionProposal = {
      confidence: Number(confidence),
      profileType: profile.profileType,
      rationale,
      typed,
    }
    setIsSaving(true)
    setError(null)
    try {
      await proposeProfileRevision(caseId, proposal, splitEvidenceUrls(sources))
      await onSaved()
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to submit this profile revision",
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <details className="profile-governance-editor" open={replacement}>
      <summary>{replacement ? "Replace the disputed proposal" : "Propose a correction"}</summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          Canonical identity stays unchanged. Edit only reviewed maturity or style
          values and cite at least one HTTPS source.
        </p>
        <div className="profile-governance-editor__fields">
          <label>
            Evidence strength (0–1)
            <input
              max="1"
              min="0"
              onChange={(event) => setConfidence(event.target.value)}
              required
              step="0.05"
              type="number"
              value={confidence}
            />
          </label>
          {keys.map((key) => {
            const isTags = key === "condition_tags"
            const isAge = AGE_KEYS.includes(key) || ADJUSTMENT_AGE_KEYS.includes(key)
            const isAgeAdjustment = ADJUSTMENT_AGE_KEYS.includes(key)
            const isTraitAdjustment = ADJUSTMENT_TRAIT_KEYS.includes(key)
            return (
              <label key={key}>
                {fieldLabel(key)}
                <input
                  max={isTags ? undefined : isAgeAdjustment ? 10 : isTraitAdjustment ? 2 : isAge ? 100 : 5}
                  min={isTags ? undefined : isAgeAdjustment ? -5 : isTraitAdjustment ? -2 : 0}
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))}
                  required
                  step={isTags ? undefined : isAge ? "1" : "0.1"}
                  type={isTags ? "text" : "number"}
                  value={values[key]}
                />
                {isTags ? <small>Comma-separated terms.</small> : null}
              </label>
            )
          })}
        </div>
        <label>
          Revised reasoning
          <textarea
            minLength={10}
            onChange={(event) => setRationale(event.target.value)}
            required
            rows={4}
            value={rationale}
          />
        </label>
        <label>
          Supporting HTTPS sources
          <textarea
            onChange={(event) => setSources(event.target.value)}
            placeholder="One HTTPS link per line"
            required
            rows={2}
            value={sources}
          />
        </label>
        <button disabled={!isOnline || isSaving} type="submit">
          {isSaving ? "Submitting…" : replacement ? "Submit replacement" : "Submit proposal"}
        </button>
        {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
      </form>
    </details>
  )
}

interface RevisionDecisionFormProps {
  isOnline: boolean
  onSaved: () => Promise<void>
  revision: ProfileRevision
}

function RevisionDecisionForm({
  isOnline,
  onSaved,
  revision,
}: RevisionDecisionFormProps) {
  const [verdict, setVerdict] = useState<"approve" | "disagree">("approve")
  const [rationale, setRationale] = useState("")
  const [sources, setSources] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline) return
    setIsSaving(true)
    setError(null)
    try {
      await reviewProfileRevision(
        revision.id,
        verdict,
        rationale,
        splitEvidenceUrls(sources),
      )
      setRationale("")
      setSources("")
      await onSaved()
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to record this decision",
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <details className="profile-governance-decision">
      <summary>Record a curator decision</summary>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Decision
          <select
            onChange={(event) => setVerdict(event.target.value as "approve" | "disagree")}
            value={verdict}
          >
            <option value="approve">Approve the proposed values</option>
            <option value="disagree">Disagree and block publication</option>
          </select>
        </label>
        <label>
          Decision rationale
          <textarea
            minLength={10}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Explain why the evidence supports or contradicts the proposal."
            required
            rows={3}
            value={rationale}
          />
        </label>
        <label>
          Additional HTTPS sources (optional)
          <textarea
            onChange={(event) => setSources(event.target.value)}
            placeholder="One HTTPS link per line"
            rows={2}
            value={sources}
          />
        </label>
        <button disabled={!isOnline || isSaving} type="submit">
          {isSaving ? "Recording…" : "Record decision"}
        </button>
        {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
      </form>
    </details>
  )
}

interface DismissCaseFormProps {
  caseId: string
  isOnline: boolean
  onSaved: () => Promise<void>
}

function DismissCaseForm({ caseId, isOnline, onSaved }: DismissCaseFormProps) {
  const [rationale, setRationale] = useState("")
  const [source, setSource] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline) return
    setIsSaving(true)
    setError(null)
    try {
      await dismissProfileReviewCase(
        caseId,
        rationale,
        splitEvidenceUrls(source),
      )
      await onSaved()
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to close this report",
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <details className="profile-governance-dismissal">
      <summary>Close without changing the profile</summary>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Resolution
          <textarea
            minLength={10}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Explain why the current published profile remains appropriate."
            required
            rows={3}
            value={rationale}
          />
        </label>
        <label>
          Supporting HTTPS sources (optional)
          <input
            onChange={(event) => setSource(event.target.value)}
            placeholder="https://…"
            type="url"
            value={source}
          />
        </label>
        <button disabled={!isOnline || isSaving} type="submit">
          {isSaving ? "Closing…" : "Close with no change"}
        </button>
        {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
      </form>
    </details>
  )
}

function RevisionComparison({ revision }: { revision: ProfileRevision }) {
  const changes = changedValues(revision)
  return (
    <section className="profile-governance-revision">
      <header>
        <div>
          <span className={`profile-governance-status profile-governance-status--${revision.status}`}>
            {statusLabel(revision.status)}
          </span>
          <strong>Proposed by {revision.proposedBy}</strong>
        </div>
        <small>{new Date(revision.proposedAt).toLocaleString()}</small>
      </header>
      <div className="profile-governance-diff">
        <h4>Proposed changes</h4>
        {changes.length === 0 ? (
          <p>No changed value is visible.</p>
        ) : (
          <div className="profile-governance-diff__rows">
            {changes.map(({ key, before, after }) => (
              <div className="profile-governance-diff__row" key={key}>
                <strong>{fieldLabel(key)}</strong>
                <del><small>Current</small>{formatValue(key, before)}</del>
                <ins><small>Proposed</small>{formatValue(key, after)}</ins>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="profile-governance-sources">
        <strong>Sources cited for this revision</strong>
        <ul>
          {revision.evidenceUrls.map((url) => (
            <li key={url}><a href={url} rel="noreferrer" target="_blank">{url}</a></li>
          ))}
        </ul>
      </div>
      {revision.decisions.length > 0 ? (
        <div className="profile-governance-decisions">
          <strong>Recorded decisions</strong>
          <ol>
            {revision.decisions.map((decision) => (
              <li key={decision.id}>
                <span className={`profile-governance-decision__verdict profile-governance-decision__verdict--${decision.verdict}`}>
                  {decision.verdict === "approve" ? "Approved" : "Disagreed"}
                </span>
                <p>{decision.rationale}</p>
                <small>{decision.curator} · {new Date(decision.decidedAt).toLocaleString()}</small>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {revision.publishedProfile ? (
        <Notice tone="success">
          Published in shared library version {revision.publishedProfile.knowledgeVersion.number}
          {revision.publishedAt ? ` on ${new Date(revision.publishedAt).toLocaleString()}` : ""}.
        </Notice>
      ) : null}
    </section>
  )
}

interface GovernanceCardProps {
  isOnline: boolean
  item: ProfileGovernanceItem
  onSaved: () => Promise<void>
}

function GovernanceCard({ isOnline, item, onSaved }: GovernanceCardProps) {
  const activeRevision = item.revisions.find((revision) =>
    revision.status === "proposed" ||
    revision.status === "approved" ||
    revision.status === "disputed",
  )
  const history = item.revisions.filter((revision) =>
    revision.status === "published" || revision.status === "superseded",
  )
  const isOpen = item.status === "open" || item.status === "reviewing"

  return (
    <article className={`profile-governance-card profile-governance-card--${item.status}`}>
      <header className="profile-governance-card__heading">
        <div>
          <span className="research-inbox-card__status">
            {item.status === "open"
              ? "New report"
              : item.status === "reviewing"
                ? "Under governance review"
                : item.status === "resolved"
                  ? "Published resolution"
                  : "Closed — no change"}
          </span>
          <h3>{item.subjectTitle}</h3>
          <p>{item.reporterCount} {item.reporterCount === 1 ? "reporter" : "reporters"} raised this shared-profile review.</p>
        </div>
        <small>Opened {new Date(item.openedAt).toLocaleDateString()}</small>
      </header>

      {item.resolutionSummary ? (
        <Notice tone={item.status === "resolved" ? "success" : undefined}>
          <strong>Outcome:</strong> {item.resolutionSummary}
        </Notice>
      ) : null}

      <section className="profile-governance-reports">
        <h4>Reported concerns</h4>
        <p>Reporter identities, accounts, wines, and cellars are not disclosed.</p>
        <ol>
          {item.reports.map((report, index) => (
            <li key={`${report.createdAt}-${index}`}>
              <strong>{reportKindLabel(report.kind)}</strong>
              <p>{report.comment}</p>
              <div>
                <small>{new Date(report.createdAt).toLocaleString()}</small>
                {report.evidenceUrl ? (
                  <a href={report.evidenceUrl} rel="noreferrer" target="_blank">Open reporter source</a>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <details className="profile-governance-current">
        <summary>Current published profile · library version {item.currentProfile.knowledgeVersion.number}</summary>
        <p>{item.currentProfile.rationale}</p>
        <dl>
          <div><dt>Evidence strength</dt><dd>{formatValue("confidence", item.currentProfile.confidence)}</dd></div>
          {profileValues(item.currentProfile).map(({ key, value }) => (
            <div key={key}><dt>{fieldLabel(key)}</dt><dd>{formatValue(key, value)}</dd></div>
          ))}
        </dl>
        {item.currentProfile.evidence.length > 0 ? (
          <div className="profile-governance-sources">
            <strong>Evidence retained by the current profile</strong>
            <ul>
              {item.currentProfile.evidence.map((evidence) => (
                <li key={`${evidence.url}-${evidence.claimType}`}>
                  <a href={evidence.url} rel="noreferrer" target="_blank">{evidence.url}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>

      {activeRevision ? (
        <>
          <RevisionComparison revision={activeRevision} />
          {activeRevision.status === "approved" ? (
            <Notice tone="success">
              This revision has an approval and is waiting for the independent
              publication Worker. A curator disagreement recorded before publication
              will still block it.
            </Notice>
          ) : null}
          <RevisionDecisionForm
            isOnline={isOnline}
            onSaved={onSaved}
            revision={activeRevision}
          />
          {activeRevision.status === "disputed" ? (
            <ProfileRevisionEditor
              caseId={item.caseId}
              isOnline={isOnline}
              onSaved={onSaved}
              profile={item.currentProfile}
              replacement
            />
          ) : null}
        </>
      ) : isOpen ? (
        <ProfileRevisionEditor
          caseId={item.caseId}
          isOnline={isOnline}
          onSaved={onSaved}
          profile={item.currentProfile}
        />
      ) : null}

      {isOpen && activeRevision?.status !== "approved" ? (
        <DismissCaseForm caseId={item.caseId} isOnline={isOnline} onSaved={onSaved} />
      ) : null}

      {history.length > 0 ? (
        <details className="profile-governance-history">
          <summary>Immutable revision history · {history.length}</summary>
          <div>
            {history.map((revision) => (
              <RevisionComparison key={revision.id} revision={revision} />
            ))}
          </div>
        </details>
      ) : null}

      {item.events.length > 0 ? (
        <details className="profile-governance-audit">
          <summary>Audit trail · {item.events.length} events</summary>
          <ol>
            {item.events.map((event, index) => (
              <li key={`${event.occurredAt}-${event.type}-${index}`}>
                <strong>{event.type.replaceAll("-", " ")}</strong>
                <small>{event.actor ?? "Trusted publication service"} · {new Date(event.occurredAt).toLocaleString()}</small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  )
}

export function ProfileGovernanceInbox({ isOnline }: ProfileGovernanceInboxProps) {
  const [inbox, setInbox] = useState<GovernanceInbox | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!isOnline) return
    setIsLoading(true)
    setError(null)
    try {
      setInbox(await getProfileGovernanceInbox())
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load shared profile governance",
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setInbox(null)
    setError(null)
    if (!isOnline) return
    let cancelled = false
    setIsLoading(true)
    void getProfileGovernanceInbox()
      .then((nextInbox) => {
        if (!cancelled) setInbox(nextInbox)
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load shared profile governance",
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOnline])

  const groups = useMemo(() => {
    const items = inbox?.items ?? []
    return {
      active: items.filter((item) => item.status === "open" || item.status === "reviewing"),
      closed: items.filter((item) => item.status === "resolved" || item.status === "dismissed"),
    }
  }, [inbox])

  if (!inbox?.curator.eligible) return null

  return (
    <details className="research-inbox profile-governance-inbox">
      <summary>
        <span>
          <strong className="research-inbox__closed-label">
            Show shared profile governance · {groups.active.length} active
          </strong>
          <strong className="research-inbox__open-label">
            Hide shared profile governance · {groups.active.length} active
          </strong>
          <small>Curator-only reports, revisions, decisions, and publication history</small>
        </span>
        <span aria-hidden="true" className="research-inbox__chevron">▾</span>
      </summary>

      <div className="research-inbox__heading">
        <div>
          <h2>Shared profile governance</h2>
          <p>
            Propose evidence-backed corrections. Any curator disagreement blocks
            publication; the active library changes only through a new immutable version.
          </p>
        </div>
        <button disabled={!isOnline || isLoading} onClick={() => void refresh()} type="button">
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
      {!isOnline ? <Notice tone="warning">Reconnect to review shared profiles.</Notice> : null}

      {groups.active.length === 0 ? (
        <p>No shared profile currently needs a curator decision.</p>
      ) : (
        <div className="profile-governance-list">
          {groups.active.map((item) => (
            <GovernanceCard
              isOnline={isOnline}
              item={item}
              key={item.caseId}
              onSaved={refresh}
            />
          ))}
        </div>
      )}

      {groups.closed.length > 0 ? (
        <details className="profile-governance-closed">
          <summary>Published and closed cases · {groups.closed.length}</summary>
          <div className="profile-governance-list">
            {groups.closed.map((item) => (
              <GovernanceCard
                isOnline={isOnline}
                item={item}
                key={item.caseId}
                onSaved={refresh}
              />
            ))}
          </div>
        </details>
      ) : null}
    </details>
  )
}
