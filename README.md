# CellarManager

CellarManager is a local-first wine cellar inventory application.

**Current release: v0.2.0**

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

## v0.2 capabilities

v0.2 includes self-service authentication, household isolation, stable
browser/device registration, cellar/location setup, wine catalog management,
wine identity/metadata/format editing, PostgreSQL-authoritative holdings, and
offline-capable ADD, MOVE and REMOVE operations with idempotent replay.

Later milestones cover the richer application shell, activity/history UI,
expanded wine-library features, CSV import/export, duplicate/merge tooling,
shared households, capture/enrichment, and purchase/value history.

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

Production is smoke-tested before the `v0.2.0` tag is created.

## Documentation

See `docs/README.md` for current architecture, roadmap, release, and historical
migration evidence.

Release notes: `docs/releases/v0.2.0.md`.

Current product roadmap: `docs/v03-roadmap.md`.

## License

MIT - see `LICENSE`.
