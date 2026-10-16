# Drinking-window publication preflight (step 2 of 6)

This change does **not** publish a shared reference or alter a cellar's
drinking-window advice. The database still rejects every transition from
`draft` to `active` or `superseded`. It adds one repeatable, service-only way to
inspect a complete draft before the curated seed and shadow comparison exist.

For a draft version, `drinking_window_publication_issues(version_id)` combines
four existing diagnostics without weakening any of them:

| Check | What it catches |
| --- | --- |
| `structure` | Empty version, bad identities or hierarchy, overlapping rows or memberships, missing date/group evidence, source rights or contradiction. |
| `eligibility` | Incorrect ageing-group identity, place anchoring, producer or place mismatch, overlapping eligibility. |
| `evidence_fit` | Supporting evidence whose type, scope, place, producer, wine, colour, or vintage does not fit the claim. |
| `review` | Missing or stale approvals, suspended curators, current disagreements. |

`record_drinking_window_publication_preflight(version_id)` saves the issue list
and a SHA-256 fingerprint of the draft, linked evidence and source policies,
and curator decisions/grants in an append-only private audit table. It returns
the record ID, fingerprint and issue count. The fingerprint changes if any of
those direct inputs changes, so an old zero-issue record cannot stand in for a
new check. It is still only a snapshot: canonical identity hierarchy or source
metadata may change, and a future publisher must rerun *all* gates against the
live state in its own transaction. No preflight is an approval by itself.

## Remaining publication gates

1. Curate and approve the first complete three-milestone rows, memberships,
   and evidence. Incomplete workbook min/max pairs remain candidates.
2. Compare the proposed result with current household advice in shadow mode,
   including every changed window, and obtain explicit review of that report.
3. Only then add a trusted, atomic publisher. It must verify a fresh zero-issue
   preflight, the shadow approval for the **same fingerprint**, and the live
   diagnostics again before switching the active version. Published rows and
   memberships must remain immutable.
4. Rollback must create and review a **new** version carrying the former
   approved content, then use the same gates and atomic switch. Never edit a
   superseded version or silently revert household manual windows.

Only the service role can invoke the preflight RPCs. No browser, household,
PowerSync, or worker reader is granted access by this step.
