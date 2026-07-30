# GitHub pre-merge protection

Committing a workflow file is not enough: GitHub must also be told that its result is required. This project exposes one stable aggregate status named **CI Gate**. Protecting that single status avoids fragile branch rules when test matrices change.

## What the required CI gate covers

Every pull request runs:

- the committed `uv.lock` in frozen mode;
- Ruff formatting and lint checks;
- repository policy checks for secrets/databases/generated files;
- the complete backend suite on Python 3.11, 3.12, and 3.13;
- JavaScript syntax and all frontend unit tests on Node 24;
- GitHub dependency review for newly introduced vulnerable dependencies;
- an aggregate `CI Gate` job that fails if any applicable job fails.

The workflow also runs for pushes to `main` and for GitHub merge queues (`merge_group`). Concurrent obsolete runs are cancelled.

## Activate protection

First push this workflow patch on a branch and open a pull request. Let the `CI Gate` job complete successfully once so GitHub knows the check name.

Then, from a clean clone authenticated with GitHub CLI:

```bash
gh auth login
make protect-main
```

The default is appropriate for a solo repository: pull requests and CI are mandatory, but no second person's approval is required. If another maintainer can review changes, require one approval:

```bash
REQUIRED_APPROVALS=1 make protect-main
```

The script also:

- requires the branch to be current before merging;
- dismisses stale reviews;
- requires conversations to be resolved;
- requires linear history;
- disables force pushes and branch deletion;
- applies protection to repository administrators, including the owner.

The script needs `gh`, `jq`, and repository administration permission.

## Configure through the GitHub interface instead

1. Open the repository's **Settings**.
2. Open **Rules → Rulesets** or **Branches**, depending on the interface shown for the account.
3. Create a rule targeting `main`.
4. Require changes through pull requests.
5. Require status checks and select **CI Gate**.
6. Require the branch to be up to date before merging.
7. Require conversation resolution and linear history.
8. Block force pushes and deletion.
9. Include administrators so the repository owner cannot casually bypass the rule.
10. Use zero required approvals for solo work, or one or more when reviewers are available.

If `CI Gate` is not offered, run the workflow successfully on the repository and retry. GitHub only offers recently observed status checks in parts of its settings interface.

## Recommended repository settings

- Disable direct merge commits if linear history is required; use squash or rebase merging.
- Enable automatic deletion of merged branches.
- Enable the dependency graph, Dependabot alerts, and Dependabot security updates.
- Enable CodeQL default setup for Python and JavaScript when available for the repository plan.
- Do not enable automatic merging unless required checks and branch protection are active.

## Emergency changes

Prefer a small pull request with an explicit incident description. If protection must be changed temporarily, record why, restore it immediately afterward, and rerun `make protect-main` to return to the documented baseline.
