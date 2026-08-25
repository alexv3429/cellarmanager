# CellarManager product roadmap

This is the canonical roadmap after the `v0.3.0` personal-production release.
Completed milestone roadmaps and acceptance records remain historical evidence;
when scope or sequencing changes, this file must be updated before implementation
crosses a milestone boundary.

## Product progression

| Milestone | Promise | Status |
|---|---|---|
| `v0.3` | A cellar can live safely in CellarManager through daily manual use or guarded CSV import | Released (`v0.3.0`) |
| `v0.4` | CellarManager describes wines meaningfully and enriches them from reviewed, attributable evidence | In progress (0.4.9 under validation) |
| `v0.5` | Several real users can jointly manage one cellar without compromising local-first correctness | Planned |
| `v0.6` | Adding or identifying wine requires dramatically less typing | Planned |
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
| 0.4.14 | Duplicate detection and explicit merge workflow |
| 0.4.15 | CSV export with a documented portable format and optional round-trip compatibility |
| 0.4.16 | v0.4 acceptance and release |

Barcode scanning and lookup, photos, OCR, purchase cost, and valuation are not
v0.4 work. Serving guidance and other fields may be retrieved in v0.4 when the
selected provider supplies them reliably, but drinking windows and food
pairings are the required enrichment baseline.

Shared maturity and pairing knowledge is curated continuously after 0.4.9; it
is not deferred to one final bulk import. Missing producer, cuvee, release, and
dish specificity may be added through reviewed immutable versions at any time.
Step 0.4.13 makes that work systematic by aggregating and prioritizing missing
coverage across affected wines and households. Step 0.4.16 reviews remaining
coverage and unresolved reasons as a release gate, while a new unknown producer
continues to receive the safe broader place/vintage estimate immediately.

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
| 0.5.12 | v0.5 acceptance and release |

## v0.6 — Capture-assisted enrichment

Camera, OCR, and barcode workflows extend the v0.4 provider boundary and feed
the same normalization and candidate-resolution principles established by CSV
import:

`photo/OCR/barcode -> normalized candidate -> review -> match/create -> wine`

Recognition and enrichment output is always a candidate for human approval,
never inventory authority.

| Step | Scope |
|---|---|
| 0.6.1 | Capture architecture extending the v0.4 enrichment boundary |
| 0.6.2 | Image/storage security model |
| 0.6.3 | Camera and photo upload |
| 0.6.4 | Image preprocessing |
| 0.6.5 | OCR |
| 0.6.6 | Structured wine-field extraction |
| 0.6.7 | Human review and correction workflow |
| 0.6.8 | Existing-wine candidate matching |
| 0.6.9 | Photo-to-inventory ADD flow |
| 0.6.10 | Batch-entry workflow |
| 0.6.11 | Location QR codes |
| 0.6.12 | Wine barcode identifiers, scanning, and provider lookup |
| 0.6.13 | Restore useful archived v0.1 enrichment identifiers/data |
| 0.6.14 | Accuracy and privacy acceptance |
| 0.6.15 | v0.6 release |

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
- Full user-interface internationalization is not a v0.4-v1.0 release gate. It
  requires its own roadmap decision rather than being smuggled into an unrelated
  feature PR; data and imports continue to preserve Unicode text.

These items can be promoted only by changing this roadmap first and documenting
the trade-off with the milestone work they displace.
