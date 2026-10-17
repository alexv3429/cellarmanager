# Drinking-window publication and runtime selection

This is the final **mechanism**, not the first data release. The workbook's
two-date pairs are still candidates: no real reference version is activated by
this migration. Existing wine advice remains unchanged until a complete,
curator-reviewed three-date version passes preflight, whole-cellar comparison,
owner approval, and trusted publication.

## Operating sequence

1. Curate canonical rows, their explicit ageing-group memberships, evidence
   links, and whole-window approvals in one draft version. Do not copy a
   neighbouring vintage or region to fill a gap.
2. Run `record_drinking_window_publication_preflight(version_id)` as the
   trusted service. It must record zero issues. Any subsequent draft/source
   change changes the fingerprint and requires a new preflight.
3. For **every** currently populated household, run
   `record_drinking_window_shadow_report(version_id, household_id)` as the
   trusted service. In Catalogue, the owner opens “Review a proposed
   drinking-window update”, compares current and proposed three-date windows,
   and explicitly approves or rejects the exact report with a reason. The
   report contains no shared write to their cellar. It is private to that
   household and includes all active wines, not only a sample.
4. Run `publish_drinking_window_reference(version_id)` as the trusted service.
   It locks the relevant reference, source, identity, and cellar tables while
   checking the current zero-issue gates, exact draft fingerprint, latest
   approval from a current owner of each populated household, and a fresh
   full-cellar comparison. A changed cellar, rejected report, missing owner
   review, or changed source rights blocks publication. The old version is
   superseded and the new version activated in the same transaction.

Only `service_role` can invoke publication or the emergency runtime switch;
browser users cannot set an active status directly. The publication hash and
event history persist. Reference rows, memberships, evidence links, and review
decisions cannot be edited after publication. To correct content or revert to
an earlier set of values, create and review a **new** version; do not revive or
mutate a superseded one.

## What readers choose

For a wine, the effective order is:

1. The complete household-maintained manual window, if one exists.
2. A unique applicable row from the enabled, published reference version:
   exact release; producer + appellation; producer + region; appellation;
   region. Canonical place and wine-reference IDs, exact colour and vintage,
   and reviewed group memberships control eligibility. A tie or contradictory
   identity stops reference advice for review; it does not silently choose a
   lower tier. A match supplies its three years as one unit.
3. If there is no applicable reference row, the existing model estimate under
   its existing checks. A draft candidate never blocks this fallback.
4. Otherwise the window is unavailable.

The card and catalogue label the source. The reference shows **start tasting /
probable start–end of the optimum**, with no invented expiry date. Manual and
legacy model windows retain their existing fourth “drink by” field until
separately migrated. The account's personal year-shift applies to model
estimates, not to a reviewed reference or a manual correction.

## Emergency rollback

`set_drinking_window_reference_enabled(false, expected_active_version_id,
reason)` immediately restores the prior model reader without changing shared
reference history. The switch is audited; re-enabling requires the exact
currently active version ID and a reason. A content rollback still requires
a new, fully reviewed version.

## Release check

The database test exercises direct-publication denial, preflight and owner
approval gates, source precedence, manual override, model/no-match fallback,
published-row immutability, and the emergency switch. The browser test/build
checks the source-labelled card and owner-review interface. Do not use a
synthetic test fixture as published advice. A real first publication needs a
separate curated-data review and a live shadow report for the owner.
