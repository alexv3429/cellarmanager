import { type FormEvent, useEffect, useMemo, useState } from "react"

import {
  addProfileReviewMessage,
  getProfileReviewInbox,
  markProfileReviewSeen,
  type ProfileReviewInbox as ReviewInbox,
  type ProfileReviewItem,
  type ProfileReviewMessageKind,
  type ProfileReviewStatus,
} from "../data/profileReviews"
import { Notice } from "./Notice"
import { useLanguage } from "../i18n/useLanguage"
import { formatLocalizedDate, formatLocalizedDateTime } from "../i18n/formatting"

interface ProfileReviewInboxProps {
  householdId: string
  isOnline: boolean
  onOpenWine: (wineId: string) => void
}

function statusLabel(status: ProfileReviewStatus): string {
  switch (status) {
    case "open":
      return "Submitted"
    case "reviewing":
      return "Under review"
    case "resolved":
      return "Resolved"
    case "dismissed":
      return "Closed — no change"
  }
}

function messageKindLabel(kind: ProfileReviewMessageKind): string {
  switch (kind) {
    case "drinking-window":
      return "Drinking window"
    case "wine-style":
      return "Wine style"
    case "wrong-identity":
      return "Wrong identity"
    case "evidence-problem":
      return "Evidence"
    case "additional-information":
      return "Additional information"
    case "other":
      return "Other"
  }
}

function tone(status: ProfileReviewStatus): "neutral" | "warning" | "success" {
  if (status === "resolved") return "success"
  if (status === "dismissed") return "neutral"
  return "warning"
}

interface ProfileReviewCardProps {
  householdId: string
  isOnline: boolean
  item: ProfileReviewItem
  onInboxChange: (inbox: ReviewInbox) => void
  onOpenWine: (wineId: string) => void
}

function ProfileReviewCard({
  householdId,
  isOnline,
  item,
  onInboxChange,
  onOpenWine,
}: ProfileReviewCardProps) {
  const { language, t } = useLanguage()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addInformation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOnline) return

    const form = event.currentTarget
    const data = new FormData(form)
    setIsSaving(true)
    setError(null)

    try {
      onInboxChange(
        await addProfileReviewMessage(
          householdId,
          item.caseId,
          String(data.get("comment") ?? ""),
          String(data.get("evidenceUrl") ?? ""),
        ),
      )
      form.reset()
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to add this information",
      )
    } finally {
      setIsSaving(false)
    }
  }

  const isActive = item.status === "open" || item.status === "reviewing"

  return (
    <article className={`research-inbox-card research-inbox-card--${tone(item.status)} profile-review-card`}>
      <header>
        <div>
          <span className="research-inbox-card__status">
            {t(statusLabel(item.status))}
          </span>
          <h3>{item.subjectTitle}</h3>
              <p>
            {t(item.joinedExisting
              ? "Your report joined an existing review of this shared profile."
              : "Your report opened a review of this shared profile.")}
          </p>
        </div>
        <small>{t("Requested")}{t(" ")}{formatLocalizedDate(item.requestedAt, language)}
        </small>
      </header>

      {item.resolutionSummary ? (
        <Notice tone={item.status === "resolved" ? "success" : undefined}>
          <strong>{t("Outcome:")}</strong> {item.resolutionSummary}
        </Notice>
      ) : item.status === "reviewing" ? (
        <p>{t("A trusted reviewer is checking the published profile and evidence.")}</p>
      ) : (
        <p>{t("The published profile remains active while this request is reviewed.")}</p>
      )}

      <details className="profile-review-card__thread">
        <summary>{t("Your private report ·")}{t(" ")}{item.messages.length} {item.messages.length === 1 ? t("message") : t("messages")}</summary>
        <p>{t("Only your own notes are shown here. Other reporters remain private.")}</p>
        <ol>
          {item.messages.map((message) => (
            <li key={message.id}>
              <div>
                <strong>{t(messageKindLabel(message.kind))}</strong>
                <small>{formatLocalizedDateTime(message.createdAt, language)}</small>
              </div>
              <p>{message.comment}</p>
              {message.evidenceUrl ? (
                <a href={message.evidenceUrl} rel="noreferrer" target="_blank">{t("Open supporting source")}</a>
              ) : null}
            </li>
          ))}
        </ol>
      </details>

      <div className="research-inbox-card__actions">
        <button onClick={() => onOpenWine(item.wineId)} type="button">{t("Open wine")}</button>
      </div>

      {isActive ? (
        <details className="profile-review-card__follow-up">
          <summary>{t("Add information or evidence")}</summary>
          <form onSubmit={(event) => void addInformation(event)}>
            <label>{t("Additional information")}<textarea
                minLength={10}
                name="comment"
                placeholder={t("What else should the reviewer know?")}
                required
                rows={3}
              />
            </label>
            <label>{t("Supporting HTTPS link (optional)")}<input
                name="evidenceUrl"
                pattern="https://.*"
                placeholder={t("https://…")}
                type="url"
              />
            </label>
            <button disabled={!isOnline || isSaving} type="submit">
              {isSaving ? "Adding…" : "Add to my report"}
            </button>
          </form>
          {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
        </details>
      ) : null}
    </article>
  )
}

export function ProfileReviewInbox({
  householdId,
  isOnline,
  onOpenWine,
}: ProfileReviewInboxProps) {
  const { t } = useLanguage()
  const [inbox, setInbox] = useState<ReviewInbox | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!isOnline) return
    setIsLoading(true)
    setError(null)
    try {
      setInbox(await getProfileReviewInbox(householdId))
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load profile review requests",
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setInbox(null)
    setError(null)
    if (!isOnline) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    void getProfileReviewInbox(householdId)
      .then((nextInbox) => {
        if (!cancelled) setInbox(nextInbox)
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load profile review requests",
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [householdId, isOnline])

  const groups = useMemo(() => {
    const items = inbox?.items ?? []
    return {
      active: items.filter((item) => item.status === "open" || item.status === "reviewing"),
      closed: items.filter((item) => item.status === "resolved" || item.status === "dismissed"),
    }
  }, [inbox])

  async function markSeen() {
    if (!isOnline || !inbox || inbox.unreadCount === 0) return
    try {
      setInbox(await markProfileReviewSeen(householdId, null))
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to mark profile reviews as read",
      )
    }
  }

  const unread = inbox?.unreadCount ?? 0

  return (
    <details
      className="research-inbox profile-review-inbox"
      onToggle={(event) => {
        if (event.currentTarget.open) void markSeen()
      }}
    >
      <summary>
        <span>
          <strong className="research-inbox__closed-label">{t("Show profile review requests ·")}{groups.active.length}{t("active")}{groups.closed.length > 0 ? t(" · {value1} closed", { value1: String(groups.closed.length) }) : ""}
            {unread > 0 ? t(" · {value1} new", { value1: String(unread) }) : ""}
          </strong>
          <strong className="research-inbox__open-label">{t("Hide profile review requests ·")}{groups.active.length}{t("active")}{groups.closed.length > 0 ? t(" · {value1} closed", { value1: String(groups.closed.length) }) : ""}
          </strong>
          <small>{t("Your reports, supporting evidence, and visible outcomes")}</small>
        </span>
        <span aria-hidden="true" className="research-inbox__chevron">▾</span>
      </summary>

      <div className="research-inbox__heading">
        <div>
          <h2>{t("Published profile reviews")}</h2>
          <p>{t("Reports are reviewed before any new shared-library version can be published.")}</p>
        </div>
        <button disabled={!isOnline || isLoading} onClick={() => void refresh()} type="button">{t("Refresh")}</button>
      </div>

      {!isOnline ? (
        <Notice tone="warning">{t("Reconnect to view or update profile reviews.")}</Notice>
      ) : isLoading && inbox === null ? (
        <p>{t("Loading profile review requests…")}</p>
      ) : error ? (
        <Notice role="alert" tone="warning">{error}</Notice>
      ) : (inbox?.items.length ?? 0) === 0 ? (
        <p>{t("No profile has been reported. Open a wine, expand “Why this estimate?”, and choose “Report an issue” beside the relevant profile.")}</p>
      ) : (
        <>
          {groups.active.length > 0 ? (
            <div className="research-inbox__list">
              {groups.active.map((item) => (
                <ProfileReviewCard
                  householdId={householdId}
                  isOnline={isOnline}
                  item={item}
                  key={item.caseId}
                  onInboxChange={setInbox}
                  onOpenWine={onOpenWine}
                />
              ))}
            </div>
          ) : (
            <p>{t("No active profile reviews.")}</p>
          )}

          {groups.closed.length > 0 ? (
            <details className="research-inbox__history">
              <summary>{t("Show resolved review history ·")}{t(" ")}{groups.closed.length}</summary>
              <div className="research-inbox__list">
                {groups.closed.map((item) => (
                  <ProfileReviewCard
                    householdId={householdId}
                    isOnline={isOnline}
                    item={item}
                    key={item.caseId}
                    onInboxChange={setInbox}
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
