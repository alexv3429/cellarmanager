# Development workflow

CellarManager uses **uv** as the Python project and dependency manager, **Ruff** as the Python linter and formatter, `pytest` for backend tests, Node's built-in test runner for frontend tests, and `pre-commit` for local guardrails.

`pyproject.toml` is the human-edited dependency and tool configuration. `uv.lock` is committed and is the reproducible dependency source used by local development, CI, and Docker. The files under `backend/requirements*.txt` are compatibility exports only; do not edit them manually.

## Prerequisites

- Git
- Python is installed automatically by uv when needed; Python 3.12 is the project default
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Node.js 22 or newer for frontend syntax checks and tests
- `make` and Bash for the convenience commands on Linux/macOS
- Tesseract and its French language data when testing OCR locally

## First setup

From the repository root:

```bash
./scripts/bootstrap_dev.sh
```

The bootstrap script:

1. creates/synchronizes `.venv` from the committed lock file;
2. applies safe Ruff fixes and formatting once;
3. installs `pre-commit` and `pre-push` hooks;
4. runs the same quality and test commands used by CI.

Review Ruff's one-time formatting/import changes before committing them.

The equivalent manual setup is:

```bash
uv sync --frozen --group dev
uv run --frozen ruff check --fix backend scripts
uv run --frozen ruff format backend scripts
uv run --frozen pre-commit install --hook-type pre-commit --hook-type pre-push
make ci
```

Copy `backend/.env.example` to `backend/.env`, set a persistent secret key, then start the application:

```bash
cp backend/.env.example backend/.env
make run
```

## Everyday commands

```bash
make format         # apply Ruff fixes and formatting
make lint           # verify formatting and lint rules
make test           # backend + frontend tests
make ci             # exact local pre-merge gate
make run            # start the application
make clean          # remove local test/lint outputs
```

Direct uv forms are also supported:

```bash
uv run --frozen pytest -c pyproject.toml backend/tests
uv run --frozen ruff check backend scripts
uv run --frozen ruff format --check backend scripts
```

## Adding or updating dependencies

Runtime dependency:

```bash
uv add PACKAGE
```

Development dependency:

```bash
uv add --dev PACKAGE
```

Then run:

```bash
make requirements
make ci
git add pyproject.toml uv.lock backend/requirements*.txt
```

`uv sync --frozen` and CI fail when `pyproject.toml` and `uv.lock` disagree. Never hand-edit `uv.lock`.

## Git and pull-request flow

Do not work directly on `main` after protection is enabled.

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description

# edit, test, then:
make ci
git add -A
git commit -m "Describe the change"
git push -u origin feature/short-description
gh pr create --fill
```

Local hooks provide fast feedback, but GitHub CI is authoritative. A pull request cannot merge until the required `CI Gate` check succeeds and the branch is up to date.

## Local hooks

The commit hook runs Ruff on staged Python files, checks changed JavaScript syntax, and enforces repository policy. The push hook runs the full backend and frontend test suites.

To bypass a hook for an emergency investigation, Git supports `--no-verify`, but a protected pull request still cannot bypass required CI. Do not use `--no-verify` as a normal workflow.

## Compatibility requirement files

Some old scripts may still use pip. Regenerate the compatibility exports from the lock file with:

```bash
make requirements
```

New documentation, Docker builds, and CI use uv directly.

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

