#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-main}"
REQUIRED_APPROVALS="${REQUIRED_APPROVALS:-0}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required." >&2
  exit 1
fi

gh auth status >/dev/null
REPOSITORY="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

if ! [[ "$REQUIRED_APPROVALS" =~ ^[0-9]+$ ]]; then
  echo "REQUIRED_APPROVALS must be a non-negative integer." >&2
  exit 1
fi

cat <<MESSAGE
Protecting ${REPOSITORY}:${BRANCH}
- pull requests required
- CI Gate required and branch must be up to date
- stale approvals dismissed
- required approvals: ${REQUIRED_APPROVALS}
- conversations must be resolved
- linear history required
- force pushes and branch deletion disabled
- protection applies to administrators
MESSAGE

jq -n \
  --argjson approvals "$REQUIRED_APPROVALS" \
  '{
    required_status_checks: {
      strict: true,
      contexts: ["CI Gate"]
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: $approvals
    },
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    lock_branch: false,
    allow_fork_syncing: true
  }' | gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "repos/${REPOSITORY}/branches/${BRANCH}/protection" \
    --input -

printf '\nProtection enabled. Verify it under Settings > Rules > Rulesets or Branches.\n'
