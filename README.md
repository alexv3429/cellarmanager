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

See `docs/adr/001-v02-target-architecture.md` and
`docs/adr/002-inventory-operation-model.md`.

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

Later milestones cover CSV export, duplicate/merge tooling, shared-household
workflows, capture/enrichment, internationalization, advanced graphical cellar
layouts, and purchase/value history.

## Development

Install dependencies:

    npm ci

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
    npm run supabase -- test db
    npm run web:ci
    git diff --check

GitHub CI runs both the web gate and the Supabase database acceptance suite.

## Deployment

Build with:

    npm run web:build

`wrangler.jsonc` serves `apps/web/dist` through Cloudflare Workers Static
Assets with SPA fallback.

Production is smoke-tested before the `v0.3.0` tag is created.

## Documentation

See `docs/README.md` for current architecture, roadmap, release, and historical
migration evidence.

Release notes: `docs/releases/v0.3.0.md`.

Current product roadmap: `docs/v03-roadmap.md`.

## License

MIT - see `LICENSE`.
