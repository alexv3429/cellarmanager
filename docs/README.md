# CellarManager documentation

The repository documentation describes the current local-first application and
retains only the evidence needed to understand its released migration history.

## Current product

- `../README.md` - application, development, validation, and deployment overview
- `adr/001-v02-target-architecture.md` - React, Supabase, PowerSync, and Cloudflare architecture
- `adr/002-inventory-operation-model.md` - local-first inventory-operation contract
- `activity-and-sync.md` - recent inventory activity and synchronization-state UX
- `csv-ingestion.md` - permanent product CSV structural parsing contract
- `pwa-mobile-accessibility.md` - install, phone interaction, and accessibility baseline
- `v03-personal-production-acceptance.md` - final v0.3 production acceptance checklist
- `v03-roadmap.md` - personal-production milestone and delivery sequence
- `github-protection.md` - required `CI Gate` and branch protection

## Released history and migration evidence

- `releases/v0.2.0.md` - first local-first release
- `adr/003-v01-data-migration.md` - historical one-off migration decision
- `v01-final-rebaseline.md` - normalized migration baseline
- `v01-production-acceptance.md` - production migration acceptance

The accepted v0.1 FastAPI/SQLite runtime and migration implementation are not
part of active development or CI. The `v0.1.0` and `v0.2.0` Git tags preserve
them if historical inspection is ever required. New product development belongs
in `apps/web/` and `supabase/`.
