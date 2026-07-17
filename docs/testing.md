# Testing and quality gates

## One command before a pull request

```bash
make ci
```

This is the supported local pre-merge gate. It verifies that `uv.lock` matches `pyproject.toml`, runs Ruff formatting and lint checks, checks repository policy, runs the complete backend suite with coverage, checks all JavaScript syntax, and runs every frontend Node test.

Set up the locked environment and hooks once with:

```bash
./scripts/bootstrap_dev.sh
```

## Backend

```bash
uv run --frozen pytest -c pyproject.toml backend/tests
uv run --frozen pytest -c pyproject.toml --cov=backend/app --cov-report=term-missing backend/tests
```

CI executes the suite independently on Python 3.11, 3.12, and 3.13. The CI database and setup token are isolated through environment variables.

## Frontend

```bash
./scripts/check_javascript.sh
node --test frontend/tests/*.test.js
```

The frontend remains dependency-free at runtime and uses Node's built-in test runner. DOM-heavy end-to-end browser tests are still a future enhancement; visible changes should include screenshots and manual verification in the pull request until Playwright is introduced.

## Ruff

```bash
make format
make lint
```

Ruff is configured in `pyproject.toml` and is the single Python formatter, import sorter, and linter. The commit hook applies safe fixes and formatting to staged Python files. CI always checks the complete backend and repository scripts.

## Git hooks

`pre-commit` runs Ruff, JavaScript syntax, and repository-policy checks before a commit. `pre-push` runs the complete backend and frontend suites. Install both with `make setup` or `make hooks`.

Hooks are convenience feedback, not the security boundary: the protected GitHub **CI Gate** is authoritative.

## GitHub CI

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, merge queues, and manual dispatch. It contains:

- **Quality**: frozen lock, Ruff, and repository policy;
- **Backend tests**: Python 3.11–3.13 matrix with coverage;
- **Frontend tests**: Node 22 syntax and unit tests;
- **Dependency review**: blocks newly introduced dependencies with moderate-or-higher known vulnerabilities;
- **CI Gate**: stable aggregate required by branch protection.

A workflow alone does not prevent a bad merge. Follow `docs/github-protection.md` to require **CI Gate**, require pull requests, prevent force pushes, and apply protection to administrators.

## Dependency updates

Dependabot checks the uv ecosystem and GitHub Actions weekly. Its pull requests must pass the same gate. For manual changes:

```bash
uv add PACKAGE
uv add --dev PACKAGE
make requirements
make ci
```

The files `backend/requirements.txt` and `backend/requirements-dev.txt` are generated pip compatibility exports, not dependency sources.

## Current coverage

Backend tests cover the domain/repository/services, HTTP API, unified inventory transactions and media staging, strict manual-ChatGPT import, CSV mapping and reconciliation, sweet white/red colour normalization, transactional bottle corrections and pre-update database-integrity rejection, synchronization regressions, cellar structures and orientation, recommendations, currency-separated market/quick-sale valuation priority and backfill, statistics, movement planning, authentication, recognition, and export. Frontend tests cover pure logic and the patch regressions added to page modules. Coverage output is reported on every backend CI matrix job; a numeric failure threshold can be ratcheted upward once a stable baseline is agreed.

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

## Enrichment tests

CI uses injected fake transports and synthetic structured responses. It must
never call OpenAI, Brave, merchants, critics or licensed providers. The tests
cover confidence calculation, exact-format price normalization, source URL
safety and authority, manual-value protection, secondary-over-replacement
priority, separate quick-sale projection, startup backfill, currency-safe
statistics, persistence/review, enriched recommendation ranking and zero-result
diagnostics. Live smoke tests are operational checks and must remain opt-in.

<!-- sweetness-preservation -->
## Colour and sweetness

Colour and sweetness are stored separately. CSV values such as `blanc moelleux`, `rouge liquoreux`, `sweet white`, and `sweet red` keep the base colour (`white` or `red`) and also populate the extended wine-identity sweetness field. A dedicated `Sweetness` / `Sucrosité` CSV column is supported and takes precedence over sweetness inferred from the colour cell. Sweetness can be corrected later from **Edit bottle**, and the update preserves all other identity details.

