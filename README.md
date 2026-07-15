# Wine Cellar Manager

A self-hosted app for managing one or more wine cellars: import your
collection from a CSV, track bottles as you add/edit/move/remove them with a
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

The supported local workflow uses **uv** and the committed lock file:

```bash
uv sync --frozen --group dev
cp backend/.env.example backend/.env   # set WINECELLAR_SECRET_KEY
make run
```

Open `http://localhost:8000/` and create the first owner account. For a complete developer setup with Ruff, local hooks, and tests, run `./scripts/bootstrap_dev.sh` and read [`docs/development.md`](docs/development.md). For a daily-use server deployment, see [`docs/setup.md`](docs/setup.md).

## Features

- **Import** a CSV of your bottles (mandatory: producer, cuvée,
  appellation, vintage, color, area, format; optional: price, quantity,
  drink-window dates, cellar/location, state, tasting/pairing advice,
  market value). English and French headers both work, in the same file.
  Common style labels such as `blanc moelleux`, `rouge doux`, `sweet white`
  and `sweet red` are normalized to the appropriate base colour.
- **Unified Add inventory** with manual entry, adding another purchase of an
  existing wine, manual ChatGPT JSON import, and optional configured vision
  assistance. Wine identity, Acquisition, Holding allocation, media metadata,
  and proposed enrichment remain separate records.
- **Cellars** with a purpose from 0 (pure aging) to 10 (pure service), plus
  a separate "overflow" flag for extra/outside storage, capacity,
  an alert threshold, and an optional location-matching rule (e.g. `AG1`
  auto-assigns to the cellar whose rule is `AG`).
- **Add / edit / move / remove** bottles (including correcting identity,
  purchase price and date), with every action logged to the journal.
- **Statistics**: counts, color/vintage/area/appellation breakdowns, price
  totals, and drinking-window status - overall and per cellar.
- **Move-plan advisor**: suggested moves to keep each cellar's mix matched
  to its purpose, capacity-aware, nothing moves until you approve a step.
- **Enrichment**: fetch a drinking window or market value with a
  confidence score, compared against what's already on file (see
  `docs/roadmap.md` for what's real vs. a placeholder here).
- **Optional legacy photo matching**: recognize a bottle already in the
  catalog; the primary intake flow is Add inventory.
- **Daily picks**: an ordered list of suitable wines by cellar, dish,
  color, vintage, appellation, drinking window, or mood/occasion.
- **All locations for a wine**, and **CSV export** with your choice of
  columns, order, and language.
- **Offline-first stock actions**: add/move/remove requests can queue locally
  and sync once you're back online, with idempotency and version checks. Bottle
  identity and purchase-detail corrections require a connection so stale edits
  are not replayed later.
- **Authentication** required for everything; no open public sign-up.

See `docs/roadmap.md` for an honest, item-by-item status against the
original spec (what's fully tested vs. a documented extension point).

## Documentation

| Doc | Covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Stack rationale, layering, offline-sync design |
| [`docs/data-model.md`](docs/data-model.md) | ERD, CSV field mapping, why Wine/Holding/Acquisition are separate |
| [`docs/csv-column-mapping.md`](docs/csv-column-mapping.md) | Interactive mapping and colour normalization |
| [`docs/editing-bottles.md`](docs/editing-bottles.md) | Correcting wine identity and purchase details safely |
| [`docs/api.md`](docs/api.md) | Endpoint index (full reference at `/docs` when running) |
| [`docs/setup.md`](docs/setup.md) | Local dev, Docker, deploying with HTTPS |
| [`docs/testing.md`](docs/testing.md) | How to run tests, what's covered |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributor quick start and pull-request rules |
| [`docs/development.md`](docs/development.md) | uv, Ruff, hooks, dependency updates, and pull-request workflow |
| [`docs/github-protection.md`](docs/github-protection.md) | Required CI checks and main-branch protection |
| [`docs/i18n.md`](docs/i18n.md) | How translation works, adding a language |
| [`docs/security.md`](docs/security.md) | Auth model, secrets, hardening checklist |
| [`docs/roadmap.md`](docs/roadmap.md) | Requirement-by-requirement status |

## Repository layout

```text
backend/      Python API and tests
frontend/     Dependency-free JavaScript PWA
scripts/      Developer, policy, export, and branch-protection helpers
docs/         Product, operations, and contributor documentation
docker/       Locked production image and Compose configuration
.github/      Required CI, dependency updates, and pull-request template
pyproject.toml + uv.lock  Dependency and tool source of truth
```

## Tests and quality

```bash
./scripts/bootstrap_dev.sh  # first setup
make format                 # apply Ruff fixes/formatting
make ci                     # same pre-merge gate as GitHub
```

CI runs the backend suite on Python 3.11–3.13, frontend syntax and unit tests on Node 22, Ruff, lock-file verification, repository policy checks, and dependency review. `main` must also be protected so the stable **CI Gate** status is required before merge; see [`docs/github-protection.md`](docs/github-protection.md).

The legacy `backend/requirements*.txt` files are generated compatibility exports. Edit dependencies in `pyproject.toml`, update `uv.lock`, and regenerate exports with `make requirements`.

## Modern development workflow

Development, CI, and Docker now use uv's locked project environment. Ruff replaces separate formatter/import/linter tools. Local pre-commit and pre-push hooks provide fast feedback, while a protected GitHub pull request and required **CI Gate** are the authoritative merge control. Dependabot updates both uv dependencies and GitHub Actions weekly.

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

## Correcting bottle and purchase details

The Bottles page has an **Edit / Modifier** action for correcting typos in the
shared wine identity and in a selected purchase lot. Identity changes apply to
all holdings of that wine; purchase changes apply only to the selected
acquisition or legacy holding. The backend runs SQLite integrity, foreign-key
and domain checks before and after the transactional update. See
[`docs/editing-bottles.md`](docs/editing-bottles.md).

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

<!-- modern-dev-portability-fix -->
## Portable uv lock files and virtual environments

The committed `uv.lock` must use public, portable package sources. It must not
contain developer-specific, corporate-only, or build-environment registry URLs.
Generate or verify it with `make lock` and `make ci`; the repository policy check
rejects known private build-registry references.

CellarManager's uv environment is the repository-level `.venv`. If an older
`backend/.venv` is active, deactivate it or run `unset VIRTUAL_ENV` before setup.
The bootstrap script also ignores that obsolete activation automatically.

If dependency installation fails against `pypi.org` or
`files.pythonhosted.org`, inspect corporate proxy/TLS settings. A failure against
`internal.api.openai.org` means an old, non-portable lockfile is still present.

## Evidence-backed Internet research

Configure OpenAI web search, or Brave Search plus OpenAI extraction, to research
wines from the **Bottles → Research online** dialog. Factual candidates keep
clickable sources and backend-calculated confidence; accepted candidates feed
normal wine fields and the daily-picks ranking. See
`docs/internet-enrichment.md`. Provider calls may incur external costs and no
commercial data license is bundled.

<!-- sweetness-preservation -->
## Sweetness preservation

Colour and sweetness are stored separately. CSV values such as `blanc moelleux`, `rouge liquoreux`, `sweet white`, and `sweet red` keep the base colour (`white` or `red`) and also populate the extended wine-identity sweetness field. A dedicated `Sweetness` / `Sucrosité` CSV column is supported and takes precedence over sweetness inferred from the colour cell. Sweetness can be corrected later from **Edit bottle**, and the update preserves all other identity details.

