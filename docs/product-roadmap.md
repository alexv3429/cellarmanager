# CellarManager product roadmap

This is the canonical roadmap after the `v0.4.0` rich-library release.
Completed milestone roadmaps and acceptance records remain historical evidence;
when scope or sequencing changes, this file must be updated before implementation
crosses a milestone boundary.

## Product progression

| Milestone | Promise | Status |
|---|---|---|
| `v0.3` | A cellar can live safely in CellarManager through daily manual use or guarded CSV import | Released (`v0.3.0`) |
| `v0.4` | CellarManager describes wines meaningfully and enriches them from reviewed, attributable evidence | Released (`v0.4.0`) |
| `v0.5` | Several real users can jointly manage one cellar without compromising local-first correctness | In progress (`0.5.14`) |
| `v0.6` | The app is usable in English or French, and adding or identifying wine requires dramatically less typing | Planned |
| `v0.7` | CellarManager explains what happened to the cellar and what the collection means over time | Planned |
| `v1.0` | A self-host can install, trust, upgrade, recover, and maintain CellarManager for years | Planned |

No separate `v0.8` or `v0.9` milestone is currently planned. The product moves
from the insight milestone to a reliability-focused `v1.0`; adding an
intermediate milestone requires an explicit roadmap change.

## Contracts stable since v0.3

Future work extends these contracts instead of silently redefining them:

- a wine has a stable ID and a conservative physical/reference identity
- a cellar and location represent physical storage
- a holding remains a wine, location, and bottle quantity
- PostgreSQL holdings remain authoritative current inventory
- ADD, MOVE, and REMOVE remain local-first, immutable inventory operations
- a household remains the ownership and security boundary
- manual entry, the historical v0.1 migration, CSV import, and future capture
  all produce the same CellarManager wines, holdings, and locations
- external input is normalized, matched, reviewed, and then translated through
  normal domain rules; imported or recognized data is never a second class of
  inventory

If a proposed feature requires changing one of these contracts, it needs an ADR
and roadmap update before feature implementation begins.

## Delivery policy

- One numbered step is one focused pull request. A split is allowed when risk or
  reviewability requires it, but the roadmap is updated before the extra PRs
  accumulate.
- Each behavior step has proportionate automated checks and an explicit
  user-facing acceptance checklist. Release/documentation-only steps use review
  and automated gates rather than artificial production mutations.
- Pull requests are opened ready for review after local validation. The next
  step starts after the preceding PR is accepted and merged.
- Database changes are additive and migration-backed. Existing production
  household data is never used as disposable test data.
- Historical v0.1 evidence stays private and read-only. Restoration work imports
  deliberately selected data into current models; it does not revive the
  retired runtime or one-off importer.
- Each milestone ends with acceptance, release metadata, an annotated tag from
  protected `main`, and a non-draft GitHub Release.

## v0.4 — Rich wine library

CSV import moved into v0.3 because personal production required a safe way to
bootstrap an existing cellar. v0.4 keeps portable export and optional round-trip
compatibility, but does not build a second importer. It also delivers the first
end-to-end, evidence-backed enrichment workflow for drinking windows and food
pairings.

“Reliable” enrichment means that every factual input has reviewable provenance,
scope, and confidence. External production sources must be suitable for
programmatic use, have documented access and licensing terms, and be matched to
a wine conservatively. Retrieved values retain their provider, provider wine ID
or URL when available, and retrieval time. Derived recommendations retain the
knowledge versions and rules that produced them and are labelled as estimates,
not source claims. Ambiguous candidates require review. Enrichment never
silently replaces a user-maintained value. Missing evidence, provider outages,
rate limits, and partial results must leave the existing cellar usable and
unchanged.

| Step | Scope |
|---|---|
| 0.4.1 | Validate and accept the shared wine-reference, evidence, matching, and fallback architecture |
| 0.4.2 | Shared producer, product, release, package, alias, supersession, and external-identifier schema |
| 0.4.3 | LWIN reference snapshot import, attribution, refresh, and missing-reference handling |
| 0.4.4 | Conservative matching candidates, household decisions, rejection memory, and review workflow |
| 0.4.5 | Trial provider quality, coverage, access, and rights; prove or reject a curated place/vintage/producer/cuvée maturity-and-pairing model when providers cannot meet the exact-release baseline |
| 0.4.6 | Versioned place, vintage, producer-era, cuvée, evidence, observation, and recommendation-projection schema |
| 0.4.7 | Reviewed knowledge publishing and asynchronous enrichment demand infrastructure, with optional provider credentials, caching, retries, rate limits, and offline states |
| 0.4.8 | Production maturity, urgency, storage-purpose, and moving-hint projections with explanations, confidence, review, and manual override |
| 0.4.9 | Production dish-profile and food-pairing projections with ingredient/style constraints, personal preference refinement, explanations, and repeated owner acceptance |
| 0.4.10 | Personal notes, manual overrides, serving guidance, and editing |
| 0.4.11 | Country, region, classification, vineyard, grapes, sweetness, alcohol, and certifications |
| 0.4.12 | Restore corresponding archived v0.1 metadata through current models |
| 0.4.13 | Rich catalog filtering/search, profile-coverage diagnostics, and a prioritized shared-knowledge curation queue |
| 0.4.14 | Multi-source reviewed web research, advanced owner source suggestions, attributable draft fact/profile synthesis, owner notification/review/editing, and trusted shared publication |
| 0.4.15 | Duplicate detection and explicit merge workflow |
| 0.4.16 | Excel-first cellar export with a documented CSV alternative and guarded round-trip compatibility |
| 0.4.17 | Published-profile error reports and review requests, with deduplicated cases, supporting comments or evidence, visible status, and notifications |
| 0.4.18 | Shared-library governance and profile revision workflow: trusted-curator eligibility, explicit validation and disagreement rules, immutable profile history and comparison, supersession, and auditable publication |
| 0.4.19 | Private member maturity calibration against canonical guidance, including a bounded younger/later shift, a visible explanation and reset, and strict separation from shared profiles |
| 0.4.20 | v0.4 acceptance and release |

Barcode scanning and lookup, photos, OCR, purchase cost, and valuation are not
v0.4 work. Serving guidance and other fields may be retrieved in v0.4 when the
selected provider supplies them reliably, but drinking windows and food
pairings are the required enrichment baseline.

Shared maturity and pairing knowledge is curated continuously after 0.4.9; it
is not deferred to one final bulk import. Missing producer, cuvee, release, and
dish specificity may be added through reviewed immutable versions at any time.
Step 0.4.13 makes that work systematic by aggregating and prioritizing missing
fact and profile coverage across affected wines and households. Step 0.4.14
researches those demands from complementary evidence into attributable drafts
that remain inactive until visible review and trusted publication. New subjects
use generic source discovery rather than per-producer code; an advanced URL
submission remains available when discovery misses a relevant page. Step
0.4.17 lets a user challenge published knowledge without changing or
deactivating it silently. The implemented report follows the exact profile
contribution used by a current recommendation, deduplicates a shared case by
stable canonical subject, keeps every reporter's comments and evidence private,
and exposes status notifications and the trusted outcome. Step 0.4.18 turns a
documented correction into a structured proposal with a red/green comparison,
attributable curator decisions, blocking disagreements, and a new immutable
version instead of editing history in place. Curator eligibility is explicit,
scoped, service-granted, reversible, and auditable; account count or an
unreviewed popularity vote is not evidence. The trusted Worker independently
revalidates and publishes an approved correction. A new unknown producer
continues to receive the safe broader place/vintage estimate immediately.

Canonical and personal guidance remain separate. Step 0.4.19 applies a private,
bounded member preference only after the canonical maturity estimate has been
calculated. The implemented whole-year shift is limited to three years younger
or later and preserves the canonical window shape. Wine Detail shows both
results and an immediate reset; Catalog ordering/status and online maturity
exports use the effective private dates. An explicit per-wine manual override
remains the highest-priority local instruction. The preference lives only in a
non-exposed account-private table: it cannot alter shared knowledge or be read
by another account or household member. Step 0.4.20 audits unresolved
high-impact requests, shared-profile revision readiness,
personal-calibration behavior, and current cellar coverage before the v0.4
release.

### Milestone conclusion

All twenty steps are complete. The accepted application, immutable shared
knowledge boundary, release metadata, and release notes define the `v0.4.0`
rich-library baseline. The annotated release tag is created from protected
`main` after the release pull request is merged. Ongoing profile research and
revision continue through the reviewed workflow; they do not reopen the
milestone or silently rewrite the released application contract.

## v0.5 — Shared-household collaboration

The existing household, membership, user, and device foundations become a
complete collaboration product. PostgreSQL remains authoritative when devices
make incompatible changes while offline.

| Step | Scope |
|---|---|
| 0.5.1 | Final owner/member permission model |
| 0.5.2 | Membership-management RPCs |
| 0.5.3 | Durable invitation model |
| 0.5.4 | Invite, accept, and revoke workflow |
| 0.5.5 | Multi-household switching UX |
| 0.5.6 | Member-management UI |
| 0.5.7 | Device-management and revocation UI |
| 0.5.8 | Concurrent multi-device inventory acceptance |
| 0.5.9 | Conflict and rejected-operation UX |
| 0.5.10 | Ownership transfer and leaving a household |
| 0.5.11 | Full membership security matrix |
| 0.5.12 | Account & profile settings: own display name and password change, with verified authentication flows |
| 0.5.13 | Spreadsheet import hardening: in-app row corrections, bulk replacements and explicit reversible exclusions |
| 0.5.14 | v0.5 acceptance and release |

Step 0.5.1 introduced the two-role contract, refined during 0.5.4 validation:
every owner and member may read the shared cellar, use private preferences and
authored notes, submit feedback, report shared-knowledge problems, and manage
their own devices. Owners alone perform ADD/MOVE/REMOVE operations and manage
imports, catalog and storage structure, household-wide guidance overrides,
shared research decisions, memberships, and all household devices. Members
have one read-only Cellar browser instead of separate Inventory and Catalog
menus; Owners retain both management screens. A future visual cellar-layout
view must also be readable by Members without granting setup edits. The exact matrix
and its server-side enforcement are documented in
[`household-permissions.md`](household-permissions.md).

Step 0.5.2 adds the narrow server-side membership management boundary. Any
current member can list fellow collaborators with a safe display label; owners
can promote, demote, or revoke another membership through audited RPCs. Generic
management cannot demote or remove the acting owner: ownership transfer and
leaving remain explicit work in 0.5.10. Revocation immediately removes access,
invalidates registered devices, and removes private per-household preferences
while preserving immutable inventory history and household-visible authored
knowledge. The invitation model and its user-facing workflow remain 0.5.3 and
0.5.4 respectively.

Step 0.5.3 adds the private durable invitation model. Recipient identity is
email-normalized, raw bearer tokens are represented only by a SHA-256 digest,
and validity is bounded to at most 30 days. Only one pending invitation may
exist for the same household and recipient; replacement creates a new linked
attempt while accepted, expired, revoked, and superseded records remain
append-mostly history. Database guards bind acceptance to the matching
authenticated email and exact membership and prohibit revival or identity,
role, deadline, and token rewriting. No recipient email or token digest is
public or synchronized offline.

Step 0.5.4 adds the audited workflow on top of that durable model. An owner
creates a seven-day Member invitation and chooses email delivery from the trusted
Worker or copies its private link for another messaging app. Email delivery is
owner-authorized, rate-limited, and tracked separately from acceptance. The
raw secret is returned once, lives in the URL fragment so it is not
sent in an HTTP path or query, and is never recoverable from invitation
history. An owner can cancel a live invitation or replace it with a new link;
replacement immediately invalidates the previous link. A recipient can preview
the household before authentication, must sign in with the exact invited email,
and explicitly accepts before the membership is created. Acceptance is
idempotent and every creation, acceptance, replacement, and cancellation is
attributed in the private membership audit. Current-member administration is
provided by step 0.5.6 below.

Step 0.5.5 makes multi-household switching explicit. The header identifies the
current collection and role, and offers a role-labelled selector only when
more than one synchronized membership is available. Switching asks for
confirmation, warns that unfinished forms and filters reset, and explains that
saved/queued changes remain bound to their original household. The destination
opens on its role-appropriate home screen. Every household/role transition
remounts the workspace, preventing form, pairing, import, and selection state
from crossing the boundary. Browser Back/Forward does not implicitly switch
households; older history entries from a different household return to the
current household's home. The selection is remembered per account on this
browser, with a non-blocking warning if browser storage is unavailable. Stored
IDs are never accepted without a current synchronized membership; losing the
selected membership closes its workspace and explains any available fallback.
Offline switching uses only locally synchronized memberships, subject to
server-side permission checks after reconnection. No new migration is needed.
See [`household-switching.md`](household-switching.md) for the acceptance checklist.

Step 0.5.6 adds **Members** in the account header and a `/members` directory for
the current household. Everyone can read current collaborators; Owners can
invite people, promote/demote another membership, or remove its access through
the existing audited RPCs. Each change requires confirmation with the target
identity and consequences, including deletion of household-private notes and
preferences on removal. The directory is online-only and is not persisted in
browser storage. The UI rechecks actor and target before submitting a change,
then reloads actual server state; uncertain responses never cause automatic
write retries. Offline transitions, household switches, and role changes clear
the directory and any confirmation, ignoring stale responses. Owners cannot
change their own role or remove themselves here; the explicit ownership-transfer
and leaving workflow remains 0.5.10. No migration is required. See
[`household-members.md`](household-members.md) for scope and safe validation.

Step 0.5.7 adds **Devices** in the account header and `/devices`. Owners manage
all household browser registrations; Members manage their own. Online rename
and irreversible revocation use narrow server-authorized RPCs with private audit
events. Revocation prevents further inventory uploads under that ID, preserves
accepted history and queued local operations, and never silently rotates or
reactivates the browser identity. This is **not** session logout or remote data
erasure; membership removal remains the access-control workflow. See
[`household-devices.md`](household-devices.md) for migration, limits and validation.

Basic **Account & profile** settings are implemented in **0.5.12**, before
the release gate now numbered **0.5.14**. Each user edits their own display name
and changes their own password through verified authentication; Owners manage
membership, not other users' credentials. Stable account UUIDs remain authoritative
and email remains the display fallback. Broader account/household deletion,
privacy and lifecycle workflows remain in **1.0.8**.

The **Settings → Account** header link opens `/account`, independently of household selection
and local synchronization, including before initial cellar setup. Display names
use the existing Auth presentation metadata read by the Members directory;
clearing a name restores the email fallback. Password changes reuse the
email-verified recovery flow and existing SMTP configuration, not an Owner-facing
credential editor. Both actions require online account verification, are never
queued offline, and introduce no database migration. See
[account settings](account-settings.md) for boundaries and acceptance checks.

The shared shell uses a compact, content-aligned header: household selection,
sync details and Settings are explicit disclosures. Account, Members, Devices and
Sign out are grouped in Settings; primary navigation stays visible, including on
phones. Sync errors, access changes and device-revocation alerts stay outside the
collapsed panels. Panels support Escape, focus return, outside-click dismissal
and one-open-at-a-time behavior without shifting the page content.

Step 0.5.8 adds a CI-gated concurrent inventory acceptance suite using independent
PostgreSQL sessions and isolated synthetic data. It covers competing stock
operations, duplicate delivery, new-wine identity reuse, device revocation races,
and consistent authorized reads. Web regressions cover interrupted upload batches,
terminal rejections, and convergence after synchronized snapshots. There is no new
screen or migration. This is not a live PowerSync/browser transport test; the
separate safe two-device checklist and exact automated boundaries are documented in
[`multi-device-inventory-acceptance.md`](multi-device-inventory-acceptance.md).
Conflict explanation and rejected-operation recovery UX and the 0.5.11 membership
security matrix are described below.

Step 0.5.9 explains rejected stock requests in plain language and links to the
wine's current stock before a separately confirmed new change. A browser-wide
queue review also covers uploads blocked by revoked devices or changed access,
including work from another household. The originating user can explicitly stop
a queued request online: a server-side cancellation record serializes with stock
acceptance, returns an existing receipt if already processed, and prevents a
stopped UUID from later changing stock. The original request is retained privately;
accepted inventory history is never undone, edited, or silently reattributed.
See [`inventory-conflict-recovery.md`](inventory-conflict-recovery.md) for the
additive migration, private history, and safe acceptance checklist.

Step 0.5.10 adds **Members → Your access**, with a separately confirmed
ownership transfer and departure. Transfer atomically makes an existing
collaborator Owner and keeps the actor as a Member. Leaving cannot remove the
last Owner; it revokes only the caller's household access/devices and removes
household-private notes/preferences, preserving shared stock and history.
Both paths serialize with inventory uploads and use exact membership identities.
Verified responses restrict the current workspace before replication catches up;
uncertain responses use read-only reconciliation rather than automatic retries.
See [ownership and leaving](household-ownership-lifecycle.md) for the additive
migration, automated race coverage and disposable-household acceptance plan.

Step 0.5.11 adds a CI-gated cross-role, cross-household matrix spanning current,
demoted, revoked and departed users, pending invitees, unrelated Owners, private
data and service-only authority. Independent-session invitation races exposed
and now prevent an accept/cancel deadlock: all invitation mutations lock the
household first and recheck authority after waiting. Account-switch regressions
also fail closed when clearing the previous local database fails. No new screen
or permission model is introduced. See
[membership security acceptance](membership-security-matrix.md) for the
function-only migration and the remaining hosted 0.5.14 release checks.

Step 0.5.13 addresses third-party workbooks that load but cannot be prepared
without returning to Excel. Owners can correct individual rows, replace exact
values across included rows, and explicitly exclude historical zero stock,
summary totals or unwanted entries. Source data remains unchanged; exclusions
are reversible and never inferred silently. Only included, revalidated rows
enter wine matching, capacity calculations and the normal atomic import.
The UI identifies the selected worksheet, preserves Excel row coordinates,
supports missing-Cuvée fallbacks without a dummy column, and keeps row review
paginated. A generic **Split a column** groups any source column into two chosen
fields, with unconfirmed separator suggestions, a swap action and manual
exceptions. Defaults fill only missing values, preserving explicit formats and
row corrections. Grouped storage review creates or reuses each source cellar
and its locations independently, with explicit confirmation, editable missing-location
defaults and safe retries. This uses existing setup RPCs without another migration.
Quantity zero imports a catalog entry without storage, stock
changes or inventory activity. The additive catalog-only import migration
changes functions and the receipt constraint; no production data repair is
required. See
[spreadsheet preparation](csv-ingestion.md#in-app-row-corrections-and-exclusions).

## v0.6 — French-first localization and capture-assisted enrichment

French localization is scheduled before camera, OCR, and barcode work so those
new flows launch on a properly localized foundation. English remains fully
supported. Language is a per-user preference, not a household setting, and is
available across that user's devices. Existing users stay in English until they
choose otherwise; new users may start from a supported browser language, with
an explicit Account setting to override it. French uses `fr-FR`. Unsupported
or untranslated interface strings fall back to English. Cellar labels, wine
names, source claims, and user-authored notes remain data and are not silently
translated.

| Step | Scope |
|---|---|
| 0.6.1 | Localization foundation and persistent per-user language preference |
| 0.6.2 | French translation of primary cellar, account, and collaboration workflows |
| 0.6.3 | Remaining French coverage, locale formatting, accessibility, and acceptance |

French acceptance covers the complete app-owned interface, including empty,
loading, validation, and error states; date, number, and plural formatting; and
mobile and desktop layouts. App-owned invitation and recovery messages are
included where their templates are controlled by this project. User content
and externally sourced wine names or advice are not machine-translated. Tests
must detect missing French strings and verify English fallback.

After localization, camera, OCR, and barcode workflows extend the v0.4 provider
boundary and feed the same normalization and candidate-resolution principles
established by CSV import:

`photo/OCR/barcode -> normalized candidate -> review -> match/create -> wine`

Recognition and enrichment output is always a candidate for human approval,
never inventory authority.

| Step | Scope |
|---|---|
| 0.6.4 | Capture architecture extending the v0.4 enrichment boundary |
| 0.6.5 | Image/storage security model |
| 0.6.6 | Camera and photo upload |
| 0.6.7 | Image preprocessing |
| 0.6.8 | OCR |
| 0.6.9 | Structured wine-field extraction |
| 0.6.10 | Human review and correction workflow |
| 0.6.11 | Existing-wine candidate matching |
| 0.6.12 | Photo-to-inventory ADD flow |
| 0.6.13 | Batch-entry workflow |
| 0.6.14 | Location QR codes |
| 0.6.15 | Wine barcode identifiers, scanning, and provider lookup |
| 0.6.16 | Restore useful archived v0.1 enrichment identifiers/data |
| 0.6.17 | Accuracy and privacy acceptance |
| 0.6.18 | v0.6 release |

## v0.7 — History, purchases, value, and insights

Current state continues to come from authoritative holdings. Historical
reporting uses accepted event/history records and never reconstructs the current
cellar by replaying old UI events.

| Step | Scope |
|---|---|
| 0.7.1 | Historical reporting/event model |
| 0.7.2 | Normalize and import useful legacy movement history |
| 0.7.3 | Inventory activity timeline |
| 0.7.4 | Consumption history |
| 0.7.5 | Acquisition and purchase model |
| 0.7.6 | Restore v0.1 acquisition dates and purchase prices |
| 0.7.7 | Inventory dashboard |
| 0.7.8 | Drinking-window dashboard |
| 0.7.9 | Aging and vintage views |
| 0.7.10 | Cost-based cellar valuation |
| 0.7.11 | Optional market-observation model |
| 0.7.12 | Reporting and export |
| 0.7.13 | Data-quality diagnostics |
| 0.7.14 | Reporting performance and indexing |
| 0.7.15 | v0.7 acceptance and release |

## v1.0 — Stable self-hosted product

v1.0 is a reliability and maintainability milestone, not a hidden domain-model
rewrite. Backup plus a successfully tested restore is a hard release gate.

| Step | Scope |
|---|---|
| 1.0.1 | Freeze and document the supported architecture |
| 1.0.2 | Reproducible fresh installation |
| 1.0.3 | Complete migration and upgrade audit |
| 1.0.4 | Tested backup procedure |
| 1.0.5 | Tested restore procedure |
| 1.0.6 | Lost-device, local-database, and re-synchronization disaster testing |
| 1.0.7 | Full security audit |
| 1.0.8 | Account, household, privacy, and deletion workflows |
| 1.0.9 | Performance baseline and large-cellar testing |
| 1.0.10 | Supported browser/device matrix |
| 1.0.11 | Formal accessibility audit |
| 1.0.12 | Operational diagnostics and observability |
| 1.0.13 | User, administrator, and developer documentation |
| 1.0.14 | Schema and API compatibility cleanup |
| 1.0.15 | Legacy and dependency cleanup |
| 1.0.16 | `v1.0.0-rc.1` |
| 1.0.17 | Release-candidate blocker fixes only |
| 1.0.18 | `v1.0.0` release |

The disaster matrix includes browser storage deletion, device replacement,
revoked devices, long offline periods, expired authentication while offline,
duplicate uploads, a rebuilt PowerSync local database, and interrupted
synchronization.

## Explicitly deferred beyond v1.0

- A general graphical builder for arbitrary cellar geometries is post-v1.0
  exploration. Through v1.0, storage remains the simpler flexible model of
  named cellars, ordered locations, optional capacity, occupancy, and archives.
- Additional interface languages beyond English and French are post-v1.0
  exploration unless the roadmap is changed again. v0.6 adds explicit English
  and French UI support; data and imports continue to preserve Unicode text.

These items can be promoted only by changing this roadmap first and documenting
the trade-off with the milestone work they displace.
