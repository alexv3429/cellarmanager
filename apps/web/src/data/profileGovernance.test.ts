import { describe, expect, it, vi } from "vitest"

import {
  dismissProfileReviewCase,
  getProfileGovernanceInbox,
  parseProfileGovernanceInbox,
  proposeProfileRevision,
  reviewProfileRevision,
} from "./profileGovernance"

function snapshot(acidity = 1) {
  return {
    confidence: 0.8,
    created_at: "2026-08-30T10:00:00Z",
    evidence: [{
      claim_type: "producer-style",
      reviewed_at: "2026-08-30T10:00:00Z",
      role: "supports",
      url: "https://example.com/profile",
    }],
    knowledge_version: {
      content_sha256: "abc",
      id: "version-1",
      label: "Reviewed library",
      number: 18,
      published_at: "2026-08-30T10:00:00Z",
      status: "active",
    },
    profile_id: "profile-1",
    profile_type: "producer-era",
    rationale: "A restrained producer style supported by reviewed evidence.",
    reviewed_at: "2026-08-30T10:00:00Z",
    reviewed_by: "reviewer-1",
    typed: {
      acidity_adjustment: acidity,
      first_trial_age_adjustment: 1,
      producer_id: "producer-1",
    },
  }
}

function inboxResponse() {
  return {
    curator: {
      display_name: "Alice",
      eligible: true,
      granted_at: "2026-08-31T08:00:00Z",
      granted_by: "migration:0.4.18",
      profile_scopes: ["producer-era"],
      rationale: "Founding curator with previously reviewed profiles.",
      status: "active",
    },
    items: [{
      case_id: "case-1",
      current_profile: snapshot(),
      events: [{
        actor: "Alice",
        detail: { proposal_sha256: "hash" },
        occurred_at: "2026-08-31T09:00:00Z",
        type: "revision-proposed",
      }],
      opened_at: "2026-08-30T09:00:00Z",
      profile_type: "producer-era",
      reporter_count: 2,
      reports: [{
        comment: "The acidity adjustment should be higher.",
        created_at: "2026-08-30T09:00:00Z",
        evidence_url: "https://example.com/note",
        kind: "wine-style",
      }],
      resolution_summary: null,
      resolved_at: null,
      revisions: [{
        decisions: [{
          curator: "Bob",
          decided_at: "2026-08-31T09:05:00Z",
          evidence_urls: [],
          id: "decision-1",
          rationale: "The change matches the cited producer evidence.",
          verdict: "approve",
        }],
        evidence_urls: ["https://example.com/profile"],
        id: "revision-1",
        predecessor_profile: snapshot(),
        proposal: {
          confidence: 0.85,
          profile_type: "producer-era",
          rationale: "The reviewed evidence supports a fresher structural profile.",
          typed: { ...snapshot().typed, acidity_adjustment: 1.5 },
        },
        proposal_sha256: "0".repeat(64),
        proposed_at: "2026-08-31T09:00:00Z",
        proposed_by: "Alice",
        published_at: null,
        published_profile: null,
        status: "approved",
        superseded_at: null,
      }],
      status: "reviewing",
      subject: { producer: "Domaine Example" },
      subject_key: "producer-era:producer-1:1990:2200:red",
      subject_title: "Domaine Example · red · 1990–present",
      updated_at: "2026-08-31T09:05:00Z",
    }],
    status: "available",
  }
}

describe("shared profile governance boundary", () => {
  it("parses curator eligibility, anonymized reports, diffs, and decisions", () => {
    expect(parseProfileGovernanceInbox(inboxResponse())).toMatchObject({
      curator: { eligible: true, displayName: "Alice" },
      items: [{
        reporterCount: 2,
        reports: [{ kind: "wine-style" }],
        revisions: [{
          status: "approved",
          proposal: { typed: { acidity_adjustment: 1.5 } },
          decisions: [{ curator: "Bob", verdict: "approve" }],
        }],
      }],
    })
  })

  it("keeps the governance screen hidden for unassigned accounts", () => {
    expect(parseProfileGovernanceInbox({
      curator: { eligible: false, status: "unassigned" },
      items: [],
      status: "available",
    })).toMatchObject({
      curator: { eligible: false, profileScopes: [] },
      items: [],
    })
  })

  it("rejects malformed profile types and reporter counts", () => {
    const malformed = inboxResponse()
    malformed.items[0].profile_type = "pairing"
    expect(() => parseProfileGovernanceInbox(malformed)).toThrow("profile type is invalid")

    const noReporters = inboxResponse()
    noReporters.items[0].reporter_count = 0
    expect(() => parseProfileGovernanceInbox(noReporters)).toThrow("must be positive")
  })

  it("uses only RPC boundaries for proposals, decisions, dismissal, and refresh", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: inboxResponse(), error: null })
      .mockResolvedValue({ data: { status: "ok" }, error: null })

    await getProfileGovernanceInbox({ rpc })
    await proposeProfileRevision("case-1", {
      confidence: 0.85,
      profileType: "producer-era",
      rationale: "The reviewed evidence supports a fresher structural profile.",
      typed: { ...snapshot().typed, acidity_adjustment: 1.5 },
    }, ["https://example.com/profile"], { rpc })
    await reviewProfileRevision(
      "revision-1",
      "disagree",
      "The source describes another era and cannot support this change.",
      [],
      { rpc },
    )
    await dismissProfileReviewCase(
      "case-1",
      "The active profile already reflects the reported source accurately.",
      [],
      { rpc },
    )

    expect(rpc).toHaveBeenNthCalledWith(1, "get_enrichment_profile_governance_inbox", {})
    expect(rpc).toHaveBeenNthCalledWith(2, "propose_enrichment_profile_revision", {
      p_case_id: "case-1",
      p_evidence_urls: ["https://example.com/profile"],
      p_proposal: expect.objectContaining({ profile_type: "producer-era" }),
    })
    expect(rpc).toHaveBeenNthCalledWith(3, "review_enrichment_profile_revision", {
      p_evidence_urls: [],
      p_rationale: "The source describes another era and cannot support this change.",
      p_revision_id: "revision-1",
      p_verdict: "disagree",
    })
    expect(rpc).toHaveBeenNthCalledWith(4, "dismiss_enrichment_profile_review_case", {
      p_case_id: "case-1",
      p_evidence_urls: [],
      p_rationale: "The active profile already reflects the reported source accurately.",
    })
  })
})
