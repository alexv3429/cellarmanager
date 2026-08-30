import { describe, expect, it, vi } from "vitest"

import {
  addProfileReviewMessage,
  getWineProfileReviewTargets,
  markProfileReviewSeen,
  parseProfileReviewInbox,
  parseProfileReviewTargets,
  requestProfileReview,
} from "./profileReviews"

function inboxResponse() {
  return {
    items: [
      {
        case_id: "case-1",
        joined_existing: true,
        messages: [
          {
            comment: "The drinking window seems several years too late.",
            created_at: "2026-08-30T10:05:00Z",
            evidence_url: "https://example.com/tasting-note",
            id: "message-1",
            kind: "drinking-window",
          },
        ],
        notified_at: "2026-08-30T10:10:00Z",
        opened_at: "2026-08-30T10:00:00Z",
        profile_id: "profile-1",
        profile_type: "producer-era",
        requested_at: "2026-08-30T10:05:00Z",
        resolution_profile_id: null,
        resolution_summary: null,
        resolved_at: null,
        seen_at: null,
        status: "reviewing",
        subject: {
          color: "red",
          producer: "Domaine Example",
        },
        subject_key: "producer-era:producer-1:1990:2200:red",
        subject_title: "Domaine Example · red · 1990–present",
        updated_at: "2026-08-30T10:10:00Z",
        wine_id: "wine-1",
      },
    ],
    status: "available",
    unread_count: 1,
  }
}

describe("profile review request boundary", () => {
  it("parses private reporter messages and shared case status", () => {
    expect(parseProfileReviewInbox(inboxResponse())).toMatchObject({
      unreadCount: 1,
      items: [
        {
          caseId: "case-1",
          joinedExisting: true,
          profileId: "profile-1",
          status: "reviewing",
          subjectTitle: "Domaine Example · red · 1990–present",
          messages: [
            {
              kind: "drinking-window",
              evidenceUrl: "https://example.com/tasting-note",
            },
          ],
        },
      ],
    })
  })

  it("rejects malformed status and unread values", () => {
    expect(() =>
      parseProfileReviewInbox({ ...inboxResponse(), unread_count: -1 }),
    ).toThrow("cannot be negative")
    const malformed = inboxResponse()
    malformed.items[0].status = "published"
    expect(() => parseProfileReviewInbox(malformed)).toThrow("status is invalid")
  })

  it("parses exact projection profile links independently of explanation text", async () => {
    const response = {
      items: [
        {
          contribution_order: 1,
          profile_id: "profile-place",
          profile_type: "place",
          subject_title: "Bourgogne Premier Cru · white place baseline",
        },
        {
          contribution_order: 2,
          profile_id: "profile-vintage",
          profile_type: "vintage",
          subject_title: "Bourgogne 2022 · white vintage",
        },
      ],
      status: "available",
    }
    const rpc = vi.fn().mockResolvedValue({ data: response, error: null })

    expect(parseProfileReviewTargets(response)).toMatchObject([
      { profileId: "profile-place", contributionOrder: 1 },
      { profileId: "profile-vintage", contributionOrder: 2 },
    ])
    await expect(
      getWineProfileReviewTargets("wine-1", { rpc }),
    ).resolves.toHaveLength(2)
    expect(rpc).toHaveBeenCalledWith("get_wine_profile_review_targets", {
      p_wine_id: "wine-1",
    })
  })

  it("rejects malformed projection profile links", () => {
    expect(() =>
      parseProfileReviewTargets({
        items: [
          {
            contribution_order: 0,
            profile_id: "profile-1",
            profile_type: "place",
            subject_title: "Bourgogne",
          },
        ],
        status: "available",
      }),
    ).toThrow("must be positive")
  })

  it("opens a review for one exact profile contribution", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: inboxResponse(), error: null })

    await requestProfileReview(
      "household-1",
      "wine-1",
      "profile-1",
      "drinking-window",
      "The drinking window seems several years too late.",
      "https://example.com/tasting-note",
      { rpc },
    )

    expect(rpc).toHaveBeenCalledWith("request_enrichment_profile_review", {
      p_category: "drinking-window",
      p_comment: "The drinking window seems several years too late.",
      p_evidence_url: "https://example.com/tasting-note",
      p_household_id: "household-1",
      p_profile_id: "profile-1",
      p_wine_id: "wine-1",
    })
  })

  it("keeps follow-up evidence in the reporter private thread", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: inboxResponse(), error: null })

    await addProfileReviewMessage(
      "household-1",
      "case-1",
      "A second bottle confirms the same observation.",
      "",
      { rpc },
    )
    await markProfileReviewSeen("household-1", "case-1", { rpc })

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "add_enrichment_profile_review_message",
      {
        p_case_id: "case-1",
        p_comment: "A second bottle confirms the same observation.",
        p_evidence_url: null,
        p_household_id: "household-1",
      },
    )
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "mark_enrichment_profile_review_seen",
      { p_case_id: "case-1", p_household_id: "household-1" },
    )
  })
})
