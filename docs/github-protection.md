# GitHub pre-merge protection

Committing a workflow file is not enough: GitHub must also require its result.
CellarManager exposes one stable aggregate status named **CI Gate**, so branch
rules do not depend on individual job names.

## What CI Gate covers

Every pull request runs:

- repository policy checks that reject secrets, databases, generated files,
  and retired v0.1 paths;
- web lint, unit tests, and production build on Node 24;
- the Supabase pgTAP database suite;
- a production-dependency npm audit that fails on high or critical
  vulnerabilities, with Dependabot covering development tooling as well;
- an aggregate `CI Gate` job that fails if any required job fails.

The workflow also runs for pushes to `main` and GitHub merge queues. Concurrent
obsolete runs are cancelled.

## Activate protection

After `CI Gate` has completed at least once, run from a clean clone authenticated
with GitHub CLI:

```bash
gh auth login
./scripts/protect_main.sh
```

The default is suitable for a solo repository: pull requests and CI are
mandatory, but a second person's approval is not. To require one approval:

```bash
REQUIRED_APPROVALS=1 ./scripts/protect_main.sh
```

The script also requires the branch to be current, dismisses stale approvals,
requires resolved conversations and linear history, disables force pushes and
branch deletion, and applies protection to administrators.

It requires `gh`, `jq`, and repository administration permission.

## Configure through GitHub instead

1. Open the repository's **Settings**.
2. Open **Rules → Rulesets** or **Branches**.
3. Create a rule targeting `main`.
4. Require changes through pull requests.
5. Require status checks and select **CI Gate**.
6. Require the branch to be current before merging.
7. Require conversation resolution and linear history.
8. Block force pushes and deletion.
9. Include administrators.
10. Use zero required approvals for solo work, or one or more with reviewers.

If `CI Gate` is unavailable, let the workflow finish successfully once and
retry. GitHub only offers recently observed checks in parts of its interface.

## Emergency changes

Prefer a small pull request with an explicit incident description. If protection
must be changed temporarily, record why, restore it immediately afterward, and
rerun `./scripts/protect_main.sh`.
