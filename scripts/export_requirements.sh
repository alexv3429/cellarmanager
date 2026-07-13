#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv export --frozen --no-dev --no-hashes --format requirements-txt -o backend/requirements.txt
uv export --frozen --group dev --no-hashes --format requirements-txt -o backend/requirements-dev.txt
printf 'Updated backend/requirements.txt and backend/requirements-dev.txt from uv.lock.\n'
