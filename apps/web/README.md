# CellarManager web application

`apps/web` contains the React, TypeScript, Vite, PowerSync, and PWA client. Run
workspace commands from the repository root so the root lockfile and Node 24
toolchain remain authoritative.

## Routes

| URL | Workspace |
|---|---|
| `/` | Inventory |
| `/activity` | Recent inventory activity |
| `/catalog` | Wine catalog |
| `/import` | Guarded CSV import |
| `/setup` | Cellar and location setup |
| `/wines/:wineId` | Wine details |

Navigation uses the History API. Direct refresh, browser Back/Forward, and the
Cloudflare single-page-application fallback must keep these routes reachable.

## Configuration

Copy the environment template and set the three public client endpoints/keys:

```bash
cp apps/web/.env.example apps/web/.env.local
```

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_POWERSYNC_URL
```

Never commit `.env.local` or a service-role key.

## Development

```bash
npm ci
npm run web:dev
```

Vite is the fastest implementation loop. It does not reproduce the generated
service worker, installed-PWA lifecycle, or the network path used by a phone.

## Production/PWA and phone testing

```bash
npm run web:build
npx wrangler dev --tunnel
```

Wrangler prints a temporary HTTPS `trycloudflare.com` URL that is reachable from
both the computer and phone. Plain `npx wrangler dev` is suitable for PC-only
testing because its `localhost` URL is not reachable from the phone. Rebuild
before testing new source changes. Phone acceptance should cover authentication,
refresh, navigation, synchronization readiness, offline shell behavior, and the
specific feature changed by the PR.

## Validation

```bash
npm run repository:check
npm run web:ci
npm run audit
git diff --check
```

Run `npm run supabase -- test db` when database behavior or an end-to-end release
gate is in scope.

## Data boundary

PostgreSQL holdings are authoritative. PowerSync persists synchronized household
data and queued local-first ADD/MOVE/REMOVE operations. The CSV importer prepares
and previews locally, then performs its explicit final write through the guarded
transactional Supabase RPC while online.
