#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for JavaScript syntax checks." >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  mapfile -d '' files < <(find frontend/js -name '*.js' -print0)
  files+=("frontend/service-worker.js")
fi

for file in "${files[@]}"; do
  node --check "$file"
done
