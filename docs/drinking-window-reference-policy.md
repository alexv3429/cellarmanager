# Drinking-window reference policy (design proposal)

This specifies a proposed reference-first selection of *drinking-window dates*,
with the current additive maturity model retained only as a labelled,
four-date fallback when no complete reviewed reference matches. It is not
deployed and does not change current advice. The workbook audit and
migration gaps are in
[`drinking-window-source-audit.md`](drinking-window-source-audit.md). The
database, import, contribution, and rollout contract is in
[`drinking-window-implementation-plan.md`](drinking-window-implementation-plan.md).

## Decision and scope

The four years are four **milestones**, not a four-year duration. For one wine,
use the first **complete, reviewed four-milestone window** in this order:

| Priority | Required identity | Source scope |
| --- | --- | --- |
| 0 | Household wine | Explicit manual four-date window |
| 1 | Producer, cuvée, appellation, region, colour, vintage | Exact release |
| 2 | Producer, appellation, region, colour, vintage | Producer within appellation |
| 3 | Appellation, region, colour, vintage | Appellation |
| 4 | Region, colour, vintage | Region |
| 5 | No reviewed row at levels 1–4 | Current hierarchical estimate, if safely available |

At levels 2–4, a broad row must also be applicable to the wine's **reviewed
ageing group** when the scope contains materially different styles. This is
an eligibility condition within each level, not another fallback level. The
producer → appellation → region order remains unchanged. A row for one group
cannot match another, even when producer, appellation, region, colour, and
vintage otherwise agree.

At level 5, show **estimated by the maturity model**, not a reviewed reference
match. If the model cannot calculate safely either, show **no window** and the
reason. Never combine milestones from different rows or mix reference and
model years. A
broader row must be explicitly authored at that scope; omitting a dimension in
the lookup must not turn a narrower row into a generic one. Colour, vintage and
region are never dropped or substituted. In particular, neither another
region's vintage nor a white-wine profile can stand in for a missing red-wine
profile.

## Ageing groups and vintage effects

The workbook's `standard`/`premium` split was a useful spreadsheet shortcut,
but neither value is a universal property of a wine. A legal classification
such as village, Premier Cru, or Grand Cru can distinguish wines within a
region. Elsewhere, a reviewed cuvée's structure or intended style may be the
relevant distinction even when there is no comparable legal classification.
Do not infer that distinction from price, a producer's reputation, an
unverified label phrase, or the workbook's `x` alone. Do not create a second
group merely to restate a classification already captured by a canonical
appellation; groups describe distinctions that remain at the chosen scope.

The shared library therefore needs **local, reviewed ageing groups** with
explicit definitions and applicability. A group may be based on a canonical
appellation/classification or on reviewed product/cuvée facts; its membership
may be limited to particular vintages when the wine or producer changes. For
example, a Bourgogne regional fallback might distinguish village and Grand
Cru, while a Languedoc fallback might distinguish an early-drinking cuvée
from a structured, cellar-worthy one. These are examples of *different local
taxonomies*, not a single global ranking called `premium`.

Each broader profile records its group (or an explicitly reviewed
`all-at-this-scope` applicability). Group membership must be established for
the wine before that row can match. Overlapping groups at the same lookup
level and key are a publication conflict. If the wine's group is unknown, do
not guess or silently choose the `standard` row; continue to a genuinely
applicable broader row, or use the labelled model estimate. An unrestricted
regional row needs evidence that it is safe across the materially different
styles in that region; it is not the default.

The window is specific to **vintage × colour × ageing group**, and potentially
to the producer, appellation, and cuvée above it. Publish four explicit
absolute calendar years for each reviewed combination: start tasting, likely
best start, likely best end, and preferably drink by. A 2022 red row may be much later than a
2021 red row, while 2022 white may be earlier than 2021 white. Do not impose a
fixed `vintage + N` rule, a monotonic order across vintages, or the same
vintage adjustment across colours. Converting an individual workbook row's
vintage-specific age offsets to calendar years is a data representation step,
not permission to reuse those offsets for other years.

## Model fallback and presentation

The current model starts with a reviewed regional *age-range baseline*, then
adds applicable appellation/climat, vintage, producer-era, cuvée, and
exact-release adjustments. It calculates four dates: first assessment, likely
best start/end, and preferably drink by. It is an estimate assembled from
multiple reviewed components, **not** a lookup of one source's start/end pair.
It requires a vintage and a compatible reviewed place/colour, and may itself
return `needs-review`. It does not use the old Excel's unrelated-region
substitutions. These properties are documented in
[`maturity-projections.md`](maturity-projections.md) and
[`maturity-hierarchy-poc.md`](maturity-hierarchy-poc.md).

A selected reference row supplies all **four explicit years** as one reviewed
window: start tasting, likely best start, likely best end, and preferably drink
by. The last date means prioritize or reassess, not that the wine expires.
The shared reference database stores these four years directly. Neither the
current model nor a fixed offset fills missing years in a selected row at
resolution time. A workbook min/max pair is therefore an **unpublished
candidate** until its outer years have been researched, entered, and approved
as part of one coherent four-milestone record. Curators may consult the model as
context, but its output is not evidence or an automatic publication value.

When no complete published reference matches, the current model may supply
its **own four-date result** under its existing safety checks. All four dates
are then labelled as one model estimate. Existing complete four-date
household overrides remain fully manual. During migration, a two-date manual
pair remains a private draft or legacy record for owner review; it must not
be spliced into either the shared reference or model result. The interface
and exports identify the selected whole-window source (`manual`, `reviewed
reference`, `model estimate`, or `unavailable`) and its version. Pairing,
storage, and structure estimates are outside this date-selection decision.

## Identity and validation

- Match canonical IDs, not OCR text or fuzzy similarity. Verified aliases may
  establish IDs upstream, retaining the raw label and the alias decision. An
  ambiguous producer or cuvée cannot activate a producer-level row. If the
  remaining appellation and region are confirmed, the lower levels can still
  be considered.
- A wine needs a confirmed integer vintage, colour, and region. A reviewed
  appellation-to-region relationship may supply a missing region, with that
  derivation recorded. If a stored appellation and region contradict each
  other, stop for data review instead of using either as a fallback. A missing
  appellation may still use a confirmed region row.
- Profiles have an explicit scope (`release`, `producer_appellation`,
  `appellation`, `region`). Fields excluded by that scope are null, not
  wildcards. Broader rows also have explicit, non-overlapping applicability
  groups. A published version has at most one active row per scope, full key,
  and applicable group. Multiple matching rows or contradictory evidence
  require review; the resolver must not take the first row or silently fall
  to a broader tier.
- All four years are present as integers in one approved record, ordered
  `vintage <= first_trial_year <= best_start_year <= best_end_year <= drink_by_year`.
  An absent, reversed, or implausible milestone cannot be
  published. The central workbook pair retains its one-source provenance;
  research for the two outer years is separately attributable, then all four
  are approved together. A different vintage cannot be extrapolated from a
  known one. Importing two workbook years never asserts the outer two.
- A new effective manual window is an explicit four-date household-wine
  instruction; an existing four-date override remains one complete manual
  instruction. A partial edit or historical two-year pair is a private draft
  to complete or clear, never a licence to combine manual and shared years.
  The currently selected reference or model result can remain visible while
  that draft is incomplete. Clearing the manual window restores the current
  non-manual result; publication never overwrites a manual window.
- A deliberately blocked scope (for example a known misidentification) stops
  lookup with a review reason and does not activate the model fallback. It is
  distinct from simply having no profile. A contradictory wine identity also
  blocks the fallback; an absent reviewed row does not.
- The model may supply a **whole four-date estimate** only when levels 1–4 have
  **no published matching row**. An unpublished incomplete or disputed candidate
  does not block it. A duplicated/invalid published key is a data-integrity
  failure, not a normal miss: stop and flag it rather than hiding it with the
  model.
  A deliberately blocked scope also stops it. Otherwise the model must pass
  its own vintage/place/colour checks and the new appellation-region
  consistency check. When the model is selected, its four-date projection is
  retained as one result. When a reference is selected, all four years come
  from that reference row; no model gaps are applied.

## Reference examples

The names and windows below are synthetic test fixtures, not cellar data or
published advice. A window is written `first trial / best start–best end / drink by`.
All examples use confirmed region `R1`, colour `white`,
vintage `2020`, and reviewed ageing group `G1` unless a row says otherwise.
Published rows are:

| ID | Scope | Key additions | Applicability | Window |
| --- | --- | --- | --- | --- |
| E | Release | P1 + C1 + A1 | Exact release | 2024 / 2026–2034 / 2037 |
| P | Producer within appellation | P1 + A1 | G1 | 2023 / 2025–2031 / 2034 |
| A | Appellation | A1 | G1 | 2022 / 2024–2030 / 2032 |
| R | Region | R1 | G1 | 2021 / 2023–2028 / 2030 |

| Wine or condition | Result | Why |
| --- | --- | --- |
| P1, C1, A1; complete manual 2025 / 2027–2030 / 2033 | 2025 / 2027–2030 / 2033, manual | The whole manual window wins. |
| P1, C1, A1; no manual | 2024 / 2026–2034 / 2037, E | All six identity dimensions match. |
| P1, C2, A1 | 2023 / 2025–2031 / 2034, P | E is not a cuvée wildcard. |
| P2, C1, A1 | 2022 / 2024–2030 / 2032, A | Same cuvée text does not transfer P1's window. |
| P2, C2, A2, with R1 confirmed | 2021 / 2023–2028 / 2030, R | Only the explicit regional row applies. |
| Same wine, but red | No reviewed row; try a valid red model estimate | Colour is never substituted. |
| Same wine, but 2019 | No reviewed row unless a 2019 row exists; try a valid 2019 model estimate | Vintage is never extrapolated from 2020. |
| P1, C1, A1; manual best start 2027 only | 2024 / 2026–2034 / 2037, E, with manual draft flagged | No mixed-source window. |
| A1 recorded under a contradictory region | Review required | Do not hide the identity conflict behind R. |
| Two conflicting E rows for the same key | Review required | No arbitrary winner or quiet fallback to P. |
| P2, C2, A3, R2 with no reference rows; model says 2025 / 2027–2032 / 2035 | 2025 / 2027–2032 / 2035, labelled model estimate | A safe estimate is useful, but is not a reference match. |
| Same wine; model has no compatible place/colour | No window | Neither method can assess it safely. |

The next fixtures test broader-group and vintage rules. Their windows are
illustrative only; they are not claims about Bourgogne or Languedoc:

| Candidate broad row | Four-year window | Wine | Result |
| --- | --- | --- | --- |
| Bourgogne, red, 2021, village | 2022 / 2023–2027 / 2029 | Confirmed village red 2021 | Match only this row. |
| Bourgogne, red, 2022, village | 2026 / 2029–2036 / 2039 | Confirmed village red 2022 | Match its own 2022 row; no fixed age offset. |
| Bourgogne, red, 2021, Grand Cru | 2025 / 2028–2040 / 2044 | Confirmed Grand Cru red 2021 | Never use the village row. |
| Bourgogne, white, 2021, village | 2024 / 2027–2035 / 2038 | Confirmed village white 2021 | Match its own white 2021 row. |
| Bourgogne, white, 2022, village | 2023 / 2024–2030 / 2032 | Confirmed village white 2022 | It may be earlier than white 2021. |
| P1 + A1, red, 2022, early-drinking | 2023 / 2024–2028 / 2030 | P1's reviewed easy-drinking cuvée 2022 | Match only its producer-appellation group. |
| P1 + A1, red, 2022, structured | 2025 / 2028–2037 / 2040 | P1's reviewed cellar-worthy cuvée 2022 | Same producer and appellation, different window. |
| Languedoc, red, 2022, early-drinking | 2023 / 2024–2027 / 2029 | Confirmed structured cuvée 2022 | No match; seek a structured row or model estimate. |
| Languedoc, red, 2022, structured | 2025 / 2028–2036 / 2039 | Same structured cuvée 2022 | Match this complete window. |
| Any group-specific regional row | Any | Wine with no confirmed ageing group | No group match; do not assume `standard`. |

The four-milestone boundary also needs fixed acceptance examples. All years
below are synthetic. A 2022 candidate holding only workbook best years
`2028–2036` is **not publishable**. If no other published row matches, a safe
model result `2024 / 2027–2032 / 2035` appears in full as a labelled
estimate. After a curator researches and approves `2025 / 2028–2036 / 2039`
as one row, that complete reference appears in full instead. If the model is
unavailable before publication, show no window, not
`— / 2028–2036 / —`. A missing outer year in any proposed row fails
publication; runtime resolution never fills it.

## Shared record and publication contract

Each candidate should retain canonical identity IDs, scope, reviewed ageing
group and applicability rule, colour, vintage, all supplied absolute years,
origin (workbook sheet/cell or external source), author, evidence pointers,
rationale, source-rights decision, review decision, and knowledge version. A
candidate may be incomplete; a published row must have all four years,
their provenance, and one explicit approval of the coherent window. The
model projection/version used for an effective fallback is retained
separately from any reference row. A row's exact key and four years are
immutable after publication; a correction creates a new version. The version and row ID used
for a displayed result remain inspectable even after supersession.

The contribution path is:

1. A user or researcher proposes a **candidate**, optionally prompted by a
   missing-reference count or a challenged result. Household manual windows
   and tasting notes stay private; they never auto-populate shared candidates.
2. Validate canonical identities, appellation-region consistency, exact scope,
   ageing-group definition and membership, colour, vintage, four complete years,
   overlapping/duplicate keys, and evidence/rights for cross-household reuse.
   Keep source text or URLs as pointers where copying is
   not licensed. A historical workbook row is evidence to review, not an
   automatically published global fact.
3. An eligible curator reviews the complete window and its applicability,
   including disagreements with existing rows. A conflict or unresolved disagreement
   blocks publication. Record decisions and rationale. Where possible, a
   different curator from the proposer should approve a global change.
4. Build an immutable draft library version, run the reference fixtures and a
   private aggregate coverage/changed-window comparison, then publish
   atomically through the trusted service. Recompute affected wines without
   touching their stored facts or manual windows. Retain the prior version for
   explanation and rollback.
5. Track missing keys, contested rows, source age, coverage by lookup level,
   and manual corrections as *review demand*. Prioritize by affected bottles
   and households without exposing private wine lists to curators.

This can reuse the existing reviewed-source, curator, immutable-version, and
private-report boundaries in [`enrichment-knowledge-schema.md`](enrichment-knowledge-schema.md)
and [`profile-revision-governance.md`](profile-revision-governance.md), but the
four-milestone and exact-key constraints need their own schema and tests. The
current additive profiles are not silently converted into these rows.

## Rollout gate

Before changing a visible window, implement and test the exact-key selector,
reviewed ageing-group eligibility and vintage-specific four-milestone rows,
complete manual override, conflict handling, version provenance,
whole-window source labels, labelled model fallback, and no-result state.
Preserve existing four-date manual overrides as effective instructions until
an owner-reviewed migration to the new four-milestone editor exists; do not
silently shorten or reinterpret them. Stage and review
source rows first. Run the selector in shadow mode
against current wines, inspect changed and newly unassessed cases with the
owner, then deploy behind a reversible version switch. Historical projections
remain labelled as estimates or archived; they are not retroactively relabelled
as reviewed reference windows.
