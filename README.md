# Wine Cellar Manager

A self-hosted app for managing one or more wine cellars: import your
collection from a CSV, track bottles as you add/move/remove them with a
full history journal, get statistics and move suggestions, find what to
open tonight, and export back to CSV - in English or French, from a phone
or a computer, online or offline.

## Stack, in one line

**Python + FastAPI + SQLite** backend (business logic is standard-library
only and fully unit tested; SQLite chosen deliberately over a heavier
ORM/DB for a personal-scale, zero-ops deployment) and a **dependency-free
JavaScript PWA** frontend (installable on your phone or desktop home
screen, works offline via a service worker + IndexedDB, no build step).
See `docs/architecture.md` for the full reasoning.

## Quick start

**To actually use this from your phone day to day**, see the
"Recommended: the easiest complete path" section in
[`docs/setup.md`](docs/setup.md) - it walks through renting a ~$5/month
cloud server, running this with Docker, and connecting your phone to it
privately over HTTPS via Tailscale, start to finish.

**To just try it locally first:**

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then set WINECELLAR_SECRET_KEY (see docs/security.md)
python run.py
```

Open `http://localhost:8000/` and create your account (the very first
registration bootstraps the owner account - see `docs/security.md`).

## Features

- **Import** a CSV of your bottles (mandatory: producer, cuvée,
  appellation, vintage, color, area, format; optional: price, quantity,
  drink-window dates, cellar/location, state, tasting/pairing advice,
  market value). English and French headers both work, in the same file.
- **Cellars** with a purpose from 0 (pure aging) to 10 (pure service), plus
  a separate "overflow" flag for extra/outside storage, capacity,
  an alert threshold, and an optional location-matching rule (e.g. `AG1`
  auto-assigns to the cellar whose rule is `AG`).
- **Add / move / remove** bottles (gift, breakage, sale, loss, drinking),
  every action logged to a journal.
- **Statistics**: counts, color/vintage/area/appellation breakdowns, price
  totals, and drinking-window status - overall and per cellar.
- **Move-plan advisor**: suggested moves to keep each cellar's mix matched
  to its purpose, capacity-aware, nothing moves until you approve a step.
- **Enrichment**: fetch a drinking window or market value with a
  confidence score, compared against what's already on file (see
  `docs/roadmap.md` for what's real vs. a placeholder here).
- **Photo matching**: recognize a bottle you've photographed before.
- **Daily picks**: an ordered list of suitable wines by cellar, dish,
  color, vintage, appellation, drinking window, or mood/occasion.
- **All locations for a wine**, and **CSV export** with your choice of
  columns, order, and language.
- **Offline-first**: works with no connection; changes queue locally and
  sync once you're back online, with a version-based conflict check so two
  offline edits can never silently clobber each other.
- **Authentication** required for everything; no open public sign-up.

See `docs/roadmap.md` for an honest, item-by-item status against the
original spec (what's fully tested vs. a documented extension point).

## Documentation

| Doc | Covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Stack rationale, layering, offline-sync design |
| [`docs/data-model.md`](docs/data-model.md) | ERD, CSV field mapping, why Wine/Holding are separate |
| [`docs/api.md`](docs/api.md) | Endpoint index (full reference at `/docs` when running) |
| [`docs/setup.md`](docs/setup.md) | Local dev, Docker, deploying with HTTPS |
| [`docs/testing.md`](docs/testing.md) | How to run tests, what's covered |
| [`docs/i18n.md`](docs/i18n.md) | How translation works, adding a language |
| [`docs/security.md`](docs/security.md) | Auth model, secrets, hardening checklist |
| [`docs/roadmap.md`](docs/roadmap.md) | Requirement-by-requirement status |

## Repository layout

```
backend/    Python API (app/core, app/storage, app/services, app/api) + tests
frontend/   Dependency-free JS PWA (no build step)
docs/       The documentation above
docker/     Dockerfile + docker-compose.yml
.github/    CI workflow (pytest + node --test on every push)
```

## Tests

```bash
# zero installation required:
cd backend && python3 -m unittest discover -s tests/unit -v
node --test frontend/tests/logic.test.js

# full suite, incl. real HTTP requests against the API:
pip install -r backend/requirements-dev.txt && pytest backend
```

See `docs/testing.md` for details on what runs where and why.

## License

MIT - see `LICENSE`. This is a sensible default for a personal project;
change it if you'd prefer something else.

## Comprehensive audit corrections

The audit correction patch hardens offline idempotency and conflict handling,
adds real IndexedDB read fallback, exposes cellar versions, corrects movement/CSV/recommendation edge cases, disables fabricated enrichment by default, fixes localization and responsive layout problems, and adds CI regression coverage. See [`docs/audit-fixes.md`](docs/audit-fixes.md).

Accounts in one installation intentionally share one household cellar. This is
not an independent multi-tenant SaaS security boundary. Real enrichment also
requires licensed provider implementations.

## Interactive CSV column mapping

CSV files are analyzed before import. The browser proposes mappings for known
English, French and legacy headers, then lets the user choose any source column,
add a fallback column and inspect normalized rows before committing changes.
See `docs/csv-column-mapping.md`.

## CSV reset and unassigned-bottle reconciliation

The CSV wizard can be reset after an import, and a successful import cannot be
submitted twice accidentally. Imports performed before cellar creation remain
visible as unassigned stock. When a cellar with a matching location prefix or
pattern is created or edited, matching holdings are automatically reconciled
and the move is recorded in the journal. The Cellars page also provides an
explicit reconciliation action for remaining unassigned bottles.

## Guided cellar location naming

Cellar creation includes a guided location-naming wizard. A configuration such
as cellar code `M`, columns `A-D`, and rows `1-3` creates the labelled grid
`MA1 ... MD3` without asking the user to write a regular expression. CSV codes
identify the cellar while internal positions can be stored as `A1 ... D3`.
Legacy prefix/regex rules and custom rack layouts remain available under the
advanced mode. See `docs/location-naming.md`.

## Structured cellar locations

The cellar editor provides five structured presets: loose storage, simple
row/column grids, grids with sub-positions, sequentially labelled grids, and
rows with depth. The backend stores a validated explicit location catalog in
the existing layout JSON and uses exact matching during CSV import and later
reconciliation. Regex remains available only as an advanced legacy option.
See `docs/location-structures.md`.

## Adaptive location wizard and physical orientation

The cellar editor displays only the fields relevant to the selected physical
structure. Simple grids and depth layouts support physical orientation without
renaming their location codes. For example, `G1F` remains `G1F`, while choosing
“Row 1 at the bottom” places it on the bottom row of the drawing.

