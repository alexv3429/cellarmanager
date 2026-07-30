#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it from https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24.x is required for frontend checks." >&2
  exit 1
fi

# The old project layout used backend/.venv. uv projects intentionally use
# the repository-level .venv. Avoid a misleading warning when an old virtual
# environment is still active in the parent shell.
if [[ -n "${VIRTUAL_ENV:-}" && "$VIRTUAL_ENV" != "$PWD/.venv" ]]; then
  echo "Ignoring active virtual environment: $VIRTUAL_ENV"
  echo "CellarManager uses: $PWD/.venv"
  unset VIRTUAL_ENV
fi

if grep -Eq 'applied-caas|internal\.api\.openai\.org' uv.lock; then
  cat >&2 <<'MESSAGE'
uv.lock contains a private build-environment package registry and is not portable.
Apply cellarmanager-modern-dev-portability-fix-patch before continuing.
MESSAGE
  exit 1
fi

uv sync --frozen --group dev
uv run --frozen ruff check --fix backend scripts
uv run --frozen ruff format backend scripts
uv run --frozen pre-commit install --hook-type pre-commit --hook-type pre-push
make ci

cat <<'MESSAGE'
Developer environment is ready.

Ruff may have changed Python files during the one-time migration. Review and commit
those formatting/import changes together with this workflow patch.
MESSAGE
