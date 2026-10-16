# Drinking-window delivery 1/6: review workspace

This slice is deliberately **draft-only**. It adds a curator panel in Catalogue
for pending owner requests for a missing shared wine identity and for historical
drinking-window candidates. It does not create a shared identity, publish a
reference, resolve a wine's window, change the maturity model, or change any
household wine or stock.

## Access and source boundary

- Only an active curator with the explicit `drinking-window` profile scope can
  open the workspace. An ordinary household owner or a curator of another
  profile type cannot see its private queues.
- The identity queue displays only the requested wine descriptors. It does
  not expose the household, requester, stock, price, or tasting notes. It flags
  requests whose underlying wine has changed since submission. Processing a
  request into a canonical shared identity belongs to a later delivery.
- The candidate queue displays the original workbook source locator, labels,
  historical dates, and quarantine reason. The imported candidate is not
  edited. Each curator save appends a separate review draft.
- A draft records a proposed match scope, the three years, ageing-category
  applicability note, rationale, HTTPS evidence links, source-rights status,
  and whether it needs research, is proposed as complete, or should be
  rejected. `Complete proposal` requires all three ordered years, at least one
  link, and a checked reuse-rights status. This is **not** publication approval.
- Saves compare against the latest review ID. A stale form must refresh before
  saving, preserving each curator's earlier record.

## Acceptance after migration

1. An account without the explicit `drinking-window` curator grant should see
   no review panel in Catalogue. Do not grant this authority to all owners.
2. A granted curator can see pending identity requests and staged candidates.
   If no candidates have been staged yet, the candidate list correctly says so.
3. Select a candidate, retain its original source labels and two existing
   dates, and save a `Needs research` draft with a rationale. The original
   candidate and visible wine advice remain unchanged.
4. A `Complete proposal` with a missing start-tasting year, missing source
   link, or unverified rights is rejected. A complete draft is still not
   displayed as shared advice.

The next delivery adds publication safeguards and canonical validation. The
following delivery curates and proposes the first approved reference set.
