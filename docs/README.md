# CellarManager documentation

The repository documentation describes the current local-first application and
retains only the evidence needed to understand its released migration history.

## Current product and active design

- [`../README.md`](../README.md) - application, development, validation, and deployment overview
- [`product-roadmap.md`](product-roadmap.md) - canonical v0.4-to-v1.0 product sequence
- [`wine-reference-validation.md`](wine-reference-validation.md) - LWIN coverage, conservative matching, and fallback evidence for v0.4
- [`wine-reference-schema.md`](wine-reference-schema.md) - shared producer, product, release, package, alias, and identifier model
- [`lwin-reference-snapshots.md`](lwin-reference-snapshots.md) - attributed LWIN7 snapshot import, atomic refresh, and missing-ID demands
- [`wine-reference-matching.md`](wine-reference-matching.md) - conservative candidates, household decisions, rejection memory, and reviewed links
- [`enrichment-provider-trial.md`](enrichment-provider-trial.md) - drinking-window and pairing source quality, access, and written-rights gate
- [`enrichment-inference-poc.md`](enrichment-inference-poc.md) - private, explainable maturity/storage/pairing proof of concept after the provider trial
- [`enrichment-knowledge-schema.md`](enrichment-knowledge-schema.md) - versioned shared profiles, source rights, evidence, household observations, and derived projections
- [`enrichment-publishing-and-jobs.md`](enrichment-publishing-and-jobs.md) - atomic reviewed-knowledge publication and provider-neutral asynchronous demand/job lifecycle
- [`maturity-projections.md`](maturity-projections.md) - production maturity windows, urgency, location purpose, moving hints, review, and owner adjustment
- [`pairing-projections.md`](pairing-projections.md) - reviewed dish profiles, in-stock food-pairing suggestions, personal preferences, explanations, and repeated feedback
- [`personal-observations-serving.md`](personal-observations-serving.md) - household and personal notes, derived serving estimates, explicit owner adjustments, and editing
- [`rich-wine-facts.md`](rich-wine-facts.md) - household origin, composition, sweetness, alcohol, certification, editing, and provenance boundary
- [`v01-metadata-restoration.md`](v01-metadata-restoration.md) - exact-ID, preview-first restoration of safe archived facts and guidance
- [`maturity-knowledge-v2.md`](maturity-knowledge-v2.md) - expanded exact-appellation maturity profiles, evidence inputs, safety boundary, and private aggregate coverage
- [`maturity-hierarchy-poc.md`](maturity-hierarchy-poc.md) - validated and promoted region, appellation/climat, time-bounded producer, cuvee, interaction, and release model
- [`enrichment-provider-rights-request.md`](enrichment-provider-rights-request.md) - provider contact drafts for licensing, retention, provenance, and methodology answers
- [`adr/README.md`](adr/README.md) - released architecture and accepted v0.4 design decisions
- [`activity-and-sync.md`](activity-and-sync.md) - recent inventory activity and synchronization-state UX
- [`csv-ingestion.md`](csv-ingestion.md) - complete guarded CSV import contract
- [`pwa-mobile-accessibility.md`](pwa-mobile-accessibility.md) - install, phone interaction, and accessibility baseline
- [`github-protection.md`](github-protection.md) - required `CI Gate` and branch protection

## Completed v0.3 milestone

- [`v03-roadmap.md`](v03-roadmap.md) - completed delivery sequence
- [`v03-personal-production-acceptance.md`](v03-personal-production-acceptance.md) - production acceptance record

## Released history and migration evidence

- [`releases/v0.3.0.md`](releases/v0.3.0.md) - personal-production baseline release
- [`releases/v0.2.0.md`](releases/v0.2.0.md) - first local-first release
- [`adr/003-v01-data-migration.md`](adr/003-v01-data-migration.md) - historical one-off migration decision
- [`v01-final-rebaseline.md`](v01-final-rebaseline.md) - normalized migration baseline
- [`v01-production-acceptance.md`](v01-production-acceptance.md) - production migration acceptance

The accepted v0.1 FastAPI/SQLite runtime and migration implementation are not
part of active development or CI. The `v0.1.0`, `v0.2.0`, and `v0.3.0` Git tags
preserve the released history if inspection is ever required. New product
development belongs in `apps/web/` and `supabase/`.
