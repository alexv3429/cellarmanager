# Drinking-window reference implementation plan

This is the implementation contract for the proposed
[`reference-first policy`](drinking-window-reference-policy.md). It describes
how the owner's workbook becomes reviewed, shareable reference data and how
other households can improve that data. The first migration adds only
service-private draft storage; it cannot publish or resolve advice. Existing
maturity advice remains unchanged until the rollout gates below pass. The
inert foundation now has follow-up migrations for three years,
`producer_region` scope, draft-only membership and evidence links, and a
service-only draft match preview. It still cannot publish or resolve visible
advice. The [publication preflight](drinking-window-publication-preflight.md)
now combines the draft checks and records immutable review snapshots; it does
not relax the publication block or replace the required shadow comparison.

## Keep the three kinds of data separate

| Data | Owner and storage | Effect |
| --- | --- | --- |
| Household wine facts and complete manual dates | Private to the household | Describe that household's wine and override its displayed dates. |
| Proposed reference row or ageing-group membership | Service-managed review queue | May be discussed and corrected; never changes advice directly. |
| Published reference version | Shared, service-managed, immutable | May supply an explicit three-milestone window to any household with a matching wine. |

The shared library stores *normalized claims*, not copies of household wine
records or the workbook. A cellar location, bottle count, purchase price,
personal note, and the original spreadsheet do not enter the shared library.
The workbook's owner must review which of its normalized rows may be proposed
for cross-household use, and source-rights checks still apply before
publication. No private manual date or tasting observation is promoted merely
because another household could benefit from it.

## Shared format

Use a dedicated, versioned three-milestone library rather than inserting these rows into
the existing `enrichment_profiles`: those profiles are additive components of
the existing four-date maturity model, not complete reference windows. Use existing
`wine_reference_producers`, `wine_reference_products`,
`wine_reference_releases`, `enrichment_places`, source policies, evidence, and
curator eligibility where their meanings fit. New storage needs four parts:

1. `drinking_window_reference_versions`: draft/active/superseded lifecycle,
   content hash, publication date, and one active version. Rows and their
   applicability are immutable after publication.
2. `drinking_window_reference_rows`: one reviewed **three-milestone window** with
   required integer `first_trial_year`, `best_start_year`, and `best_end_year`;
   its scope (`release`, `producer_appellation`, `producer_region`,
   `appellation`, or `region`), canonical IDs required
   by that scope, region, colour, vintage, applicability group (or expressly
   reviewed `all-at-this-scope`), evidence,
   rationale, source pointer, and version. Exact-release rows also retain the
   canonical product/cuvée and release identity. The foundation database
   initially required four years and only four scopes. The follow-up
   migration aligns the inert draft schema to this policy; it refuses to
   discard any populated fourth-year data and leaves household overrides
   untouched. Future publication validation must confirm the canonical hierarchy and
   `vintage <= first_trial_year <= best_start_year <= best_end_year`.
   Evidence for the central pair and researched first year
   remains attributable; one curator approves the complete window. No date
   is calculated at runtime from another date or the current model.
3. `drinking_window_ageing_groups` and versioned memberships: locally defined
   groups, their scope and colour, evidence-backed definition, and the
   canonical appellations/products/releases eligible for each group. A
   membership can have an explicit vintage interval. The same wine can belong
   to a different relevant group at regional and producer-appellation scope;
   a group name is never treated as a global ranking. Producer-wide guidance
   needs reviewed eligibility across the producer's appellations within the
   same region, colour, and vintage. Unknown membership does
   not imply `standard`.
4. `drinking_window_candidates` and decision/audit records: staged import
   rows, household proposals, duplicate/conflict links, source-rights and
   curator decisions. Candidates are not published rows.

The original workbook's reference sheets can now be loaded into the
service-private candidate queue after a read-only audit. Run
`scripts/drinking_window/audit_workbook.mjs` with an expected workbook SHA-256
and an existing private directory **outside Git**; it writes `candidates.json`
and `report.json` there. Then run
`node scripts/drinking_window/stage_workbook_candidates.mjs --candidates
PRIVATE_DIR/candidates.json --expected-sha256 HASH` for a dry-run count.
Only after checking that summary and the destination project, explicitly add
`--apply` with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the private
operator environment. The service-only RPC accepts one atomic batch of at most
250 reference-sheet candidates. Exact replays are harmless; conflicting
replays abort rather than overwriting review work. It rejects the private
`Cave` sheet, household fields, and invented first-trial years. Quarantined
source rows retain their reason. No workbook, candidate JSON, or private
cellar data belongs in a commit or a browser request. Staging is not source
rights approval, three-date completion, shared publication, or advice rollout.

The draft-only membership table now records a specific place, product/cuvée,
or release, with an optional vintage interval and rationale, against one
versioned local group. Its exact target shape and same-version relationship
are enforced. A separate evidence-link table can attach an existing source
record to a window's first-trial year, its optimum pair, a group definition,
or a membership decision. These links do **not** approve the evidence or its
cross-household rights. Publication-time validation must still verify
place/product hierarchy, membership overlaps and coverage, complete supporting
evidence, source-rights policy, and the coherent three-date row before any
version can activate.

The service-only `drinking_window_draft_issues(version_id)` diagnostic now
lists missing date/group/membership evidence, unreviewed or unlicensed source
links, contradictory evidence, identity-hierarchy errors, groups with no
member eligible for a row's vintage, and direct `all-at-this-scope` or
member-group overlaps. It is read-only and cannot activate a version. A
zero-issue result is **not** publication approval: place-to-product
eligibility and less direct membership overlaps are checked in the separate
eligibility report below; source-to-claim metadata fit is checked separately,
while semantic source review, curator decisions, and the complete version gate
still require review. The publication-blocking trigger
remains in force.

An append-only service-private review record now captures an eligible
drinking-window curator's approval or disagreement for each complete row,
ageing-group definition, and eligibility membership. This authority requires
an explicit `drinking-window` curator grant; existing profile grants do not
confer it. The decision stores a server-computed hash of the exact subject,
its evidence links, evidence review state, and source policy. Editing any of
these makes the old approval stale; a new decision is required. The separate
`drinking_window_review_issues(version_id)` report flags missing current
approvals, stale decisions without replacement, and current disagreements.
Curators currently have no drinking-window review UI, and the trusted service
must identify the human reviewer before recording a decision. Neither report
is a publication command. Publication still needs semantic source-to-claim
review, the remaining eligibility and evidence checks, a complete version validator,
and a shadow comparison before the publication trigger can be removed.

Ageing groups now carry the producer and/or appellation identities appropriate
to their scope, including producer-wide regional groups. The same group name
can be used independently in different appellations; a row borrowing a group
from another appellation or producer is
reported as a draft issue. Product and release memberships can now include a
place anchor, so a cuvée can be eligible in one appellation without claiming
eligibility everywhere it is sold. Existing unanchored draft memberships are
preserved but reported for correction. The service-only
`drinking_window_eligibility_issues(version_id)` report also flags memberships
outside a group's place, another producer's cuvée, and overlapping place/
product memberships in competing groups at the same lookup key. It is an
additional review gate, **not** a publication certificate. No advice changes.

The service-only `drinking_window_evidence_fit_issues(version_id)` report now
checks linked **supporting** evidence against the draft claim. It detects
contradictory producer, product, release, place, colour, or vintage metadata;
wrong claim types (for example, a food-pairing record used to justify a
drinking date); and a single cuvée or appellation source used to justify a
broader regional window. Context links are not mistaken for support, and
the existing rights/review report still applies separately. These checks
cannot read the source's words or prove that a pointer actually supports a
particular year. A curator must verify that meaning before approving the
whole three-milestone row. A zero-issue report is not publication approval.

The service-only `drinking_window_preview_draft_match` function now exercises
the proposed reference order against **one draft version**: exact release,
producer-appellation, producer-region, appellation, then region. It requires
canonical IDs, colour, and vintage, checks identity consistency, and applies
place/product/release memberships at the row's scope. It returns all three
years and the row ID from one row, `no_match` when none applies, or `ambiguous`
without dates when multiple rows tie at the highest applicable scope. Its
`draft_match` status is only an algorithm preview: the function does **not**
check evidence, rights, or current curator decisions. It cannot select a
household override, trigger model fallback, publish a version, or change the
app's displayed advice. The later shadow resolver must use only a fully
validated/published version and handle those missing layers separately.

The same service can now submit a bounded batch of up to 250 **canonical
lookup keys** to `drinking_window_preview_draft_batch` and summarize
the outcomes with `drinking_window_preview_draft_coverage`. Only producer,
product, release, appellation, region, optional place, colour, and vintage
fields are accepted; household/wine IDs, bottle data, notes, and prices are
rejected. Input order is preserved, including missing keys, identity conflicts,
and ambiguous matches. This is useful for measuring *algorithmic* coverage of
a draft, but it does not query a cellar, save the submitted keys, compare the
current model, check evidence/review readiness, or replace advice. A batch
derived from a real cellar can still reveal a distinctive wine list even
without household IDs; only synthetic keys or an explicitly authorized,
appropriately protected private shadow job should be supplied. A proper
private shadow comparison still requires curated reference data and the
published-version resolver below.

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

The read-only converter is now available as `npm run drinking-window:audit`.
It requires an explicit SHA-256 pin and an existing private output directory
outside Git, then writes `candidates.json` and `report.json` there with
owner-only file permissions. For the audited snapshot, for example:

```sh
mkdir -m 700 /tmp/cellarmanager-window-review
npm run drinking-window:audit -- \
  --file /path/to/Caves_2.0.xlsx \
  --out-dir /tmp/cellarmanager-window-review \
  --expected-sha256 42b935d4fd2e161605d245b15b853d4ee7c1a0a9eed1ea14d460a80857373911
```

Use a fresh output directory for a repeat run; the converter refuses to
overwrite existing files. These files are a **local curation preview**, not
publication-ready rows or a database upload. The report lists each source
locator still needing canonical identities, source-rights review, applicable
ageing-group eligibility, and the missing start-tasting year. It also
reports quarantined rows and exact normalized-key overlaps. The importer
does not extract or output the `Cave` sheet: private manual pairs and historical `x` hints
remain a separate owner-only review task. No data is sent to a server.

The next read-only curation slice is
[`drinking-window-identity-review.md`](drinking-window-identity-review.md):
`npm run drinking-window:snapshot` captures only shared reference identities
from the linked development catalogue, and `npm run drinking-window:review`
compares them with the private candidate file. It records exact-name/alias
suggestions, ambiguities, and unresolved fields without verifying identities,
writing database rows, or changing visible advice.
An optional, workbook-hash-pinned [producer research pass](drinking-window-identity-review.md#workbook-specific-producer-research-11-october-2026)
now exposes four evidence-backed producer candidates for curator review. These
are local to this workbook; they do not create catalogue aliases or approve
the wine, place, or drinking-window identities.
An optional [owner-confirmed interpretation pass](drinking-window-identity-review.md#owner-confirmed-source-interpretations-15-october-2026)
then separates a Premier Cru classification from Barraud's appellation,
prevents Belle Fiolle's Vin de France designation from matching the wrong
appellation, and annotates Boillot's grouped-cuvée and Chagnoleau's
producer-wide intent. It preserves the original source cells and still makes
no reference publishable.

| Workbook source | Staged translation | Review before publication |
| --- | --- | --- |
| Producer sheets `A:F`: vintage, cuvée, appellation, colour, start, end | Complete cuvée rows become exact-release **two-year candidates**; blank-cuvée/appellation-present rows become producer-appellation candidates. Keep the two years together and leave `first_trial_year` empty. | Resolve producer, product, appellation, region, colour, release and evidence to canonical IDs; research and review the first year. Reject ambiguous aliases. |
| `Millesimes!A:O`: region, colour, vintage; `L:M` standard and `N:O` premium age offsets | Fill down the sheet's displayed region/colour headings as the old formula did. For each complete pair, calculate `best_start_year = vintage + start_offset` and `best_end_year = vintage + end_offset`. Stage **two distinct regional candidates**, retaining their historical bin and cell provenance. Leave the first year empty. | Define local ageing groups and prove which wines each bin can apply to; research and review the first year. Neither bin publishes as a default. Blank or invalid offsets remain unavailable. |
| `Cave!M:N`: manual start/end | Review privately against that household wine as an incomplete three-date draft; this audit does not export the `Cave` sheet. | Complete or clear with the owner. Never share it as a reference row or silently make it an effective manual override. |
| `Cave!O`: historical `x` | Keep as a private classification-review hint. | It cannot establish a shared ageing group by itself. |
| Chagnoleau producer-wide rows and missing appellation-tier rows | Stage its five complete blank-cuvée/appellation rows as `producer_region` candidates because the owner confirmed their vintage-wide intent. Quarantine other unreviewed producer-only rows; report missing appellation profiles as gaps. | Verify Chagnoleau's canonical region, eligible wines, evidence and rights before publication. Its specific Madrigal row takes precedence. |

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
candidates, 71 standard and 71 premium regional pairs, five Chagnoleau
producer-wide candidates, two start-only producer rows, and two regional rows
with no pair.

The workbook's two years map to **probable optimum start** and **probable optimum end**,
not to start tasting. Their source provenance remains attached
to both years. As the workbook has no start-tasting years, its rows alone produce
**zero publishable three-milestone references**. The candidate reviewer must supply
attributable evidence and an explicit value for the missing year, confirm the
whole ordered window, and only then publish. The current model may be shown
as comparison context during review, but cannot auto-fill those fields.

The [first review batch](drinking-window-first-review-batch.md) records the
owner's later Alsace/Beaujolais 2022–2023 three-date estimates separately from
their historical workbook pairs. It checks the source coordinates and exposes
every conflict or absent pair; it does not promote any of the eight proposals
to a shared reference.

## Resolve a wine and show why

The owner can now review complete household wine identities in the Catalogue.
The review queue lists wines without a shared link, searches existing shared
products or releases, and confirms only a release of the *same vintage* (or a
product for an NV wine). The confirmed link and an append-only decision record
remain household-specific; neither the wine's text nor a global alias/product
is changed. If no shared entry exists, the owner can submit a private,
idempotent missing-identity request. It is not a published identity or a
drinking-window contribution; trusted curation must still normalize and
review it. The existing Liv-ex suggestion workflow remains available on each
wine card. This identity review does not activate the new reference selector.

The server first resolves whichever identity fields it can confirm. It only
considers a scope when that scope's required IDs, region, colour, and vintage
are confirmed. At each scope it checks the identity key and applicable
reviewed group. It takes one complete three-milestone row from the highest
matching scope. A missing group skips only rows
that require that group; a contradictory identity, duplicate published match,
or explicit block stops with a review reason. If no reference row matches,
the current maturity model may provide its own clearly labelled estimate
under its own validity checks. A complete manual household
window wins without modifying the shared row. The existing four-date
`wine_maturity_overrides` remain effective until the owner explicitly accepts
any editor migration. Historical two-date manual pairs remain private drafts;
they cannot be mixed with another source or silently made effective.

Store the selected source type, scope, row ID, reference-version ID, all three
explicit years, whole-window provenance and the model projection ID/version
only when the model is selected, input
fingerprint, and no-match/review reason in a household-scoped resolution.
Keep the current model projection
separately for its legacy four-date estimate and storage guidance. Expose the
effective window and its explanation through a narrow household-authorized
RPC; do not expose the service's global candidate queue or another household's
data to browsers or PowerSync. A reference publication requeues affected resolutions using the
existing demand/job pattern. A wine edit invalidates a stale resolution by
input fingerprint; old advice remains attributable to its old version.

## How other households improve the library

On a wine card, offer **Suggest a correction or source** beside the displayed
window and its explanation. A member can propose a missing three-date window,
challenge an existing milestone, supply evidence for a missing year in an
unpublished candidate, or identify the correct ageing group. The form
shows the canonical identity and proposed scope, asks for all three years (or
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
new absolute three-date row types and ageing-group membership need their own
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

1. **Align the inert foundation:** follow-up migrations change draft
   reference rows from four required years to three, add `producer_region`
   scope, and add versioned group memberships and evidence links. Existing
   manual overrides remain intact. Publication stays blocked and visible
   advice stays unchanged. Keep the read-only workbook converter and report
   separate from database writes. Next add evidence-rights checks, membership
   conflict detection, complete-window review, and publication validation.
2. **Curate the seed:** resolve identities and region/colour mappings, define
   ageing groups and memberships, review source pairs, research and approve
   all three years per row, and fill missing appellation/region coverage where
   evidence exists. Publish nothing that still lacks a milestone or
   classification decision.
3. **Selector in shadow mode:** use synthetic canonical keys in the draft batch
   preview to exercise candidate coverage. Promote
   the selector to a validated published-version resolver, then calculate a
   reference result beside the current model for the owner's cellar. Compare
   coverage and every changed
   date; test manual precedence, group eligibility, vintage/colour separation,
   three-milestone order and whole-window provenance, missing data, conflicts, and
   fallback. Do not replace the visible window.
4. **Household view and contributions:** show the whole-window source and
   its three explicit years, add private versus shared
   proposal actions, and test cross-household
   isolation and curator publication. Release behind a reversible switch
   after the owner reviews the shadow report.

The first success measure is not the number of imported rows. It is the
number of current wines with a *defensible* complete three-milestone reference, plus an
explicit explanation for every model estimate or unavailable result.
