# CellarManager documentation

The repository documentation describes the current local-first application and
retains only the evidence needed to understand its released migration history.

## Current product

- [`../README.md`](../README.md) - application, development, validation, and deployment overview
- [`product-roadmap.md`](product-roadmap.md) - canonical v0.4-to-v1.0 product sequence
- [`adr/README.md`](adr/README.md) - architecture decisions and their status
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
