import { describe, expect, it, vi } from "vitest"

import {
  confirmEnrichmentResearchProducerIdentity,
  enrichmentResearchCurationAction,
  findEnrichmentResearchForCurationItem,
  getEnrichmentResearchProducerCandidates,
  parseEnrichmentResearchInbox,
  parseEnrichmentResearchProducerCandidates,
  partitionEnrichmentResearchItems,
  requestEnrichmentResearch,
  reviewEnrichmentResearchDraft,
  suggestEnrichmentResearchSource,
} from "./enrichmentResearch"

function inboxResponse() {
  return {
    items: [
      {
        case_id: "case-1",
        draft: {
          confidence: 0.74,
          created_at: "2026-08-27T15:10:00Z",
          id: "draft-1",
          proposal: {
            confidence: 0.74,
            profile_type: "producer-era",
            rationale: "Structured and cellar-worthy Morgon.",
          },
          proposal_kind: "profile",
          rationale: "Structured and cellar-worthy Morgon.",
          review: null,
          revision: 1,
          sources: [
            {
              attribution: "Domaine Jean-Marc Burgaud",
              name: "Domaine Jean-Marc Burgaud official site",
              retrieved_at: "2026-08-27T15:00:00Z",
              url: "https://jean-marc-burgaud.com/nos-vins",
            },
          ],
          synthesis_model: "test-model",
        },
        exemplar_wine_id: "wine-1",
        gap_type: "profile-producer",
        last_error_code: null,
        matching_wine_ids: ["wine-1", "wine-2"],
        notified_at: "2026-08-27T15:10:00Z",
        requested_at: "2026-08-27T15:00:00Z",
        seen_at: null,
        status: "draft-ready",
        subject: {
          appellation: "Morgon",
          area: "Beaujolais",
          color: "red",
          cuvee: "Côte du Py",
          producer: "Burgaud",
          title: "Producer profile: Burgaud · red",
          vintage: 2020,
        },
        subject_key: "producer-profile:producer-1:red",
        subject_type: "producer-profile",
        subscription_status: "open",
      },
    ],
    status: "available",
    unread_count: 1,
  }
}

describe("enrichment research inbox", () => {
  it("parses attributed draft proposals and unread state", () => {
    expect(parseEnrichmentResearchInbox(inboxResponse())).toMatchObject({
      unreadCount: 1,
      items: [
        {
          caseId: "case-1",
          exemplarWineId: "wine-1",
          matchingWineIds: ["wine-1", "wine-2"],
          status: "draft-ready",
          draft: {
            id: "draft-1",
            confidence: 0.74,
            sources: [
              {
                name: "Domaine Jean-Marc Burgaud official site",
                url: "https://jean-marc-burgaud.com/nos-vins",
              },
            ],
          },
        },
      ],
    })
  })

  it("rejects malformed or unbounded response values", () => {
    expect(() =>
      parseEnrichmentResearchInbox({ ...inboxResponse(), unread_count: -1 }),
    ).toThrow("cannot be negative")
    const malformed = inboxResponse()
    malformed.items[0].draft.confidence = 2
    expect(() => parseEnrichmentResearchInbox(malformed)).toThrow(
      "outside its allowed range",
    )
  })

  it("sends an idempotent household request contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: inboxResponse(), error: null })
    await requestEnrichmentResearch(
      "household-1",
      "wine-1",
      "profile-producer",
      9400,
      { rpc },
    )
    expect(rpc).toHaveBeenCalledWith("request_enrichment_research", {
      p_gap_type: "profile-producer",
      p_household_id: "household-1",
      p_priority: 9400,
      p_wine_id: "wine-1",
    })
  })

  it("parses and confirms producer-level identity candidates", async () => {
    const response = {
      candidates: [
        {
          canonical_name: "de Cazeneuve",
          examples: ["Chateau de Cazeneuve, Roc Mates, Languedoc"],
          producer_key: "de cazeneuve",
          score: 0.82,
        },
      ],
      status: "available",
    }
    expect(parseEnrichmentResearchProducerCandidates(response)).toEqual([
      {
        canonicalName: "de Cazeneuve",
        examples: ["Chateau de Cazeneuve, Roc Mates, Languedoc"],
        producerKey: "de cazeneuve",
        score: 0.82,
      },
    ])

    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: response, error: null })
      .mockResolvedValueOnce({ data: inboxResponse(), error: null })
    await getEnrichmentResearchProducerCandidates(
      "household-1",
      "case-1",
      { rpc },
    )
    await confirmEnrichmentResearchProducerIdentity(
      "household-1",
      "case-1",
      "de cazeneuve",
      { rpc },
    )
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "confirm_enrichment_research_producer_identity",
      {
        p_case_id: "case-1",
        p_household_id: "household-1",
        p_producer_key: "de cazeneuve",
      },
    )
  })

  it("submits an explicit owner edit instead of publishing it", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: inboxResponse(), error: null })
    const proposal = { profile_type: "producer-era", confidence: 0.7 }
    await reviewEnrichmentResearchDraft(
      "household-1",
      "draft-1",
      "edited",
      proposal,
      "Adjusted after visiting the producer.",
      { rpc },
    )
    expect(rpc).toHaveBeenCalledWith("review_enrichment_research_draft", {
      p_draft_id: "draft-1",
      p_household_id: "household-1",
      p_note: "Adjusted after visiting the producer.",
      p_proposal: proposal,
      p_verdict: "edited",
    })
  })

  it("submits an advanced source candidate without approving it in the browser", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: inboxResponse(), error: null })
    await suggestEnrichmentResearchSource(
      "household-1",
      "case-1",
      "https://example.com/domaine-profile",
      "technical",
      { rpc },
    )
    expect(rpc).toHaveBeenCalledWith("suggest_enrichment_research_source", {
      p_case_id: "case-1",
      p_household_id: "household-1",
      p_source_kind: "technical",
      p_source_url: "https://example.com/domaine-profile",
    })
  })

  it("connects curation actions to the existing research lifecycle", () => {
    const inbox = parseEnrichmentResearchInbox(inboxResponse())
    const item = findEnrichmentResearchForCurationItem(
      inbox,
      "profile-producer",
      ["wine-9", "wine-2"],
    )

    expect(enrichmentResearchCurationAction(item)).toEqual({
      kind: "open",
      label: "Review draft",
    })
    expect(
      enrichmentResearchCurationAction(
        item ? { ...item, status: "owner-reviewed" } : null,
      ),
    ).toEqual({ kind: "waiting", label: "Awaiting publication" })
    expect(
      enrichmentResearchCurationAction(
        item ? { ...item, status: "published" } : null,
      ),
    ).toEqual({ kind: "waiting", label: "Published" })
    expect(enrichmentResearchCurationAction(null)).toEqual({
      kind: "request",
      label: "Request research",
    })
  })

  it("separates published history from active research requests", () => {
    const inbox = parseEnrichmentResearchInbox(inboxResponse())
    const published = {
      ...inbox.items[0],
      caseId: "case-2",
      status: "published" as const,
      subscriptionStatus: "published" as const,
    }

    expect(partitionEnrichmentResearchItems([inbox.items[0], published])).toEqual({
      active: [inbox.items[0]],
      published: [published],
    })
  })
})
