# Drinking-window shadow comparison (step 4 of 6)

This is a **private diagnostic**, not a drinking-window rollout. The app still
shows the existing maturity model or a household's manual window. Draft
reference rows are not published or exposed to browser clients.

The service-only `drinking_window_shadow_compare(version_id, household_id,
wine_ids)` RPC compares up to 250 active wines in one household with one draft
version. It returns the draft fingerprint and current publication-issue count
on every row, the current effective three milestones, the draft three
milestones, all three year deltas, the matching scope and row, and a reason for
misses. A draft with outstanding evidence/review issues can be inspected for
diagnosis, but its results are **not** approval-ready. An empty or incomplete
draft must not be presented as a reliable new recommendation.

Canonical geography comes only from an exact, unique normalized place name or
reviewed alias. A cellar's `area` must resolve independently; the region is
not guessed from its appellation. Producer, cuvée and release IDs come only
from an existing linked shared wine identity. Free-text similarity never
creates a match. Missing or ambiguous identities remain visible in
`identity_status` and `draft_status`, which lets the owner fix local naming or
links without creating one PR per cellar wine. An absent producer link can
still match a genuinely applicable appellation/region row, but cannot match a
producer-specific row. Vintage and color are taken from the cellar wine;
the draft selector checks both and preserves its normal precedence and ageing
group eligibility.

`comparison_status` distinguishes `changed`, `unchanged`, `no_match`,
`missing_key`, `identity_conflict`, `ambiguous`, `new_reference_no_baseline`,
`expired_baseline`, and `manual_preserved`. A personal manual override always
wins in the existing app. The report shows it for context but never marks it
as a change to apply. Member-specific maturity calibration is not included:
this is a comparison of the household's stored projection, not of each
member's shifted view. The current model's fourth `drink_by_year` is also
deliberately outside the new three-milestone reference comparison.

The RPC saves nothing. An operator may export a private report for review,
but must protect its wine IDs and current windows as household data. The next
step must establish a reviewed, auditable report/approval tied to the same
draft fingerprint and full preflight; a fingerprint or zero issue count alone
must never activate a reference. If the draft, model projection, identity
links, or household windows change, rerun the comparison before approval.

No manual UI test is needed for this PR. Database tests exercise changed
dates, color mismatch, unresolved geography, manual precedence, private
access, and cross-household rejection. A real comparison becomes meaningful
only when curated three-date rows and their supporting evidence are entered.
