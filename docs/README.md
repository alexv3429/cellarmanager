# CellarManager documentation

The repository documentation describes the current local-first application and
retains only the evidence needed to understand its released migration history.

## Released v0.6 product and active design

- [`../README.md`](../README.md) - application, development, validation, and deployment overview
- [`product-roadmap.md`](product-roadmap.md) - canonical milestone sequence through v1.0
- [`household-permissions.md`](household-permissions.md) - final owner/member capability and enforcement contract for v0.5
- [`household-switching.md`](household-switching.md) - multi-household selection, isolation, and 0.5.5 acceptance checklist
- [`household-members.md`](household-members.md) - current collaborators, role changes, access removal, and 0.5.6 validation
- [`household-ownership-lifecycle.md`](household-ownership-lifecycle.md) - transfer ownership, leave safely, and 0.5.10 validation
- [`membership-security-matrix.md`](membership-security-matrix.md) - 0.5.11 cross-role security gates, invitation races, and rollout boundaries
- [`account-settings.md`](account-settings.md) - 0.5.12 own display name, email-verified password recovery, and validation
- [`household-devices.md`](household-devices.md) - browser registrations, revocation limits, and 0.5.7 validation
- [`multi-device-inventory-acceptance.md`](multi-device-inventory-acceptance.md) - concurrent stock acceptance, isolated fixtures, and safe two-device validation
- [`inventory-conflict-recovery.md`](inventory-conflict-recovery.md) - rejected changes, explicit browser-queue recovery, and private stop receipts
- [`wine-reference-validation.md`](wine-reference-validation.md) - LWIN coverage, conservative matching, and fallback evidence for v0.4
- [`wine-reference-schema.md`](wine-reference-schema.md) - shared producer, product, release, package, alias, and identifier model
- [`lwin-reference-snapshots.md`](lwin-reference-snapshots.md) - attributed LWIN7 snapshot import, atomic refresh, and missing-ID demands
- [`wine-reference-matching.md`](wine-reference-matching.md) - conservative candidates, household decisions, rejection memory, and reviewed links
- [`enrichment-provider-trial.md`](enrichment-provider-trial.md) - drinking-window and pairing source quality, access, and written-rights gate
- [`enrichment-inference-poc.md`](enrichment-inference-poc.md) - private, explainable maturity/storage/pairing proof of concept after the provider trial
- [`enrichment-knowledge-schema.md`](enrichment-knowledge-schema.md) - versioned shared profiles, source rights, evidence, household observations, and derived projections
- [`enrichment-publishing-and-jobs.md`](enrichment-publishing-and-jobs.md) - atomic reviewed-knowledge publication and provider-neutral asynchronous demand/job lifecycle
- [`maturity-projections.md`](maturity-projections.md) - production maturity windows, urgency, location purpose, moving hints, review, and owner adjustment
- [`drinking-window-reference-policy.md`](drinking-window-reference-policy.md) - proposed exact-key, same-source drinking-window selection and shared-profile governance
- [`drinking-window-source-audit.md`](drinking-window-source-audit.md) - private workbook aggregate audit, import blockers, and missing-reference queue
- [`pairing-projections.md`](pairing-projections.md) - reviewed dish profiles, in-stock food-pairing suggestions, personal preferences, explanations, and repeated feedback
- [`personal-observations-serving.md`](personal-observations-serving.md) - household and personal notes, derived serving estimates, explicit owner adjustments, and editing
- [`rich-wine-facts.md`](rich-wine-facts.md) - household origin, composition, sweetness, alcohol, certification, editing, and provenance boundary
- [`catalog-coverage-curation.md`](catalog-coverage-curation.md) - rich catalog filters, reason-aware fact/profile coverage, and privacy-bounded curation priority
- [`reviewed-enrichment-research.md`](reviewed-enrichment-research.md) - allowlisted web research, attributed drafts, owner review, source rights, and trusted publication
- [`profile-review-requests.md`](profile-review-requests.md) - deduplicated published-profile reports, private evidence threads, visible status, and immutable outcomes
- [`profile-revision-governance.md`](profile-revision-governance.md) - scoped curator eligibility, structured diffs, disagreement rules, immutable supersession, and trusted publication
- [`personal-maturity-calibration.md`](personal-maturity-calibration.md) - private account timing preference, canonical comparison, reset, and manual-window precedence
- [`capture-assisted-entry.md`](capture-assisted-entry.md) - provider-neutral photo/OCR/barcode candidate flow and owner-controlled cellar boundary
- [`capture-storage-security.md`](capture-storage-security.md) - private image handling, authorization, validation, provider gates, and short retention
- [`location-qr-codes.md`](location-qr-codes.md) - printable location labels, local scanning, and inventory selection boundaries
- [`wine-barcodes.md`](wine-barcodes.md) - checked bottle codes, household links, and optional attributed product lookup
- [`v04-acceptance.md`](v04-acceptance.md) - final rich-library production acceptance and release gates
- [`v05-acceptance.md`](v05-acceptance.md) - shared-household production acceptance and release gates
- [`wine-duplicate-merge.md`](wine-duplicate-merge.md) - conservative duplicate candidates, explicit owner merge, stock consolidation, and immutable audit history
- [`v01-metadata-restoration.md`](v01-metadata-restoration.md) - exact-ID, preview-first restoration of safe archived facts and guidance
- [`v01-enrichment-restoration.md`](v01-enrichment-restoration.md) - exact-ID, preview-first restoration of private historical identifiers and enrichment summaries
- [`v06-capture-acceptance.md`](v06-capture-acceptance.md) - photo/barcode accuracy and privacy gates, automated evidence, and safe phone checks before v0.6 release
- [`v07-history-event-model.md`](v07-history-event-model.md) - accepted-only, household-private reporting events and the local-first history contract for 0.7.1
- [`v07-legacy-history.md`](v07-legacy-history.md) - verified v0.1 opening stock and confirmed removals, preview-first restoration, and 0.7.2 safety gates
- [`v07-acquisition-model.md`](v07-acquisition-model.md) - explicit owner-private purchase/acquisition history, separate from stock additions, and 0.7.5 security gates
- [`v07-legacy-purchase-prices.md`](v07-legacy-purchase-prices.md) - verified v0.1 holding prices without invented purchases, dates, or currency
- [`maturity-knowledge-v2.md`](maturity-knowledge-v2.md) - expanded exact-appellation maturity profiles, evidence inputs, safety boundary, and private aggregate coverage
- [`maturity-hierarchy-poc.md`](maturity-hierarchy-poc.md) - validated and promoted region, appellation/climat, time-bounded producer, cuvee, interaction, and release model
- [`enrichment-provider-rights-request.md`](enrichment-provider-rights-request.md) - provider contact drafts for licensing, retention, provenance, and methodology answers
- [`adr/README.md`](adr/README.md) - released architecture and accepted v0.4 design decisions
- [`activity-and-sync.md`](activity-and-sync.md) - recent inventory activity and synchronization-state UX
- [`csv-ingestion.md`](csv-ingestion.md) - complete guarded CSV import contract
- [`csv-export.md`](csv-export.md) - portable Excel/CSV cellar export and guarded round-trip boundary
- [`pwa-mobile-accessibility.md`](pwa-mobile-accessibility.md) - install, phone interaction, and accessibility baseline
- [`github-protection.md`](github-protection.md) - required `CI Gate` and branch protection

## Completed v0.3 milestone

- [`v03-roadmap.md`](v03-roadmap.md) - completed delivery sequence
- [`v03-personal-production-acceptance.md`](v03-personal-production-acceptance.md) - production acceptance record

## Released history and migration evidence

- [`releases/v0.6.0.md`](releases/v0.6.0.md) - bilingual interface and reviewed label, location-QR, and barcode entry
- [`releases/v0.5.0.md`](releases/v0.5.0.md) - shared-household collaboration release
- [`releases/v0.4.0.md`](releases/v0.4.0.md) - reviewed rich-library release
- [`releases/v0.3.0.md`](releases/v0.3.0.md) - personal-production baseline release
- [`releases/v0.2.0.md`](releases/v0.2.0.md) - first local-first release
- [`adr/003-v01-data-migration.md`](adr/003-v01-data-migration.md) - historical one-off migration decision
- [`v01-final-rebaseline.md`](v01-final-rebaseline.md) - normalized migration baseline
- [`v01-production-acceptance.md`](v01-production-acceptance.md) - production migration acceptance

The accepted v0.1 FastAPI/SQLite runtime and migration implementation are not
part of active development or CI. The `v0.1.0`, `v0.2.0`, `v0.3.0`, and
`v0.4.0`, `v0.5.0`, and `v0.6.0` Git tags preserve released history if inspection is
required. The `v0.6.0` tag records production acceptance of that release.
New product development belongs in `apps/web/`, `workers/`, and `supabase/`.
