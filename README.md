# CellarManager

CellarManager is a local-first wine cellar inventory application.

**Current release: v0.3.0**

## Architecture

- React + TypeScript + Vite
- Supabase PostgreSQL and Auth
- PowerSync local-first synchronization
- Cloudflare Workers Static Assets
- installable PWA with persisted local data

PostgreSQL holdings are authoritative. ADD, MOVE and REMOVE are recorded as
inventory operations, can be queued offline, and converge safely after reconnect.

See [`docs/adr/001-v02-target-architecture.md`](docs/adr/001-v02-target-architecture.md)
and [`docs/adr/002-inventory-operation-model.md`](docs/adr/002-inventory-operation-model.md)
for the released application foundation. The accepted
[`docs/adr/004-wine-reference-and-enrichment-evidence.md`](docs/adr/004-wine-reference-and-enrichment-evidence.md)
defines the shared wine-reference and enrichment boundary for v0.4; its
implementation follows the product roadmap below. The current v0.4 foundation
includes an attributed LWIN snapshot, a conservative explicitly reviewed
household matching workflow, versioned inference knowledge, and asynchronous
maturity/storage projections for supported wines.

## v0.3 capabilities

v0.3 is the personal-production baseline. It includes self-service
authentication, household isolation, stable browser/device registration,
URL-backed desktop and mobile navigation, inventory browsing and filtering,
wine details, cellar/location setup, wine catalog management, activity and
synchronization views, PostgreSQL-authoritative holdings, and offline-capable
ADD, MOVE and REMOVE operations with idempotent replay.

The permanent CSV importer can parse, map, clean, preview, resolve, and
transactionally commit reasonably messy cellar exports. It can match existing
wines, reconcile storage and quantities, apply all-row defaults, normalize
known values, and create an initial cellar/location when required.

The canonical [`docs/product-roadmap.md`](docs/product-roadmap.md) sequences the
remaining rich-library and reviewed web enrichment, collaboration, photo/OCR/
barcode capture, history/insight, and v1.0 reliability work. Full
internationalization and arbitrary graphical cellar layouts are explicitly
post-v1.0 unless that roadmap is changed first.

## Development

Install dependencies:

    npm ci

Development and CI use Node 24, as pinned by `.node-version` and `package.json`.

Copy the web environment template:

    cp apps/web/.env.example apps/web/.env.local

Set:

    VITE_SUPABASE_URL
    VITE_SUPABASE_PUBLISHABLE_KEY
    VITE_POWERSYNC_URL

Run the web app:

    npm run web:dev

Manage local Supabase from the repository root:

    npm run supabase -- start

## Validation

    npm run repository:check
    npm run lwin:test
    npm run supabase -- test db
    npm run web:ci
    npm run audit
    git diff --check

GitHub CI combines repository and web checks, the Supabase database acceptance
suite, and the production-dependency audit behind the required `CI Gate` check.

## Deployment

Build with:

    npm run web:build

`wrangler.jsonc` serves `apps/web/dist` through Cloudflare Workers Static
Assets with SPA fallback.

The `v0.3.0` production build was smoke-tested before its annotated release tag
was created. See `apps/web/README.md` for local development and production/PWA
testing commands.

## Documentation

See `docs/README.md` for current architecture, roadmap, release, and historical
migration evidence.

Release notes: `docs/releases/v0.3.0.md`.

Current product roadmap: `docs/product-roadmap.md`.

Completed v0.3 delivery record: `docs/v03-roadmap.md`.

## License

MIT - see `LICENSE`.
