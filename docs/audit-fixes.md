# Audit correction patch

This document records the corrections introduced by the comprehensive audit
patch. It is intentionally explicit about what is fixed and what remains a
separate product decision.

## Data integrity

- Offline `client_op_id` values are reserved before any holding mutation.
- Completed operations return their stored result and cannot change stock twice.
- Reusing an operation ID with a different payload is rejected.
- Real HTTP 409 responses are stored as conflicts, not reported as successful.
- Validation failures are stored in a dead-letter list rather than deleted.
- Replay stops at the first unresolved operation so dependent changes stay in
  chronological order.
- A Sync Issues page lets a user review, retry against the current server
  version, or explicitly discard a preserved change.
- Cellar optimistic-concurrency versions are now exposed through every layer.

## Real offline reads

IndexedDB now stores wines, cellars, holdings, common API responses, queued
operations, conflicts, and failed operations. Entity lists are used when the
network is unavailable. Dashboard/statistics and daily recommendations have a
local calculation path, and offline add/move/remove operations update the local
holding view immediately.

The service worker caches only named static application files. API responses
are never accidentally cached by the service worker.

## Business-rule corrections

- Purpose level `0` remains pure aging rather than falling back to neutral `5`.
- Movement plans may suggest partial quantities and apply a modest
  color/area/appellation/vintage diversity penalty.
- CSV quantities must be positive whole numbers.
- Acquisition prices are quantity-weighted when two known-price lots merge;
  if either component cost is unknown, the aggregate is kept unknown rather
  than producing a misleading total.
- Non-vintage wines no longer pass explicit vintage-range filters.
- The daily-picks UI requests strict dish/mood matching instead of displaying
  unrelated zero-score results. The API keeps loose ranking as its backward-
  compatible default and exposes `strict_text_match` to other clients.

## UI, localization and layout

- The `/i18n/*.json` static files no longer collide with the backend translation
  API route.
- Translation dictionaries are validated before use.
- Responsive dashboard/navigation styles and useful empty states are included.
- The footer and page title follow the selected locale.
- Cellar racks are rendered as labelled SVG slots with occupancy counts and
  configurable location prefixes. This is still a structured rack editor, not
  an arbitrary CAD tool or drag-and-drop floor planner.

## Security and deployment

- Same-origin is the default; cross-origin access must be explicitly configured.
- Security headers are added to API/static responses.
- An optional `WINECELLAR_SETUP_TOKEN` protects first-account bootstrap.
- Login throttling is keyed by username and remote address.
- Demo enrichment is disabled by default and clearly returns a configuration
  error instead of fabricated wine advice.
- GitHub Actions now runs backend and frontend tests.
- `backend/scripts/backup_db.py` creates an online, integrity-checked SQLite backup with private file permissions.

## Deliberate remaining boundaries

The patch does **not** invent or scrape real commercial wine data. Configure a
licensed `EnrichmentProvider` before enabling Internet enrichment. It also does
not add passkeys/MFA, token revocation, arbitrary cellar geometry, or independent
multi-tenant ownership. The current account model is a shared household: every
account in one installation can access the same cellar. Deploy separate
instances for unrelated owners, or design a household/owner migration before
turning it into a public multi-tenant service.


## Modern development and merge controls

A later workflow patch replaces ad-hoc `venv`/pip setup with uv and a committed lock file, introduces Ruff as the single Python formatter/linter/import sorter, runs backend tests across supported Python versions, keeps frontend checks on Node's built-in runner, adds dependency review and Dependabot, and documents required branch protection. The stable required status is `CI Gate`; repository owners must activate protection because committing a workflow alone does not block direct merges.
