# Drinking-window shadow review (step 5 of 6)

This adds an owner sign-off gate for a private, whole-cellar shadow report. It
does **not** publish a shared reference or change any displayed maturity
window. The previous batch comparator remains useful for diagnostics, but a
selected batch is never sufficient for approval.

The trusted service calls `record_drinking_window_shadow_report(version_id,
household_id)`. It snapshots every active wine in that household in bounded
250-wine chunks (up to 10,000 wines; larger cellars fail explicitly rather
than receiving a partial report). The immutable private report contains each
current and proposed three-date window, matching scope, status and deltas,
plus the draft fingerprint, issue count and a SHA-256 hash of the complete
comparison. A report with draft issues may be recorded for diagnosis, but
cannot be approved. Only the household owner can read it through
`get_drinking_window_shadow_report(report_id)`; no raw report table is
available to browser or service roles.

The owner calls `review_drinking_window_shadow_report(report_id,
expected_content_sha256, verdict, rationale)` to approve or reject. The
decision is append-only and tied to the exact report hash. Approval requires:

- a zero-issue draft and a recorded zero-issue preflight for the same draft
  fingerprint;
- a fresh recalculation of the **entire** household comparison with exactly
  the same content hash (including identities, model projections, overrides
  and proposed dates);
- no ambiguous or conflicting draft selector result for any household wine.

No-match and missing-key rows remain in the report: they retain the existing
model/no-advice fallback and must be considered by the owner, rather than
silently filled from a neighbouring vintage, colour or region. Manual
overrides remain protected. A rejected report needs no clean preflight, so
the owner can reject an incomplete proposal with a reason. The latest owner
decision supersedes an earlier one without erasing history.

This is an explicit human acknowledgement, not proof that someone carefully
read every row. The interface must present changed and uncovered wines clearly
before it offers approval. Step 6 must still recheck the latest owner decision,
report hash, full cellar snapshot, draft fingerprint, fresh preflight and live
publication diagnostics in the publisher transaction. If any input changes,
the old approval cannot be reused. The publisher remains blocked by the
existing database trigger in this PR.

No app UI is introduced here, so there is no phone test for this step. The
database tests cover incomplete drafts, cross-household privacy, explicit
hash-bound approval, staleness and the continued publication block. Real
owner review will be useful only after curated, fully evidenced reference
rows have been prepared.
