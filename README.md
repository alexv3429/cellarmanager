# CellarManager

CellarManager is a local-first wine cellar inventory application.

**Current release: v0.4.0**

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
defines the shared wine-reference and enrichment boundary implemented in v0.4.
The released rich-library pipeline combines an attributed LWIN snapshot,
conservative owner-reviewed matching, immutable versioned knowledge, and
asynchronous maturity, storage, and pairing projections. Missing shared
profiles can enter bounded multi-source research; source pages are used
transiently to prepare an attributable inactive draft, and only trusted
server-side publication can activate reviewed knowledge. Published-profile
reports and governed revision proposals preserve history. Household notes,
serving adjustments, rich wine facts, and private maturity calibration remain
strictly separate from the canonical shared library.

## v0.4 capabilities

v0.4 retains the v0.3 personal-production and local-first inventory baseline,
then adds explainable advice and a governed wine-knowledge lifecycle:

- maturity windows, urgency, storage purpose, and moving hints;
- food-pairing suggestions ranked only from bottles currently in stock;
- rich facts, personal observations, serving guidance, manual overrides, and a
  bounded private younger/later preference;
- reviewed LWIN matching, profile coverage diagnostics, multi-source research,
  error reports, curator review, immutable revisions, and trusted publication;
- conservative duplicate detection and explicit wine merging; and
- Excel-first cellar export with CSV fallback and guarded round-trip import.

The canonical [`docs/product-roadmap.md`](docs/product-roadmap.md) now sequences
shared-household collaboration, photo/OCR/barcode capture, history/insight,
and v1.0 reliability work. Full
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
    npm run release:check
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
Assets with SPA fallback. It also binds Workers AI and schedules the reviewed
enrichment worker. Deployment secrets and the source-rights boundary are
documented in
[`docs/reviewed-enrichment-research.md`](docs/reviewed-enrichment-research.md).

The `v0.4.0` production build was smoke-tested before its annotated release tag
was created. See `apps/web/README.md` for local development and production/PWA
testing commands.

## Documentation

See `docs/README.md` for current architecture, roadmap, release, and historical
migration evidence.

Release notes: `docs/releases/v0.4.0.md`.

Current product roadmap: `docs/product-roadmap.md`.

v0.4 acceptance record: `docs/v04-acceptance.md`.

## License

MIT - see `LICENSE`.
