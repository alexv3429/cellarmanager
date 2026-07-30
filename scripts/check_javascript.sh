#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for JavaScript syntax checks." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
required_node_major="$(tr -d '[:space:]' < "$ROOT/.node-version")"
actual_node_major="$(node -p 'process.versions.node.split(".")[0]')"

if [[ "$actual_node_major" != "$required_node_major" ]]; then
  echo "Node.js ${required_node_major}.x is required; found $(node --version)." >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=()
  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(find frontend/js -type f -name '*.js' -print0)
  files+=("frontend/service-worker.js")
fi

for file in "${files[@]}"; do
  node --check "$file"
done
