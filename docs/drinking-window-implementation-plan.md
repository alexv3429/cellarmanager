# Drinking-window reference implementation plan

This is the implementation contract for the proposed
[`reference-first policy`](drinking-window-reference-policy.md). It describes
how the owner's workbook becomes reviewed, shareable reference data and how
other households can improve that data. The first migration adds only
service-private draft storage; it cannot publish or resolve advice. Existing
maturity advice remains unchanged until the rollout gates below pass.

## Keep the three kinds of data separate

| Data | Owner and storage | Effect |
| --- | --- | --- |
| Household wine facts and complete manual dates | Private to the household | Describe that household's wine and override its displayed dates. |
| Proposed reference row or ageing-group membership | Service-managed review queue | May be discussed and corrected; never changes advice directly. |
| Published reference version | Shared, service-managed, immutable | May supply an explicit four-milestone window to any household with a matching wine. |

The shared library stores *normalized claims*, not copies of household wine
records or the workbook. A cellar location, bottle count, purchase price,
personal note, and the original spreadsheet do not enter the shared library.
The workbook's owner must review which of its normalized rows may be proposed
for cross-household use, and source-rights checks still apply before
publication. No private manual date or tasting observation is promoted merely
because another household could benefit from it.

## Shared format

Add a dedicated, versioned four-milestone library rather than inserting these rows into
the existing `enrichment_profiles`: those profiles are additive components of
the four-date maturity model, not complete reference windows. Use existing
`wine_reference_producers`, `wine_reference_products`,
`wine_reference_releases`, `enrichment_places`, source policies, evidence, and
curator eligibility where their meanings fit. New storage needs four parts:

1. `drinking_window_reference_versions`: draft/active/superseded lifecycle,
   content hash, publication date, and one active version. Rows and their
   applicability are immutable after publication.
2. `drinking_window_reference_rows`: one reviewed **four-milestone window** with
   required integer `first_trial_year`, `best_start_year`, `best_end_year`,
   and `drink_by_year`; its scope (`release`, `producer_appellation`,
   `appellation`, or `region`), canonical IDs required
   by that scope, region, colour, vintage, applicability group (or expressly
   reviewed `all-at-this-scope`), evidence,
   rationale, source pointer, and version. Exact-release rows also retain the
   canonical product/cuvée and release identity. The foundation database
   requires all four years, scope shape, and ordering; publication validation
   will also confirm the canonical hierarchy and
   `vintage <= first_trial_year <= best_start_year <= best_end_year <= drink_by_year`.
   Evidence for the central pair and researched outer years
   remains attributable; one curator approves the complete window. No date
   is calculated at runtime from another date or the current model.
3. `drinking_window_ageing_groups` and versioned memberships: locally defined
   groups, their scope and colour, evidence-backed definition, and the
   canonical appellations/products/releases eligible for each group. A
   membership can have an explicit vintage interval. The same wine can belong
   to a different relevant group at regional and producer-appellation scope;
   a group name is never treated as a global ranking. Unknown membership does
   not imply `standard`.
4. `drinking_window_candidates` and decision/audit records: staged import
   rows, household proposals, duplicate/conflict links, source-rights and
   curator decisions. Candidates are not published rows.

Use constraints and publication-time validation to reject incomplete windows,
duplicate keys, overlapping applicable groups, conflicting memberships,
unreviewed evidence, and an `all-at-this-scope` row that overlaps a more
specific row at the same lookup key. Excluded identity fields must be null for
that scope, not wildcards. The row and its group memberships publish in the
*same* version so changing an eligibility decision cannot silently change an
older version's meaning.

For example, a published regional row has this logical shape (IDs are
illustrative):

```json
{
  "scope": "region",
  "region_id": "R1",
  "color": "red",
  "vintage": 2022,
  "ageing_group_id": "R1-red-structured",
  "first_trial_year": 2025,
  "best_start_year": 2028,
  "best_end_year": 2036,
  "drink_by_year": 2039,
  "evidence_ids": ["reviewed-source-1", "reviewed-source-2"]
}
```

The group itself has a documented definition and reviewed membership; the
string `structured` alone does not classify a wine. Years in this example are
synthetic, not drinking advice.

## Translate the workbook with a repeatable, read-only importer

The first importer runs against a snapshot of `Caves_2.0.xlsx` locally. It
records the file hash, sheet, row, and source-cell coordinates for every
candidate, emits a review report, and leaves the source file unchanged. It
does **not** publish or change household advice. The aggregate counts and
known gaps to reconcile are in
[`drinking-window-source-audit.md`](drinking-window-source-audit.md).

| Workbook source | Staged translation | Review before publication |
| --- | --- | --- |
| Producer sheets `A:F`: vintage, cuvée, appellation, colour, start, end | Complete cuvée rows become exact-release **two-year candidates**; blank-cuvée/appellation-present rows become producer-appellation candidates. Keep the two years together. Leave `first_trial_year` and `drink_by_year` empty in staging. | Resolve producer, product, appellation, region, colour, release and evidence to canonical IDs; research and review both outer years. Reject ambiguous aliases. |
| `Millesimes!A:O`: region, colour, vintage; `L:M` standard and `N:O` premium age offsets | Fill down the sheet's displayed region/colour headings as the old formula did. For each complete pair, calculate `best_start_year = vintage + start_offset` and `best_end_year = vintage + end_offset`. Stage **two distinct regional candidates**, retaining their historical bin and cell provenance. Leave outer years empty. | Define local ageing groups and prove which wines each bin can apply to; research and review both outer years. Neither bin publishes as a default. Blank or invalid offsets remain unavailable. |
| `Cave!M:N`: manual start/end | Stage privately against that household wine as an incomplete four-date draft only. | Review and complete or clear with the owner. Never share them as reference rows or silently make them effective manual overrides. |
| `Cave!O`: historical `x` | Keep as a private classification-review hint. | It cannot establish a shared ageing group by itself. |
| Producer-only rows and missing appellation-tier rows | Quarantine producer-only rows; report missing appellation profiles as gaps. | No invented scope or pair; source and review work must fill the gaps. |

Normalize text only to *suggest* canonical identity matches. A verified alias
or explicit curator decision must establish the identity; fuzzy text, OCR,
and the Excel region proxies do not. Rosé stays rosé. Do not borrow an Italian
or Rhône wine's window from Languedoc, or derive an absent vintage from a
nearby year. The import report must reconcile the observed candidate and
quarantine counts, list each unresolved mapping and overlap, and support a
dry-run repeat with the same input hash and same normalized output. Import is
idempotent by source snapshot and cell coordinates, without creating duplicate
published claims. For the audited snapshot, the dry-run test must reconcile
19 complete exact-release candidates, 60 complete producer-appellation
candidates, 71 standard and 71 premium regional pairs, five producer-only
rows, two start-only producer rows, and two regional rows with no pair.

The workbook's two years map to **likely best start** and **likely best end**,
not to start tasting and drink by. Their source provenance remains attached
to both years. As the workbook has no outer years, its rows alone produce
**zero publishable four-milestone references**. The candidate reviewer must supply
attributable evidence and explicit values for both missing years, confirm the
whole ordered window, and only then publish. The current model may be shown
as comparison context during review, but cannot auto-fill those fields.

## Resolve a wine and show why

The server first resolves whichever identity fields it can confirm. It only
considers a scope when that scope's required IDs, region, colour, and vintage
are confirmed. At each scope it checks the identity key and applicable
reviewed group. It takes one complete four-milestone row from the highest
matching scope. A missing group skips only rows
that require that group; a contradictory identity, duplicate published match,
or explicit block stops with a review reason. If no reference row matches,
the current maturity model may provide its own complete, clearly labelled
four-date estimate under its own validity checks. A complete manual household
window wins without modifying the shared row. The existing four-date
`wine_maturity_overrides` remain effective until the owner explicitly accepts
any editor migration. Historical two-date manual pairs remain private drafts;
they cannot be mixed with another source or silently made effective.

Store the selected source type, scope, row ID, reference-version ID, all four
explicit years, whole-window provenance and the model projection ID/version
only when the model is selected, input
fingerprint, and no-match/review reason in a household-scoped resolution.
Keep the current model projection
separately for its four-date estimate and storage guidance. Expose the
effective window and its explanation through a narrow household-authorized
RPC; do not expose the service's global candidate queue or another household's
data to browsers or PowerSync. A reference publication requeues affected resolutions using the
existing demand/job pattern. A wine edit invalidates a stale resolution by
input fingerprint; old advice remains attributable to its old version.

## How other households improve the library

On a wine card, offer **Suggest a correction or source** beside the displayed
window and its explanation. A member can propose a missing four-date window,
challenge an existing milestone, supply evidence for a missing year in an
unpublished candidate, or identify the correct ageing group. The form
shows the canonical identity and proposed scope, asks for all four years (or
allows an incomplete draft that cannot be published) and a
reason/source link, and explicitly distinguishes **save only for my cellar**
from **propose for the shared library**. A private adjustment works
immediately for that household; a shared proposal does not.

The service verifies the submitter's membership and the wine's current
identity. It keeps any submitter/household routing data private and excludes
household, bottle, location, price, and private-note fields from the shared
candidate and curator view. It deduplicates proposals by stable canonical
subject and vintage/group key. Curators see normalized claims, evidence pointers,
conflicts, and aggregate demand—not another household's cellar. They can
approve, dispute, request clarification, or reject a proposal. The source
rights and independent review rules from the existing enrichment governance
apply, but its current profile-revision workflow cannot be reused unchanged:
new absolute four-date row types and ageing-group membership need their own
validation and review UI. Popularity, an isolated tasting note, or an AI
suggestion does not publish a global window.

An approved change clones the active reference version, adds or supersedes
the reviewed rows and memberships, validates the whole candidate version,
previews affected wines and changed dates, then atomically activates it.
Households receive the new shared reference without re-entering wines; manual
overrides stay untouched. Preserve the old version, reviewer decision, source
pointer, and changed-window explanation for audit and rollback.
Rollback publishes a new version with the previously approved content rather
than mutating an immutable historical version.

## Delivery order and release gate

1. **Inert foundation:** add draft reference versions, four-required-year
   rows, local group definitions, candidate staging, and database tests.
   Publication remains blocked; no visible advice changes. Next add the
   read-only workbook converter, import report, rights checks, group
   memberships, evidence links, and full publication validation.
2. **Curate the seed:** resolve identities and region/colour mappings, define
   ageing groups and memberships, review source pairs, research and approve
   all four years per row, and fill missing appellation/region coverage where
   evidence exists. Publish nothing that still lacks a milestone or
   classification decision.
3. **Selector in shadow mode:** calculate a reference result beside the
   current model for the owner's cellar. Compare coverage and every changed
   date; test manual precedence, group eligibility, vintage/colour separation,
   four-milestone order and whole-window provenance, missing data, conflicts, and
   fallback. Do not replace the visible window.
4. **Household view and contributions:** show the whole-window source and
   its four explicit years, add private versus shared
   proposal actions, and test cross-household
   isolation and curator publication. Release behind a reversible switch
   after the owner reviews the shadow report.

The first success measure is not the number of imported rows. It is the
number of current wines with a *defensible* complete four-milestone reference, plus an
explicit explanation for every model estimate or unavailable result.
